const { pool } = require('../config/db');

async function findLink(connection, id) {
  const [rows] = await connection.query('SELECT call_id FROM surveillance_queue WHERE id = ?', [id]);
  return rows[0];
}

async function lockCall(connection, id) {
  const [rows] = await connection.query('SELECT id, status FROM calls WHERE id = ? FOR UPDATE', [id]);
  return rows[0];
}

async function lockEntry(connection, id) {
  const [rows] = await connection.query(
    'SELECT id, agent_id, status FROM surveillance_queue WHERE id = ? FOR UPDATE', [id]
  );
  return rows[0];
}

async function lockActiveAgent(connection, id) {
  const [rows] = await connection.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? AND u.status = 'active' AND r.name = 'USER' FOR UPDATE`,
    [id]
  );
  return rows[0];
}

async function updateStatus(connection, id, status) {
  await connection.query('UPDATE surveillance_queue SET status = ? WHERE id = ?', [status, id]);
}

async function remove(connection, id) {
  const [result] = await connection.query('DELETE FROM surveillance_queue WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function removeByCall(connection, callId) {
  await connection.query('DELETE FROM surveillance_queue WHERE call_id = ?', [callId]);
}

async function upsertForCall(connection, callId, agentId, wasActive) {
  const statusUpdate = wasActive ? '' : ", status = 'waiting'";
  await connection.query(
    `INSERT INTO surveillance_queue (agent_id, call_id, status)
     VALUES (?, ?, 'waiting')
     ON DUPLICATE KEY UPDATE agent_id = ?${statusUpdate}`,
    [agentId, callId, agentId]
  );
}

async function summary() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS totalAgents,
            COUNT(CASE WHEN p.device_session_id IS NOT NULL
                            AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                            AND p.status = 'available' THEN 1 END) AS availableAgents,
            COUNT(CASE WHEN p.device_session_id IS NOT NULL
                            AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                            AND p.status = 'busy' THEN 1 END) AS busyAgents,
            COUNT(CASE WHEN p.device_session_id IS NULL
                            OR p.updated_at IS NULL
                            OR p.updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                            OR p.status = 'offline' THEN 1 END) AS offlineAgents,
            (SELECT COUNT(*) FROM calls WHERE status = 'active') AS activeCalls,
            (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'waiting') AS waitingCalls,
            (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'monitoring') AS monitoringCalls,
            (SELECT COUNT(*) FROM surveillance_queue WHERE status = 'escalated') AS escalatedCalls
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN agent_presence p ON p.user_id = u.id
     WHERE r.name = 'USER' AND u.status = 'active'`
  );
  return rows[0];
}

async function agents() {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email,
            CASE WHEN p.device_session_id IS NULL
                       OR p.updated_at IS NULL
                       OR p.updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                 THEN 'offline' ELSE p.status END AS status,
            p.updated_at AS updatedAt
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN agent_presence p ON p.user_id = u.id
     WHERE r.name = 'USER' AND u.status = 'active'
     ORDER BY u.name, u.id`
  );
  return rows;
}

async function queue() {
  const [rows] = await pool.query(
    `SELECT q.id, q.agent_id AS agentId, u.name AS agentName,
            q.call_id AS callId, c.phone_number AS phoneNumber,
            q.status, q.created_at AS createdAt
     FROM surveillance_queue q
     LEFT JOIN users u ON u.id = q.agent_id
     LEFT JOIN calls c ON c.id = q.call_id
     ORDER BY q.created_at DESC, q.id DESC`
  );
  return rows;
}

module.exports = {
  findLink, lockCall, lockEntry, lockActiveAgent, updateStatus, remove, removeByCall,
  upsertForCall, summary, agents, queue,
};
