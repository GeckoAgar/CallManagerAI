const { pool } = require('../config/db');

const validDurationAverage = `COALESCE(AVG(CASE
  WHEN c.status = 'completed'
    AND c.duration_seconds IS NOT NULL
    AND c.duration_seconds >= 0
  THEN c.duration_seconds
END), 0)`;

function callAccessFilter(user) {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ' AND c.agent_id = ?', values: [user.id] };
}

async function summary(user) {
  const filter = callAccessFilter(user);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS totalCalls,
            COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
            COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
            ${validDurationAverage} AS averageDurationSeconds
     FROM calls c
     WHERE 1 = 1${filter.clause}`,
    filter.values
  );
  return rows[0];
}

async function today() {
  const [[row]] = await pool.query("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today");
  return row.today;
}

async function callsByDay(user) {
  const filter = callAccessFilter(user);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(c.created_at, '%Y-%m-%d') AS date,
            COUNT(*) AS totalCalls,
            COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
            COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls
     FROM calls c
     WHERE c.created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
       AND c.created_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)${filter.clause}
     GROUP BY DATE_FORMAT(c.created_at, '%Y-%m-%d')
     ORDER BY date`,
    filter.values
  );
  return rows;
}

async function byAgent(user) {
  const userFilter = user.roleName === 'ADMIN' ? '' : ' WHERE u.id = ?';
  const values = user.roleName === 'ADMIN' ? [] : [user.id];
  const [agents] = await pool.query(
    `SELECT u.id AS agentId, u.name AS agentName,
            COUNT(c.id) AS totalCalls,
            COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
            COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
            ${validDurationAverage} AS averageDurationSeconds
     FROM users u
     LEFT JOIN calls c ON c.agent_id = u.id
     ${userFilter}
     GROUP BY u.id, u.name
     ORDER BY u.name, u.id`,
    values
  );
  return agents;
}

async function recordings(user) {
  const [rows] = await pool.query(
    `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at
     FROM recordings r
     JOIN calls c ON c.id = r.call_id
     WHERE (? = 'ADMIN' OR c.agent_id = ?)
     ORDER BY r.id DESC`,
    [user.roleName, user.id]
  );
  return rows;
}

module.exports = { summary, today, callsByDay, byAgent, recordings };
