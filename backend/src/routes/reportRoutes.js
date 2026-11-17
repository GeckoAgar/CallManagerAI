const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');

const validDurationAverage = `COALESCE(AVG(CASE
  WHEN c.status = 'completed'
    AND c.duration_seconds IS NOT NULL
    AND c.duration_seconds >= 0
  THEN c.duration_seconds
END), 0)`;

function callAccessFilter(user) {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ' AND c.agent_id = ?', values: [user.id] };
}

function buildCallsByDay(today, rows) {
  const countsByDate = new Map(rows.map((row) => [
    row.date,
    {
      totalCalls: Number(row.totalCalls),
      completedCalls: Number(row.completedCalls),
      failedCalls: Number(row.failedCalls),
    },
  ]));

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    const dateString = date.toISOString().slice(0, 10);
    return {
      date: dateString,
      ...(countsByDate.get(dateString) || { totalCalls: 0, completedCalls: 0, failedCalls: 0 }),
    };
  });
}

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), async (req, res, next) => {
  const filter = callAccessFilter(req.user);
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
              COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
              ${validDurationAverage} AS averageDurationSeconds
       FROM calls c
       WHERE 1 = 1${filter.clause}`,
      filter.values
    );
    return res.json({
      summary: {
        totalCalls: Number(rows[0].totalCalls),
        completedCalls: Number(rows[0].completedCalls),
        failedCalls: Number(rows[0].failedCalls),
        averageDurationSeconds: Number(rows[0].averageDurationSeconds),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/calls-by-day', authenticate, requireRole('ADMIN', 'USER'), async (req, res, next) => {
  const filter = callAccessFilter(req.user);
  try {
    const [todayRows] = await pool.query(
      "SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today"
    );
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(c.created_at, '%Y-%m-%d') AS date,
              COUNT(*) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
              COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls
       FROM calls c
       WHERE c.created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
         AND c.created_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)${filter.clause}
       GROUP BY DATE_FORMAT(c.created_at, '%Y-%m-%d')
       ORDER BY date`,
      filter.values
    );
    return res.json({ callsByDay: buildCallsByDay(todayRows[0].today, rows) });
  } catch (error) {
    return next(error);
  }
});

router.get('/by-agent', authenticate, requireRole('ADMIN', 'USER'), async (req, res, next) => {
  const userFilter = req.user.roleName === 'ADMIN' ? '' : ' WHERE u.id = ?';
  const values = req.user.roleName === 'ADMIN' ? [] : [req.user.id];
  try {
    const [agents] = await pool.query(
      `SELECT u.id AS agentId, u.name AS agentName,
              COUNT(c.id) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
              COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
              ${validDurationAverage} AS averageDurationSeconds
       FROM users u
       LEFT JOIN calls c ON c.agent_id = u.id
       ${userFilter}
       GROUP BY u.id, u.name
       ORDER BY u.name, u.id`,
      values
    );
    return res.json({
      agents: agents.map((agent) => ({
        agentId: Number(agent.agentId),
        agentName: agent.agentName,
        totalCalls: Number(agent.totalCalls),
        completedCalls: Number(agent.completedCalls),
        failedCalls: Number(agent.failedCalls),
        averageDurationSeconds: Number(agent.averageDurationSeconds),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', authenticate, requireRole('ADMIN', 'USER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at
       FROM recordings r
       JOIN calls c ON c.id = r.call_id
       WHERE (? = 'ADMIN' OR c.agent_id = ?)
       ORDER BY r.id DESC`,
      [req.user.roleName, req.user.id]
    );
    return res.json({ recordings: rows });
  } catch (error) {
    console.error('Failed to load report recordings:', error);
    return res.status(500).json({ message: 'Error al obtener grabaciones.' });
  }
});

module.exports = router;
