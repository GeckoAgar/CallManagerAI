const { pool } = require('../config/db');

function searchFilter(search) {
  const clause = search ? ' AND (u.name LIKE ? OR u.email LIKE ?)' : '';
  const pattern = `%${search}%`;
  return { clause, values: search ? [pattern, pattern] : [] };
}

async function count(search) {
  const filter = searchFilter(search);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id WHERE 1 = 1${filter.clause}`,
    filter.values
  );
  return Number(row.total);
}

async function list(search, pagination) {
  const filter = searchFilter(search);
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE 1 = 1${filter.clause}
     ORDER BY u.id DESC${pagination ? ' LIMIT ? OFFSET ?' : ''}`,
    pagination ? [...filter.values, pagination.limit, pagination.offset] : filter.values
  );
  return rows;
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id]
  );
  return rows[0];
}

async function create(user) {
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
    [user.name, user.email, user.password_hash, user.role_id, user.status]
  );
  return result.insertId;
}

async function lockStatus(connection, userId) {
  const [rows] = await connection.query(
    `SELECT u.status, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? FOR UPDATE`,
    [userId]
  );
  return rows[0];
}

async function findRole(connection, roleId) {
  const [rows] = await connection.query('SELECT name FROM roles WHERE id = ?', [roleId]);
  return rows[0];
}

async function lockOtherActiveAdmins(connection, userId) {
  const [rows] = await connection.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'ADMIN' AND u.status = 'active' AND u.id <> ? FOR UPDATE`,
    [userId]
  );
  return rows.length;
}

async function update(connection, id, fields) {
  const assignments = [];
  const values = [];
  for (const field of ['name', 'email', 'role_id', 'status', 'password_hash']) {
    if (Object.hasOwn(fields, field)) {
      assignments.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (Object.hasOwn(fields, 'password_hash')) assignments.push('token_version = token_version + 1');
  await connection.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, [...values, id]);
}

async function remove(connection, id) {
  const [result] = await connection.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = { count, list, findById, create, lockStatus, findRole, lockOtherActiveAdmins, update, remove };
