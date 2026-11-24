const { pool } = require('../config/db');

async function create(userId, type, message) {
  await pool.query(
    'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)',
    [userId, type, message]
  );
}

async function list(userId, before) {
  const [notifications] = await pool.query(
    `SELECT id, type, message, read_at, created_at
     FROM notifications WHERE user_id = ?${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT 50`,
    before ? [userId, Number(before)] : [userId]
  );
  return notifications;
}

async function unreadCount(userId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
  return Number(row.unreadCount);
}

async function readAll(userId) {
  await pool.query(
    'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
}

async function read(id, userId) {
  const [result] = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.affectedRows;
}

async function remove(id, userId) {
  const [result] = await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows;
}

module.exports = { create, list, unreadCount, readAll, read, remove };
