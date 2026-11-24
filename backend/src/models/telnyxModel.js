const { pool } = require('../config/db');

async function finishCall(connection, call, status) {
  await connection.query(
    `UPDATE calls SET status = ?,
       duration_seconds = CASE WHEN ? = 'completed' AND ? IS NOT NULL
         THEN GREATEST(TIMESTAMPDIFF(SECOND, ?, UTC_TIMESTAMP()), 0) ELSE 0 END
     WHERE id = ?`,
    [status, status, call.started_at, call.started_at, call.id]
  );
  await connection.query("UPDATE telnyx_outbound_calls SET phase = 'finished' WHERE call_id = ?", [call.id]);
}

async function releaseAgent(connection, call) {
  await connection.query(
    `UPDATE agent_presence SET status = 'available', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    [call.agent_id, call.agent_device_session_id]
  );
}

async function lockReservation(connection, reservation) {
  const [rows] = await connection.query(
    `SELECT c.id, c.phone_number, c.agent_id, c.agent_device_session_id, c.status,
            t.phase, t.started_at, t.call_control_id
     FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
     WHERE t.reservation_id = ? FOR UPDATE`,
    [reservation]
  );
  return rows[0];
}

async function lockBusyAgent(connection, userId, sessionId) {
  const [rows] = await connection.query(
    `SELECT user_id FROM agent_presence
     WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) FOR UPDATE`,
    [userId, sessionId]
  );
  return rows[0];
}

async function markTransferring(connection, id, controlId, sessionId) {
  await connection.query(
    `UPDATE telnyx_outbound_calls SET phase = 'transferring',
       call_control_id = ?, call_session_id = ? WHERE call_id = ?`,
    [controlId, sessionId, id]
  );
}

async function lockTransfer(connection, callId) {
  const [rows] = await connection.query(
    `SELECT c.phone_number, t.phase FROM telnyx_outbound_calls t
     JOIN calls c ON c.id = t.call_id WHERE t.call_id = ? FOR UPDATE`,
    [callId]
  );
  return rows[0];
}

async function lockCall(connection, callId) {
  const [rows] = await connection.query(
    `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id, t.phase, t.started_at
     FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
     WHERE t.call_id = ? FOR UPDATE`,
    [callId]
  );
  return rows[0];
}

async function lockSession(connection, sessionId) {
  const [rows] = await connection.query(
    `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id,
            t.phase, t.started_at, t.call_control_id
     FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
     WHERE t.call_session_id = ? FOR UPDATE`,
    [sessionId]
  );
  return rows[0];
}

async function markActive(connection, callId) {
  await connection.query(
    "UPDATE telnyx_outbound_calls SET phase = 'active', started_at = UTC_TIMESTAMP() WHERE call_id = ?",
    [callId]
  );
  await connection.query("UPDATE calls SET status = 'active' WHERE id = ?", [callId]);
}

async function availableAgent(userId, sessionId, connection = pool, lock = false) {
  const [rows] = await connection.query(
    `SELECT user_id FROM agent_presence WHERE user_id = ? AND device_session_id = ?
     AND status = 'available' AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)${lock ? ' FOR UPDATE' : ''}`,
    [userId, sessionId]
  );
  return rows[0];
}

async function createReservation(connection, userId, sessionId, phoneNumber, reservation) {
  const [call] = await connection.query(
    `INSERT INTO calls (agent_id, agent_device_session_id, phone_number, direction, status, provider_call_sid)
     VALUES (?, ?, ?, 'outbound', 'queued', ?)`,
    [userId, sessionId, phoneNumber, reservation]
  );
  await connection.query(
    'INSERT INTO telnyx_outbound_calls (call_id, reservation_id) VALUES (?, ?)',
    [call.insertId, reservation]
  );
  await connection.query(
    "UPDATE agent_presence SET status = 'busy', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
    [userId]
  );
  return call.insertId;
}

async function getStatus(reservation, userId) {
  const [rows] = await pool.query(
    `SELECT c.status, c.duration_seconds FROM calls c
     JOIN telnyx_outbound_calls t ON t.call_id = c.id
     WHERE t.reservation_id = ? AND c.agent_id = ?`,
    [reservation, userId]
  );
  return rows[0];
}

async function lockOwnedReservation(connection, reservation, userId) {
  const [rows] = await connection.query(
    `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id,
            t.phase, t.started_at, t.call_control_id
     FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
     WHERE t.reservation_id = ? AND c.agent_id = ? FOR UPDATE`,
    [reservation, userId]
  );
  return rows[0];
}

module.exports = {
  finishCall, releaseAgent, lockReservation, lockBusyAgent, markTransferring,
  lockTransfer, lockCall, lockSession, markActive, availableAgent, createReservation,
  getStatus, lockOwnedReservation,
};
