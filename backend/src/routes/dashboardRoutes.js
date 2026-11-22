const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');

function getPeriod(type, referenceDate) {
  const date = new Date(`${referenceDate}T00:00:00.000Z`);
  const start = new Date(date);
  const end = new Date(date);

  if (type === 'last7days') {
    start.setUTCDate(start.getUTCDate() - 6);
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (type === 'day') {
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (type === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    start.setUTCDate(1);
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1);
  }

  if (start.getUTCFullYear() < 1000 || end.getUTCFullYear() > 9999) return null;
  const lastDay = new Date(end);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return {
    type,
    referenceDate,
    startDate: start.toISOString().slice(0, 10),
    endDate: lastDay.toISOString().slice(0, 10),
    endExclusive: end.toISOString().slice(0, 10),
    granularity: type === 'day' ? 'hour' : 'day',
  };
}

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), async (req, res, next) => {
  const userFilter = req.user.roleName === 'ADMIN' ? '' : ' AND c.agent_id = ?';
  const userValues = req.user.roleName === 'ADMIN' ? [] : [req.user.id];
  const type = req.query.period === undefined ? 'last7days' : req.query.period;
  if (!['last7days', 'day', 'week', 'month'].includes(type)) {
    return res.status(400).json({ message: 'Período inválido.' });
  }
  const rawDate = req.query.date;
  if (type !== 'last7days') {
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return res.status(400).json({ message: 'La fecha debe tener el formato AAAA-MM-DD.' });
    }
    const parsedDate = new Date(`${rawDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== rawDate ||
        parsedDate.getUTCFullYear() < 1000) {
      return res.status(400).json({ message: 'Fecha inválida.' });
    }
  } else if (rawDate !== undefined) {
    return res.status(400).json({ message: 'Los últimos 7 días no requieren una fecha.' });
  }

  try {
    const [[todayRow]] = await pool.query("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today");
    const period = getPeriod(type, type === 'last7days' ? todayRow.today : rawDate);
    if (!period) return res.status(400).json({ message: 'La fecha está fuera del rango permitido.' });
    const rangeValues = [period.startDate, period.endExclusive, ...userValues];
    const dateFormat = period.granularity === 'hour' ? '%Y-%m-%dT%H:00:00' : '%Y-%m-%d';

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
                AS averageDurationSeconds
       FROM calls c
       WHERE c.created_at >= ? AND c.created_at < ?${userFilter}`,
      rangeValues
    );

    const [dailyRows] = await pool.query(
      `SELECT DATE_FORMAT(c.created_at, ?) AS date,
              COUNT(*) AS totalCalls,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls
       FROM calls c
       WHERE c.created_at >= ? AND c.created_at < ?${userFilter}
       GROUP BY date
       ORDER BY date`,
      [dateFormat, ...rangeValues]
    );

    const [durationRows] = await pool.query(
      `SELECT DATE_FORMAT(c.created_at, ?) AS date,
              AVG(c.duration_seconds) AS averageDurationSeconds
       FROM calls c
       WHERE c.created_at >= ? AND c.created_at < ?
         AND c.status = 'completed'
         AND c.duration_seconds > 0${userFilter}
       GROUP BY date
       ORDER BY date`,
      [dateFormat, ...rangeValues]
    );

    const dailyCounts = new Map(dailyRows.map((row) => [
      row.date,
      {
        totalCalls: Number(row.totalCalls),
        completedCalls: Number(row.completedCalls),
      },
    ]));
    const start = new Date(`${period.startDate}T00:00:00.000Z`);
    const end = new Date(`${period.endExclusive}T00:00:00.000Z`);
    const bucketCount = period.granularity === 'hour' ? 24 : (end - start) / 86400000;
    const callsByDay = Array.from({ length: bucketCount }, (_, index) => {
      const date = new Date(start);
      if (period.granularity === 'hour') date.setUTCHours(index);
      else date.setUTCDate(date.getUTCDate() + index);
      const dateString = period.granularity === 'hour' ? date.toISOString().slice(0, 19) : date.toISOString().slice(0, 10);
      const counts = dailyCounts.get(dateString) || { totalCalls: 0, completedCalls: 0 };
      return { date: dateString, ...counts };
    });
    const dailyDurations = new Map(durationRows.map((row) => [
      row.date,
      Number(row.averageDurationSeconds),
    ]));
    const averageDurationByDay = callsByDay.map(({ date }) => ({
      date,
      averageDurationSeconds: dailyDurations.get(date) ?? null,
    }));

    return res.json({
      summary: {
        totalCalls: Number(summaryRows[0].totalCalls),
        completedCalls: Number(summaryRows[0].completedCalls),
        failedCalls: Number(summaryRows[0].failedCalls),
        averageDurationSeconds: Number(summaryRows[0].averageDurationSeconds),
        callsByDay,
        averageDurationByDay,
        period: {
          type: period.type,
          referenceDate: period.referenceDate,
          startDate: period.startDate,
          endDate: period.endDate,
          granularity: period.granularity,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
