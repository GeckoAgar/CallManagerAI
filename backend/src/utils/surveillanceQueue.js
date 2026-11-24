const { pool } = require('../config/db');
const supervisionModel = require('../models/supervisionModel');

async function runInTransaction(work) {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Failed to roll back database transaction:', rollbackError);
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function syncSurveillanceQueueForCall(connection, {
  callId,
  previousStatus,
  previousAgentId,
  status,
  agentId,
}) {
  if (status !== 'active') {
    await supervisionModel.removeByCall(connection, callId);
    return;
  }

  const wasActive = previousStatus === 'active';
  const agentChanged = String(previousAgentId ?? '') !== String(agentId ?? '');
  const numericAgentId = Number(agentId);
  const agent = Number.isSafeInteger(numericAgentId) && numericAgentId > 0
    ? await supervisionModel.lockActiveAgent(connection, numericAgentId)
    : null;

  if (!agent) {
    await supervisionModel.removeByCall(connection, callId);
    return;
  }

  if (wasActive && !agentChanged) return;

  await supervisionModel.upsertForCall(connection, callId, numericAgentId, wasActive);
}

module.exports = { runInTransaction, syncSurveillanceQueueForCall };
