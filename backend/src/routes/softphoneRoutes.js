const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { runInTransaction } = require('../utils/surveillanceQueue');

const validDeviceSessionId = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

router.use(authenticate);

router.get('/presence', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT CASE WHEN device_session_id IS NULL
                         OR updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                   THEN 'offline' ELSE status END AS status,
              CASE WHEN device_session_id IS NOT NULL
                         AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                   THEN TRUE ELSE FALSE END AS deviceRegistered,
              updated_at
       FROM agent_presence
       WHERE user_id = ?`,
      [req.user.id]
    );
    return res.json({ presence: rows[0] || { status: 'offline', deviceRegistered: false, updated_at: null } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence/register', async (req, res, next) => {
  const { deviceSessionId } = req.body || {};
  if (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId)) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const presence = await runInTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO agent_presence (user_id, status, device_session_id)
         VALUES (?, 'offline', NULL)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [req.user.id]
      );
      const [rows] = await connection.query(
        `SELECT device_session_id, status,
                updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) AS is_fresh
         FROM agent_presence
         WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      const current = rows[0];
      if (current && current.device_session_id &&
          current.device_session_id !== deviceSessionId && current.is_fresh &&
          current.status !== 'offline') {
        return { conflict: true };
      }

      const nextStatus = current?.device_session_id === deviceSessionId && current.status === 'busy'
        ? 'busy'
        : 'available';
      if (current) {
        await connection.query(
          `UPDATE agent_presence
           SET status = ?, device_session_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [nextStatus, deviceSessionId, req.user.id]
        );
      }
      return { status: nextStatus };
    });
    if (presence.conflict) {
      return res.status(409).json({ message: 'Ya existe otro dispositivo registrado para este usuario.' });
    }
    return res.json({ presence: { status: presence.status, deviceRegistered: true } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence/heartbeat', async (req, res, next) => {
  const { deviceSessionId } = req.body || {};
  if (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId)) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const heartbeat = await runInTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT device_session_id, status,
                updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) AS is_fresh
         FROM agent_presence
         WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      if (!rows.length) return { refreshed: false, reason: 'not_registered' };

      const presence = rows[0];
      if (presence.device_session_id !== deviceSessionId) {
        return { refreshed: false, reason: 'session_replaced' };
      }

      if (!presence.is_fresh || !['available', 'busy'].includes(presence.status)) {
        await connection.query(
          `UPDATE agent_presence SET status = 'offline', device_session_id = NULL
           WHERE user_id = ? AND device_session_id = ?`,
          [req.user.id, deviceSessionId]
        );
        return { refreshed: false, reason: 'expired' };
      }

      const [result] = await connection.query(
        `UPDATE agent_presence SET updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND device_session_id = ?
           AND status IN ('available', 'busy')
           AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
        [req.user.id, deviceSessionId]
      );
      return result.affectedRows === 1
        ? { refreshed: true }
        : { refreshed: false, reason: 'expired' };
    });
    return res.json(heartbeat);
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence', async (req, res, next) => {
  const { status, deviceSessionId } = req.body || {};
  if (!['offline', 'available', 'busy'].includes(status)) {
    return res.status(400).json({ message: 'Estado de agente inválido.' });
  }

  if (status !== 'offline' &&
      (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId))) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }
  if (status === 'offline' && deviceSessionId != null &&
      (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId))) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    if (status === 'offline') {
      await pool.query(
        `UPDATE agent_presence SET status = 'offline', device_session_id = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?${deviceSessionId ? ' AND device_session_id = ?' : ''}`,
        deviceSessionId ? [req.user.id, deviceSessionId] : [req.user.id]
      );
      return res.json({ presence: { status: 'offline', deviceRegistered: false } });
    }

    const [result] = await pool.query(
      `UPDATE agent_presence SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND device_session_id = ?
         AND status IN ('available', 'busy')
         AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
      [status, req.user.id, deviceSessionId]
    );
    if (result.affectedRows !== 1) {
      return res.status(409).json({ message: 'El dispositivo no está registrado o su sesión venció.' });
    }
    return res.json({ presence: { status } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
