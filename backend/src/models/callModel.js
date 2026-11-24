const { pool } = require('../config/db');

function accessFilter(user, alias = 'c') {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ` AND ${alias ? `${alias}.` : ''}agent_id = ?`, values: [user.id] };
}

function listFilter(user, search) {
  const access = accessFilter(user);
  const searchClause = search ? ' AND (c.phone_number LIKE ? OR ct.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)' : '';
  const pattern = `%${search}%`;
  return { clause: access.clause + searchClause, values: [...access.values, ...(search ? [pattern, pattern, pattern, pattern] : [])] };
}

async function count(user, search) {
  const filter = listFilter(user, search);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM calls c
     LEFT JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.agent_id
     WHERE 1 = 1${filter.clause}`,
    filter.values
  );
  return Number(row.total);
}

async function list(user, search, pagination) {
  const filter = listFilter(user, search);
  const [rows] = await pool.query(
    `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
            c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
     FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.agent_id
     WHERE 1 = 1${filter.clause}
     ORDER BY c.id DESC${pagination ? ' LIMIT ? OFFSET ?' : ''}`,
    pagination ? [...filter.values, pagination.limit, pagination.offset] : filter.values
  );
  return rows;
}

async function findById(id, user, connection = pool) {
  const filter = user ? accessFilter(user) : { clause: '', values: [] };
  const [rows] = await connection.query(
    `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
            c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
     FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.agent_id
     WHERE c.id = ?${filter.clause}`,
    [id, ...filter.values]
  );
  return rows[0];
}

async function canAccessContact(connection, contactId, user) {
  if (contactId == null || contactId === '') return true;
  const [rows] = await connection.query(
    `SELECT id FROM contacts WHERE id = ? AND deleted_at IS NULL${user.roleName === 'ADMIN' ? '' : ' AND owner_id = ?'} FOR UPDATE`,
    user.roleName === 'ADMIN' ? [contactId] : [contactId, user.id]
  );
  return rows.length > 0;
}

async function create(connection, call) {
  const [result] = await connection.query(
    `INSERT INTO calls (contact_id, agent_id, phone_number, direction, status, duration_seconds, score)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [call.contact_id, call.agent_id, call.phone_number, call.direction, call.status, call.duration_seconds, call.score]
  );
  return result.insertId;
}

async function lockById(connection, id, user) {
  const filter = accessFilter(user, '');
  const [rows] = await connection.query(
    `SELECT id, contact_id, agent_id, status FROM calls WHERE id = ?${filter.clause} FOR UPDATE`,
    [id, ...filter.values]
  );
  return rows[0];
}

async function update(connection, id, user, fields) {
  const filter = accessFilter(user, '');
  const assignments = [];
  const values = [];
  for (const field of ['contact_id', 'agent_id', 'phone_number', 'direction', 'status', 'duration_seconds', 'score']) {
    if (Object.hasOwn(fields, field)) {
      assignments.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  await connection.query(
    `UPDATE calls SET ${assignments.join(', ')} WHERE id = ?${filter.clause}`,
    [...values, id, ...filter.values]
  );
}

async function remove(connection, id, user) {
  const filter = accessFilter(user, '');
  await connection.query('DELETE FROM surveillance_queue WHERE call_id = ?', [id]);
  const [result] = await connection.query(`DELETE FROM calls WHERE id = ?${filter.clause}`, [id, ...filter.values]);
  return result.affectedRows > 0;
}

module.exports = { count, list, findById, canAccessContact, create, lockById, update, remove };
