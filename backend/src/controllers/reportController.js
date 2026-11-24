const reportModel = require('../models/reportModel');

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

async function summary(req, res, next) {
  try {
    const row = await reportModel.summary(req.user);
    return res.json({
      summary: {
        totalCalls: Number(row.totalCalls),
        completedCalls: Number(row.completedCalls),
        failedCalls: Number(row.failedCalls),
        averageDurationSeconds: Number(row.averageDurationSeconds),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function callsByDay(req, res, next) {
  try {
    const today = await reportModel.today();
    const rows = await reportModel.callsByDay(req.user);
    return res.json({ callsByDay: buildCallsByDay(today, rows) });
  } catch (error) {
    return next(error);
  }
}

async function byAgent(req, res, next) {
  try {
    const agents = await reportModel.byAgent(req.user);
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
}

async function recordings(req, res) {
  try {
    const rows = await reportModel.recordings(req.user);
    return res.json({ recordings: rows });
  } catch (error) {
    console.error('Failed to load report recordings:', error);
    return res.status(500).json({ message: 'Error al obtener grabaciones.' });
  }
}

module.exports = { summary, callsByDay, byAgent, recordings };
