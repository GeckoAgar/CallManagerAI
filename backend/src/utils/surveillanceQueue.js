const { pool } = require('../config/db');

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
    await connection.query('DELETE FROM surveillance_queue WHERE call_id = ?', [callId]);
    return;
  }

  const wasActive = previousStatus === 'active';
  const agentChanged = String(previousAgentId ?? '') !== String(agentId ?? '');
  const numericAgentId = Number(agentId);
  const [agents] = Number.isSafeInteger(numericAgentId) && numericAgentId > 0
    ? await connection.query(
      `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.status = 'active' AND r.name = 'USER'
       FOR UPDATE`,
      [numericAgentId]
    )
    : [[]];

  if (!agents.length) {
    await connection.query('DELETE FROM surveillance_queue WHERE call_id = ?', [callId]);
    return;
  }

  if (wasActive && !agentChanged) return;

  const statusUpdate = wasActive ? '' : ", status = 'waiting'";
  await connection.query(
    `INSERT INTO surveillance_queue (agent_id, call_id, status)
     VALUES (?, ?, 'waiting')
     ON DUPLICATE KEY UPDATE agent_id = ?${statusUpdate}`,
    [numericAgentId, callId, numericAgentId]
  );
}

module.exports = { runInTransaction, syncSurveillanceQueueForCall };
