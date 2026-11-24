const { pool } = require('../config/db');

async function getPresence(userId) {
  const [rows] = await pool.query(
    `SELECT CASE WHEN device_session_id IS NULL
                       OR updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                 THEN 'offline' ELSE status END AS status,
            CASE WHEN device_session_id IS NOT NULL
                       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                 THEN TRUE ELSE FALSE END AS deviceRegistered,
            updated_at
     FROM agent_presence WHERE user_id = ?`,
    [userId]
  );
  return rows[0];
}

async function ensurePresence(connection, userId) {
  await connection.query(
    `INSERT INTO agent_presence (user_id, status, device_session_id)
     VALUES (?, 'offline', NULL) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [userId]
  );
}

async function lockPresence(connection, userId) {
  const [rows] = await connection.query(
    `SELECT device_session_id, status,
            updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) AS is_fresh
     FROM agent_presence WHERE user_id = ? FOR UPDATE`,
    [userId]
  );
  return rows[0];
}

async function registerDevice(connection, userId, sessionId, status) {
  await connection.query(
    `UPDATE agent_presence SET status = ?, device_session_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [status, sessionId, userId]
  );
}

async function expireDevice(connection, userId, sessionId) {
  await connection.query(
    `UPDATE agent_presence SET status = 'offline', device_session_id = NULL
     WHERE user_id = ? AND device_session_id = ?`,
    [userId, sessionId]
  );
}

async function heartbeat(connection, userId, sessionId) {
  const [result] = await connection.query(
    `UPDATE agent_presence SET updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND device_session_id = ?
       AND status IN ('available', 'busy')
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    [userId, sessionId]
  );
  return result.affectedRows;
}

async function setOffline(userId, sessionId) {
  await pool.query(
    `UPDATE agent_presence SET status = 'offline', device_session_id = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?${sessionId ? ' AND device_session_id = ?' : ''}`,
    sessionId ? [userId, sessionId] : [userId]
  );
}

async function setPresence(userId, sessionId, status) {
  const [result] = await pool.query(
    `UPDATE agent_presence SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND device_session_id = ?
       AND status IN ('available', 'busy')
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    [status, userId, sessionId]
  );
  return result.affectedRows;
}

module.exports = { getPresence, ensurePresence, lockPresence, registerDevice, expireDevice, heartbeat, setOffline, setPresence };
