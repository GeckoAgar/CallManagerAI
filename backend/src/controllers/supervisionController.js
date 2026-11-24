const supervisionModel = require('../models/supervisionModel');
const { isPositiveId } = require('../utils/resourceValidation');
const { runInTransaction } = require('../utils/surveillanceQueue');

async function updateQueueStatus(req, res, next, nextStatus) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de cola inválido.' });

  try {
    const result = await runInTransaction(async (connection) => {
      const link = await supervisionModel.findLink(connection, id);
      if (!link) return 'not-found';

      const callId = link.call_id;
      let callStatus = null;
      if (callId != null) {
        const call = await supervisionModel.lockCall(connection, callId);
        if (call) callStatus = call.status;
      }

      const entry = await supervisionModel.lockEntry(connection, id);
      if (!entry) return 'not-found';
      if (callStatus !== 'active') return 'call-not-active';

      const agent = await supervisionModel.lockActiveAgent(connection, entry.agent_id);
      if (!agent) return 'invalid-agent';

      if (nextStatus === 'monitoring' && entry.status !== 'waiting') return 'invalid-transition';
      if (nextStatus === 'escalated' && !['waiting', 'monitoring'].includes(entry.status)) {
        return 'invalid-transition';
      }

      await supervisionModel.updateStatus(connection, id, nextStatus);
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

async function summary(req, res, next) {
  try {
    const row = await supervisionModel.summary();
    const summary = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value)])
    );
    return res.json({ summary });
  } catch (error) {
    return next(error);
  }
}

async function agents(req, res, next) {
  try {
    const agents = await supervisionModel.agents();
    return res.json({ agents });
  } catch (error) {
    return next(error);
  }
}

async function queue(req, res, next) {
  try {
    const queue = await supervisionModel.queue();
    return res.json({ queue });
  } catch (error) {
    return next(error);
  }
}

async function monitoring(req, res, next) {
  return updateQueueStatus(req, res, next, 'monitoring');
}

async function escalate(req, res, next) {
  return updateQueueStatus(req, res, next, 'escalated');
}

async function remove(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de cola inválido.' });

  try {
    const deleted = await runInTransaction(async (connection) => {
      const link = await supervisionModel.findLink(connection, id);
      if (!link) return false;
      if (link.call_id != null) {
        await supervisionModel.lockCall(connection, link.call_id);
      }
      return supervisionModel.remove(connection, id);
    });
    if (!deleted) return res.status(404).json({ message: 'Entrada de supervisión no encontrada.' });
    return res.json({ message: 'Entrada retirada de la cola.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { summary, agents, queue, monitoring, escalate, remove };
