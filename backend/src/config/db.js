require('./env');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'callmanagerai',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('MySQL connection successful.');
    return true;
  } catch (error) {
    console.error(`MySQL connection failed (${error.code || 'UNKNOWN'}): ${error.message}`);
    return false;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { pool, testConnection };
