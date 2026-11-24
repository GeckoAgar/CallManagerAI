const { pool } = require('../config/db');

function accessFilter(user) {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ' AND c.agent_id = ?', values: [user.id] };
}

function listFilter(user, search) {
  const access = accessFilter(user);
  const searchClause = search ? ' AND (r.file_name LIKE ? OR r.transcription LIKE ?)' : '';
  const pattern = `%${search}%`;
  return { clause: access.clause + searchClause, values: [...access.values, ...(search ? [pattern, pattern] : [])] };
}

async function count(user, search) {
  const filter = listFilter(user, search);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM recordings r JOIN calls c ON c.id = r.call_id
     WHERE 1 = 1${filter.clause}`,
    filter.values
  );
  return Number(row.total);
}

async function list(user, search, pagination) {
  const filter = listFilter(user, search);
  const [rows] = await pool.query(
    `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
            c.phone_number, c.agent_id
     FROM recordings r JOIN calls c ON c.id = r.call_id
     WHERE 1 = 1${filter.clause}
     ORDER BY r.id DESC${pagination ? ' LIMIT ? OFFSET ?' : ''}`,
    pagination ? [...filter.values, pagination.limit, pagination.offset] : filter.values
  );
  return rows;
}

async function findById(id, user) {
  const filter = user ? accessFilter(user) : { clause: '', values: [] };
  const [rows] = await pool.query(
    `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
            c.phone_number, c.agent_id
     FROM recordings r JOIN calls c ON c.id = r.call_id
     WHERE r.id = ?${filter.clause}`,
    [id, ...filter.values]
  );
  return rows[0];
}

async function canAccessCall(callId, user) {
  const [rows] = await pool.query(
    `SELECT id FROM calls WHERE id = ?${user.roleName === 'ADMIN' ? '' : ' AND agent_id = ?'}`,
    user.roleName === 'ADMIN' ? [callId] : [callId, user.id]
  );
  return rows.length > 0;
}

async function create(recording) {
  const [result] = await pool.query(
    `INSERT INTO recordings (call_id, file_name, url, duration_seconds, transcription)
     VALUES (?, ?, ?, ?, ?)`,
    [recording.call_id, recording.file_name, recording.url, recording.duration_seconds, recording.transcription]
  );
  return result.insertId;
}

async function update(id, fields) {
  const assignments = [];
  const values = [];
  for (const field of ['call_id', 'file_name', 'url', 'duration_seconds', 'transcription']) {
    if (Object.hasOwn(fields, field)) {
      assignments.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  await pool.query(`UPDATE recordings SET ${assignments.join(', ')} WHERE id = ?`, [...values, id]);
}

async function remove(id, user) {
  const filter = accessFilter(user);
  const [result] = await pool.query(
    `DELETE r FROM recordings r JOIN calls c ON c.id = r.call_id
     WHERE r.id = ?${filter.clause}`,
    [id, ...filter.values]
  );
  return result.affectedRows;
}

module.exports = { count, list, findById, canAccessCall, create, update, remove };
