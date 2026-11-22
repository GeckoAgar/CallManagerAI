const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('../src/config/env');

test('duración diaria filtra llamadas y respeta el período y los permisos', async () => {
  const database = `cm_dashboard_test_${randomBytes(8).toString('hex')}`;
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  let created = false;
  let server;
  let pool;
  try {
    await connection.query(`CREATE DATABASE \`${database}\``);
    created = true;
    await connection.changeUser({ database });
    const schema = await fs.readFile(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    const tables = schema.replace(/^\uFEFF?CREATE DATABASE IF NOT EXISTS callmanagerai;\s*USE callmanagerai;\s*/i, '');
    assert.notEqual(tables, schema);
    await connection.query(tables);

    process.env.DB_NAME = database;
    pool = require('../src/config/db').pool;
    const app = require('../src/app');
    await connection.query("INSERT INTO roles (name) VALUES ('OTHER')");
    await connection.query(
      `INSERT INTO users (name, email, password_hash, role_id)
       SELECT 'Prueba', ?, 'hash', id FROM roles WHERE name = ?`,
      ['admin@example.test', 'ADMIN']
    );
    for (const [email, role] of [
      ['agent@example.test', 'USER'], ['other@example.test', 'USER'],
      ['empty@example.test', 'USER'], ['forbidden@example.test', 'OTHER'],
    ]) {
      await connection.query(
        "INSERT INTO users (name, email, password_hash, role_id) SELECT 'Prueba', ?, 'hash', id FROM roles WHERE name = ?",
        [email, role]
      );
    }
    const [users] = await connection.query('SELECT id, email FROM users');
    const ids = Object.fromEntries(users.map((user) => [user.email, user.id]));
    const agent = ids['agent@example.test'];
    const other = ids['other@example.test'];
    for (const [agentId, status, duration, sid, daysAgo, seconds] of [
      [agent, 'completed', 30, null, 0, 0],
      [agent, 'completed', 91, 'CAreal', 0, 86399],
      [other, 'completed', 120, null, 0, 3600],
      [agent, 'completed', 0, null, 0, 3600],
      [agent, 'completed', -10, null, 0, 3600],
      [agent, 'completed', null, null, 0, 3600],
      [agent, 'failed', 400, null, 0, 3600],
      [agent, 'active', 400, null, 0, 3600],
      [agent, 'queued', 400, null, 0, 3600],
      [agent, 'completed', 3000, 'DEMO-CM-A1-20260101-CALL-001', 0, 3600],
      [other, 'completed', 61, null, 1, 3600],
      [agent, 'completed', 120, 'DEMO-CM-A1-20260101-CALL-002', 2, 3600],
      [agent, 'completed', 125, null, 6, 0],
      [agent, 'completed', 999, null, 7, 86399],
      [agent, 'completed', 999, null, -1, 0],
    ]) {
      await connection.query(
        `INSERT INTO calls (agent_id, status, duration_seconds, provider_call_sid, created_at)
         VALUES (?, ?, ?, ?, DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY), INTERVAL ? SECOND))`,
        [agentId, status, duration, sid, daysAgo, seconds]
      );
    }

    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/dashboard/summary`;
    async function request(id, query = '') {
      const headers = id ? { Authorization: `Bearer ${jwt.sign({ id, tokenVersion: 0 }, process.env.JWT_SECRET)}` } : {};
      const response = await fetch(`${url}${query}`, { headers });
      return { status: response.status, body: await response.json() };
    }
    const [[dates]] = await connection.query(
      `SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today,
              DATE_FORMAT(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), '%Y-%m-%d') AS yesterday,
              DATE_FORMAT(DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY), '%Y-%m-%d') AS firstDay`
    );
    const admin = await request(ids['admin@example.test']);
    assert.equal(admin.status, 200);
    const daily = admin.body.summary.averageDurationByDay;
    assert.equal(daily.length, 7);
    assert.equal(daily[0].date, dates.firstDay);
    assert.equal(daily[6].date, dates.today);
    assert.equal(daily[0].averageDurationSeconds, 125);
    assert.equal(daily[5].date, dates.yesterday);
    assert.equal(daily[5].averageDurationSeconds, 61);
    assert.equal(daily[4].averageDurationSeconds, 120);
    assert.equal(daily[6].averageDurationSeconds, (30 + 91 + 120 + 3000) / 4);
    assert.ok(daily.slice(1, 4).every((day) => day.averageDurationSeconds === null));
    assert.equal(admin.body.summary.callsByDay[6].totalCalls, 10);

    const user = await request(agent);
    assert.equal(user.status, 200);
    assert.ok(Math.abs(user.body.summary.averageDurationByDay[6].averageDurationSeconds - (30 + 91 + 3000) / 3) < 0.0001);
    assert.equal(user.body.summary.averageDurationByDay[5].averageDurationSeconds, null);
    assert.equal(user.body.summary.averageDurationByDay[4].averageDurationSeconds, 120);
    assert.equal(user.body.summary.averageDurationByDay[0].averageDurationSeconds, 125);
    const empty = await request(ids['empty@example.test']);
    assert.equal(empty.status, 200);
    assert.ok(empty.body.summary.averageDurationByDay.every((day) => day.averageDurationSeconds === null));
    assert.equal((await request(ids['forbidden@example.test'])).status, 403);
    assert.equal((await request()).status, 401);

    for (const [agentId, status, duration, createdAt] of [
      [agent, 'completed', 999, '2024-02-25 23:59:59'],
      [agent, 'completed', 100, '2024-02-26 00:00:00'],
      [agent, 'completed', 60, '2024-02-29 08:00:00'],
      [agent, 'completed', 120, '2024-02-29 08:59:59'],
      [other, 'completed', 300, '2024-02-29 08:30:00'],
      [agent, 'completed', 0, '2024-02-29 09:00:00'],
      [agent, 'failed', 70, '2024-02-29 15:00:00'],
      [agent, 'completed', 200, '2024-03-03 23:59:59'],
      [agent, 'completed', 999, '2024-03-04 00:00:00'],
    ]) {
      await connection.query(
        'INSERT INTO calls (agent_id, status, duration_seconds, created_at) VALUES (?, ?, ?, ?)',
        [agentId, status, duration, createdAt]
      );
    }

    const day = await request(ids['admin@example.test'], '?period=day&date=2024-02-29');
    assert.equal(day.status, 200);
    assert.equal(day.body.summary.period.granularity, 'hour');
    assert.equal(day.body.summary.totalCalls, 5);
    assert.equal(day.body.summary.completedCalls, 4);
    assert.equal(day.body.summary.failedCalls, 1);
    assert.equal(day.body.summary.averageDurationSeconds, 120);
    assert.equal(day.body.summary.callsByDay.length, 24);
    assert.equal(day.body.summary.callsByDay[8].date, '2024-02-29T08:00:00');
    assert.equal(day.body.summary.callsByDay[8].totalCalls, 3);
    assert.equal(day.body.summary.averageDurationByDay[8].averageDurationSeconds, 160);
    assert.equal(day.body.summary.averageDurationByDay[9].averageDurationSeconds, null);
    const userDay = await request(agent, '?period=day&date=2024-02-29');
    assert.equal(userDay.body.summary.totalCalls, 4);
    assert.equal(userDay.body.summary.averageDurationByDay[8].averageDurationSeconds, 90);

    const week = await request(ids['admin@example.test'], '?period=week&date=2024-02-29');
    assert.equal(week.body.summary.period.startDate, '2024-02-26');
    assert.equal(week.body.summary.period.endDate, '2024-03-03');
    assert.equal(week.body.summary.callsByDay.length, 7);
    assert.equal(week.body.summary.totalCalls, 7);
    assert.equal(week.body.summary.completedCalls, 6);
    assert.equal(week.body.summary.failedCalls, 1);
    assert.equal(week.body.summary.callsByDay[0].totalCalls, 1);
    assert.equal(week.body.summary.callsByDay[6].totalCalls, 1);
    assert.equal(week.body.summary.averageDurationByDay[3].averageDurationSeconds, 160);
    const userWeek = await request(agent, '?period=week&date=2024-02-29');
    assert.equal(userWeek.body.summary.totalCalls, 6);
    assert.equal(userWeek.body.summary.averageDurationByDay[3].averageDurationSeconds, 90);

    const month = await request(ids['admin@example.test'], '?period=month&date=2024-02-29');
    assert.equal(month.body.summary.period.startDate, '2024-02-01');
    assert.equal(month.body.summary.period.endDate, '2024-02-29');
    assert.equal(month.body.summary.callsByDay.length, 29);
    assert.equal(month.body.summary.totalCalls, 7);
    assert.equal(month.body.summary.averageDurationByDay[28].averageDurationSeconds, 160);
    const yearBoundary = await request(agent, '?period=week&date=2026-01-01');
    assert.equal(yearBoundary.body.summary.period.startDate, '2025-12-29');
    assert.equal(yearBoundary.body.summary.period.endDate, '2026-01-04');
    const emptyMonth = await request(ids['empty@example.test'], '?period=month&date=2024-02-01');
    assert.equal(emptyMonth.body.summary.totalCalls, 0);
    assert.ok(emptyMonth.body.summary.averageDurationByDay.every((item) => item.averageDurationSeconds === null));

    for (const query of [
      '?period=year', '?period=day', '?period=day&date=2023-02-29',
      '?period=month&date=2024-13-01', '?period=week&date=not-a-date',
      '?period=last7days&date=2024-02-29', '?period=day&date=2024-02-29&date=2024-03-01',
    ]) {
      assert.equal((await request(agent, query)).status, 400, query);
    }
    assert.equal((await request(ids['forbidden@example.test'], '?period=day&date=2024-02-29')).status, 403);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
