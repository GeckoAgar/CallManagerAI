const dashboardModel = require('../models/dashboardModel');
const { z } = require('zod');

const periodSchema = z.enum(['last7days', 'day', 'week', 'month']);
const dateFormatSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateSchema = dateFormatSchema.refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    parsed.getUTCFullYear() >= 1000;
});

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

async function summary(req, res, next) {
  const type = req.query.period === undefined ? 'last7days' : req.query.period;
  if (!periodSchema.safeParse(type).success) {
    return res.status(400).json({ message: 'Período inválido.' });
  }
  const rawDate = req.query.date;
  if (type !== 'last7days') {
    if (!dateFormatSchema.safeParse(rawDate).success) {
      return res.status(400).json({ message: 'La fecha debe tener el formato AAAA-MM-DD.' });
    }
    if (!dateSchema.safeParse(rawDate).success) {
      return res.status(400).json({ message: 'Fecha inválida.' });
    }
  } else if (rawDate !== undefined) {
    return res.status(400).json({ message: 'Los últimos 7 días no requieren una fecha.' });
  }

  try {
    const today = await dashboardModel.today();
    const period = getPeriod(type, type === 'last7days' ? today : rawDate);
    if (!period) return res.status(400).json({ message: 'La fecha está fuera del rango permitido.' });
    const dateFormat = period.granularity === 'hour' ? '%Y-%m-%dT%H:00:00' : '%Y-%m-%d';

    const summaryRow = await dashboardModel.summary(req.user, period);
    const dailyRows = await dashboardModel.dailyCounts(req.user, period, dateFormat);
    const durationRows = await dashboardModel.dailyDurations(req.user, period, dateFormat);

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
        totalCalls: Number(summaryRow.totalCalls),
        completedCalls: Number(summaryRow.completedCalls),
        failedCalls: Number(summaryRow.failedCalls),
        averageDurationSeconds: Number(summaryRow.averageDurationSeconds),
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
}

module.exports = { summary };
