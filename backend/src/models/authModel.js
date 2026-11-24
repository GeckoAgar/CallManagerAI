const { pool } = require('../config/db');

async function findUserById(id) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.status, u.role_id, u.token_version, r.name AS role_name
     FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id]
  );
  return rows[0];
}

async function findUserIdByEmail(email) {
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0];
}

async function findRoleByName(name) {
  const [rows] = await pool.query('SELECT * FROM roles WHERE name = ? LIMIT 1', [name]);
  return rows[0];
}

async function createUser(name, email, passwordHash, roleId) {
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
    [name, email, passwordHash, roleId, 'active']
  );
  return result.insertId;
}

async function findUserForLogin(email) {
  const [rows] = await pool.query(
    `SELECT u.*, r.name AS role_name FROM users u
     LEFT JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
    [email]
  );
  return rows[0];
}

async function invalidateSession(connection, userId) {
  await connection.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  await connection.query(
    `UPDATE agent_presence SET status = 'offline', device_session_id = NULL WHERE user_id = ?`,
    [userId]
  );
}

module.exports = { findUserById, findUserIdByEmail, findRoleByName, createUser, findUserForLogin, invalidateSession };
