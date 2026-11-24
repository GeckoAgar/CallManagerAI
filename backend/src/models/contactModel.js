const { pool } = require('../config/db');

function accessFilter(user, alias = 'c') {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ` AND ${alias ? `${alias}.` : ''}owner_id = ?`, values: [user.id] };
}

function listFilter(user, deleted, search) {
  const access = accessFilter(user);
  const deletion = deleted ? 'c.deleted_at IS NOT NULL' : 'c.deleted_at IS NULL';
  const searchClause = search ? ' AND (c.name LIKE ? OR c.company LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)' : '';
  const pattern = `%${search}%`;
  return {
    clause: `${deletion}${access.clause}${searchClause}`,
    values: [...access.values, ...(search ? [pattern, pattern, pattern, pattern] : [])],
  };
}

async function count(user, deleted, search) {
  const filter = listFilter(user, deleted, search);
  const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM contacts c WHERE ${filter.clause}`, filter.values);
  return Number(row.total);
}

async function list(user, deleted, search, pagination) {
  const filter = listFilter(user, deleted, search);
  const [contacts] = await pool.query(
    `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at, c.deleted_at,
            u.name AS owner_name
     FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
     WHERE ${filter.clause}
     ORDER BY c.id DESC${pagination ? ' LIMIT ? OFFSET ?' : ''}`,
    pagination ? [...filter.values, pagination.limit, pagination.offset] : filter.values
  );
  return contacts;
}

async function findById(id, user) {
  const filter = user ? accessFilter(user) : { clause: '', values: [] };
  const [rows] = await pool.query(
    `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at,
            u.name AS owner_name
     FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.id = ?${user ? ' AND c.deleted_at IS NULL' : ''}${filter.clause}`,
    [id, ...filter.values]
  );
  return rows[0];
}

async function create(contact) {
  const [result] = await pool.query(
    `INSERT INTO contacts (owner_id, name, company, phone, email, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contact.owner_id, contact.name, contact.company, contact.phone, contact.email, contact.status]
  );
  return result.insertId;
}

async function update(id, user, fields) {
  const filter = accessFilter(user, '');
  const assignments = [];
  const values = [];
  for (const field of ['name', 'company', 'phone', 'email', 'status', 'owner_id']) {
    if (Object.hasOwn(fields, field)) {
      assignments.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  const [result] = await pool.query(
    `UPDATE contacts SET ${assignments.join(', ')} WHERE id = ? AND deleted_at IS NULL${filter.clause}`,
    [...values, id, ...filter.values]
  );
  return result.affectedRows;
}

async function remove(id, user) {
  const filter = accessFilter(user, '');
  const [result] = await pool.query(
    `UPDATE contacts SET status = 'inactive', deleted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL${filter.clause}`,
    [id, ...filter.values]
  );
  return result.affectedRows;
}

async function restore(id) {
  const [result] = await pool.query(
    "UPDATE contacts SET status = 'active', deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL",
    [id]
  );
  return result.affectedRows;
}

module.exports = { count, list, findById, create, update, remove, restore };
