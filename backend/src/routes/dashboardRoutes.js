const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), async (req, res, next) => {
  const userFilter = req.user.roleName === 'ADMIN' ? '' : ' AND c.agent_id = ?';
  const userValues = req.user.roleName === 'ADMIN' ? [] : [req.user.id];

  try {
    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
              COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
              COALESCE(AVG(CASE
                WHEN c.status = 'completed'
                  AND c.duration_seconds IS NOT NULL
                  AND c.duration_seconds >= 0
                THEN c.duration_seconds
              END), 0)
                AS averageDurationSeconds,
              DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today
       FROM calls c
       WHERE 1 = 1${userFilter}`,
      userValues
    );

    const [dailyRows] = await pool.query(
      `SELECT DATE_FORMAT(c.created_at, '%Y-%m-%d') AS date,
              COUNT(*) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls
       FROM calls c
       WHERE c.created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
         AND c.created_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)${userFilter}
       GROUP BY DATE_FORMAT(c.created_at, '%Y-%m-%d')
       ORDER BY date`,
      userValues
    );

    const today = summaryRows[0].today;
    const dailyCounts = new Map(dailyRows.map((row) => [
      row.date,
      {
        totalCalls: Number(row.totalCalls),
        completedCalls: Number(row.completedCalls),
      },
    ]));
    const callsByDay = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${today}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - 6 + index);
      const dateString = date.toISOString().slice(0, 10);
      const counts = dailyCounts.get(dateString) || { totalCalls: 0, completedCalls: 0 };
      return { date: dateString, ...counts };
    });

    return res.json({
      summary: {
        totalCalls: Number(summaryRows[0].totalCalls),
        completedCalls: Number(summaryRows[0].completedCalls),
        failedCalls: Number(summaryRows[0].failedCalls),
        averageDurationSeconds: Number(summaryRows[0].averageDurationSeconds),
        callsByDay,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
