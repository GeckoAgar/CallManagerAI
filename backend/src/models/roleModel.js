const { pool } = require('../config/db');

function searchFilter(search) {
  const searchClause = search ? ' WHERE name LIKE ? OR description LIKE ?' : '';
  const pattern = `%${search}%`;
  const values = search ? [pattern, pattern] : [];
  return { searchClause, values };
}

async function count(search) {
  const { searchClause, values } = searchFilter(search);
  const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM roles${searchClause}`, values);
  return Number(row.total);
}

async function list(search, pagination) {
  if (!pagination) {
    const [roles] = await pool.query('SELECT id, name, description, created_at FROM roles ORDER BY id ASC');
    return roles;
  }
  const { searchClause, values } = searchFilter(search);
  const [roles] = await pool.query(
    `SELECT id, name, description, created_at FROM roles
     ${searchClause} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...values, pagination.limit, pagination.offset]
  );
  return roles;
}

async function findById(id) {
  const [rows] = await pool.query('SELECT id, name, description, created_at FROM roles WHERE id = ?', [id]);
  return rows[0];
}

async function create(name, description) {
  const [result] = await pool.query(
    'INSERT INTO roles (name, description) VALUES (?, ?)',
    [name, description]
  );
  return result.insertId;
}

async function update(id, fields) {
  const assignments = [];
  const values = [];
  if (Object.hasOwn(fields, 'name')) { assignments.push('name = ?'); values.push(fields.name); }
  if (Object.hasOwn(fields, 'description')) { assignments.push('description = ?'); values.push(fields.description); }
  await pool.query(`UPDATE roles SET ${assignments.join(', ')} WHERE id = ?`, [...values, id]);
}

async function remove(id) {
  await pool.query('DELETE FROM roles WHERE id = ?', [id]);
}

module.exports = { count, list, findById, create, update, remove };
