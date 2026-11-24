const { pool } = require('../config/db');

function rangeFilter(user, period) {
  return {
    clause: user.roleName === 'ADMIN' ? '' : ' AND c.agent_id = ?',
    values: [period.startDate, period.endExclusive, ...(user.roleName === 'ADMIN' ? [] : [user.id])],
  };
}

async function today() {
  const [[row]] = await pool.query("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today");
  return row.today;
}

async function summary(user, period) {
  const filter = rangeFilter(user, period);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS totalCalls,
            COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls,
            COUNT(CASE WHEN c.status = 'failed' THEN 1 END) AS failedCalls,
            COALESCE(AVG(CASE
              WHEN c.status = 'completed'
                AND c.duration_seconds IS NOT NULL
                AND c.duration_seconds >= 0
              THEN c.duration_seconds
            END), 0) AS averageDurationSeconds
     FROM calls c
     WHERE c.created_at >= ? AND c.created_at < ?${filter.clause}`,
    filter.values
  );
  return row;
}

async function dailyCounts(user, period, dateFormat) {
  const filter = rangeFilter(user, period);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(c.created_at, ?) AS date,
            COUNT(*) AS totalCalls,
            COUNT(CASE WHEN c.status = 'completed' THEN 1 END) AS completedCalls
     FROM calls c
     WHERE c.created_at >= ? AND c.created_at < ?${filter.clause}
     GROUP BY date
     ORDER BY date`,
    [dateFormat, ...filter.values]
  );
  return rows;
}

async function dailyDurations(user, period, dateFormat) {
  const filter = rangeFilter(user, period);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(c.created_at, ?) AS date,
            AVG(c.duration_seconds) AS averageDurationSeconds
     FROM calls c
     WHERE c.created_at >= ? AND c.created_at < ?
       AND c.status = 'completed'
       AND c.duration_seconds > 0${filter.clause}
     GROUP BY date
     ORDER BY date`,
    [dateFormat, ...filter.values]
  );
  return rows;
}

module.exports = { today, summary, dailyCounts, dailyDurations };
