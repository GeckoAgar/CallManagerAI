const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');
const { isPositiveId } = require('../utils/resourceValidation');
const { runInTransaction } = require('../utils/surveillanceQueue');

router.use(authenticate, requireRole('ADMIN'));

async function updateQueueStatus(req, res, next, nextStatus) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de cola inválido.' });

  try {
    const result = await runInTransaction(async (connection) => {
      const [links] = await connection.query(
        'SELECT call_id FROM surveillance_queue WHERE id = ?',
        [id]
      );
      if (!links.length) return 'not-found';

      const callId = links[0].call_id;
      let callStatus = null;
      if (callId != null) {
        const [calls] = await connection.query(
          'SELECT status FROM calls WHERE id = ? FOR UPDATE',
          [callId]
        );
        if (calls.length) callStatus = calls[0].status;
      }

      const [entries] = await connection.query(
        'SELECT id, agent_id, status FROM surveillance_queue WHERE id = ? FOR UPDATE',
        [id]
      );
      if (!entries.length) return 'not-found';
      const entry = entries[0];
      if (callStatus !== 'active') return 'call-not-active';

      const [agents] = await connection.query(
        `SELECT u.id
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND u.status = 'active' AND r.name = 'USER'
         FOR UPDATE`,
        [entry.agent_id]
      );
      if (!agents.length) return 'invalid-agent';

      if (nextStatus === 'monitoring' && entry.status !== 'waiting') return 'invalid-transition';
      if (nextStatus === 'escalated' && !['waiting', 'monitoring'].includes(entry.status)) {
        return 'invalid-transition';
      }

      await connection.query(
        'UPDATE surveillance_queue SET status = ? WHERE id = ?',
        [nextStatus, id]
      );
      return 'updated';
    });

    if (result === 'not-found') return res.status(404).json({ message: 'Entrada de supervisión no encontrada.' });
    if (result !== 'updated') {
      const messages = {
        'call-not-active': 'Solo se pueden supervisar llamadas activas.',
        'invalid-agent': 'La entrada no tiene un agente activo válido.',
        'invalid-transition': 'La transición de estado solicitada no es válida.',
      };
      return res.status(409).json({ message: messages[result] });
    }
    return res.json({ message: 'Estado de supervisión actualizado.', status: nextStatus });
  } catch (error) {
    return next(error);
  }
}

router.get('/summary', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS totalAgents,
              COUNT(CASE WHEN p.device_session_id IS NOT NULL
                              AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                              AND p.status = 'available' THEN 1 END) AS availableAgents,
              COUNT(CASE WHEN p.device_session_id IS NOT NULL
                              AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                              AND p.status = 'busy' THEN 1 END) AS busyAgents,
              COUNT(CASE WHEN p.device_session_id IS NULL
                              OR p.updated_at IS NULL
                              OR p.updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                              OR p.status = 'offline' THEN 1 END) AS offlineAgents,
              (SELECT COUNT(*) FROM calls WHERE status = 'active') AS activeCalls,
              (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'waiting') AS waitingCalls,
              (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'monitoring') AS monitoringCalls,
              (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'escalated') AS escalatedCalls
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN agent_presence p ON p.user_id = u.id
       WHERE r.name = 'USER' AND u.status = 'active'`
    );
    const summary = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [key, Number(value)])
    );
    return res.json({ summary });
  } catch (error) {
    return next(error);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const [agents] = await pool.query(
      `SELECT u.id, u.name, u.email,
              CASE WHEN p.device_session_id IS NULL
                         OR p.updated_at IS NULL
                         OR p.updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                   THEN 'offline' ELSE p.status END AS status,
              p.updated_at AS updatedAt
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN agent_presence p ON p.user_id = u.id
       WHERE r.name = 'USER' AND u.status = 'active'
       ORDER BY u.name, u.id`
    );
    return res.json({ agents });
  } catch (error) {
    return next(error);
  }
});

router.get('/queue', async (req, res, next) => {
  try {
    const [queue] = await pool.query(
      `SELECT q.id, q.agent_id AS agentId, u.name AS agentName,
              q.call_id AS callId, c.phone_number AS phoneNumber,
              q.status, q.created_at AS createdAt
       FROM surveillance_queue q
       LEFT JOIN users u ON u.id = q.agent_id
       LEFT JOIN calls c ON c.id = q.call_id
       ORDER BY q.created_at DESC, q.id DESC`
    );
    return res.json({ queue });
  } catch (error) {
    return next(error);
  }
});

router.post('/queue/:id/monitoring', async (req, res, next) => {
  return updateQueueStatus(req, res, next, 'monitoring');
});

router.post('/queue/:id/escalate', async (req, res, next) => {
  return updateQueueStatus(req, res, next, 'escalated');
});

router.delete('/queue/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de cola inválido.' });

  try {
    const deleted = await runInTransaction(async (connection) => {
      const [links] = await connection.query(
        'SELECT call_id FROM surveillance_queue WHERE id = ?',
        [id]
      );
      if (!links.length) return false;
      if (links[0].call_id != null) {
        await connection.query(
          'SELECT id FROM calls WHERE id = ? FOR UPDATE',
          [links[0].call_id]
        );
      }
      const [result] = await connection.query(
        'DELETE FROM surveillance_queue WHERE id = ?',
        [id]
      );
      return result.affectedRows > 0;
    });
    if (!deleted) return res.status(404).json({ message: 'Entrada de supervisión no encontrada.' });
    return res.json({ message: 'Entrada retirada de la cola.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
