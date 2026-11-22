const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('../src/config/env');

test('búsqueda y notificaciones respetan permisos y registran eventos reales', async () => {
  const database = `cm_notifications_test_${randomBytes(8).toString('hex')}`;
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
    const tables = schema
      .replace(/^\uFEFF?CREATE DATABASE IF NOT EXISTS callmanagerai;\s*USE callmanagerai;\s*/i, '')
      .replace(/CREATE TABLE IF NOT EXISTS notifications \([\s\S]*?\n\);\s*/, '');
    assert.notEqual(tables, schema);
    await connection.query(tables);
    const migration = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', '008_notifications.sql'), 'utf8');
    const testMigration = migration.replace('USE callmanagerai;', `USE \`${database}\`;`);
    await connection.query(testMigration);
    await connection.query(testMigration);

    process.env.DB_NAME = database;
    pool = require('../src/config/db').pool;
    const app = require('../src/app');
    const [roles] = await connection.query('SELECT id, name FROM roles');
    const roleIds = Object.fromEntries(roles.map((role) => [role.name, role.id]));
    const [users] = await connection.query(
      `INSERT INTO users (name, email, password_hash, role_id) VALUES
       ('Admin prueba', 'admin@example.test', 'hash', ?),
       ('Agente prueba', 'agent@example.test', 'hash', ?),
       ('Otro agente', 'other@example.test', 'hash', ?)`,
      [roleIds.ADMIN, roleIds.USER, roleIds.USER]
    );
    const [adminId, agentId, otherId] = [users.insertId, users.insertId + 1, users.insertId + 2];
    const [contacts] = await connection.query(
      "INSERT INTO contacts (owner_id, name, phone) VALUES (?, 'Contacto prueba', '123456'), (?, 'Contacto privado', '999999')",
      [agentId, otherId]
    );
    const contactId = contacts.insertId;
    const [calls] = await connection.query(
      "INSERT INTO calls (contact_id, agent_id, phone_number) VALUES (?, ?, '123456'), (?, ?, '999999')",
      [contactId, agentId, contactId + 1, otherId]
    );
    const [recordings] = await connection.query(
      "INSERT INTO recordings (call_id, file_name) VALUES (?, 'audio-prueba'), (?, 'audio-privado')",
      [calls.insertId, calls.insertId + 1]
    );

    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const token = (id) => jwt.sign({ id, tokenVersion: 0 }, process.env.JWT_SECRET);
    async function request(id, method, url, body) {
      const response = await fetch(`${base}${url}`, {
        method,
        headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    async function waitForCount(id, count) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = await request(id, 'GET', '/notifications');
        if (result.body.notifications.length === count) return result.body;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail(`No se registraron ${count} notificaciones para el usuario.`);
    }

    for (const [resource, term] of [
      ['/contacts', 'prueba'], ['/users', 'Agente prueba'], ['/roles', 'ADMIN'],
      ['/calls', '123456'], ['/recordings', 'audio-prueba'],
    ]) {
      const found = await request(adminId, 'GET', `${resource}?page=1&limit=10&search=${encodeURIComponent(term)}`);
      assert.equal(found.status, 200, resource);
      assert.ok(found.body.data.length, resource);
    }
    assert.equal((await request(adminId, 'GET', '/contacts?page=1&limit=10&search=sincoincidencias')).body.total, 0);
    for (const resource of ['/users', '/roles']) {
      assert.equal((await request(agentId, 'GET', `${resource}?page=1&limit=10&search=prueba`)).status, 403);
    }
    for (const resource of ['/contacts', '/calls', '/recordings']) {
      assert.equal((await request(agentId, 'GET', `${resource}?page=1&limit=10&search=privado`)).body.total, 0);
      assert.equal((await request(agentId, 'GET', `${resource}?page=1&limit=10&search=999999`)).body.total, 0);
    }
    assert.equal((await request(agentId, 'GET', '/notifications')).body.unreadCount, 0);
    assert.equal((await request(otherId, 'DELETE', `/contacts/${contactId}`)).status, 404);
    assert.equal((await request(agentId, 'DELETE', `/contacts/${contactId}`)).status, 200);
    const agentNotifications = await waitForCount(agentId, 1);
    assert.equal(agentNotifications.unreadCount, 1);
    assert.equal(agentNotifications.notifications[0].message, 'Se eliminó un contacto.');
    const notificationId = agentNotifications.notifications[0].id;
    assert.equal((await request(otherId, 'GET', '/notifications')).body.notifications.length, 0);
    assert.equal((await request(otherId, 'PATCH', `/notifications/${notificationId}/read`)).status, 404);
    assert.equal((await request(adminId, 'DELETE', `/notifications/${notificationId}`)).status, 404);
    assert.equal((await request(agentId, 'PATCH', `/notifications/${notificationId}/read`)).status, 200);
    assert.equal((await request(agentId, 'GET', '/notifications')).body.unreadCount, 0);
    assert.equal((await request(adminId, 'POST', `/contacts/${contactId}/restore`)).status, 200);
    const createdRole = await request(adminId, 'POST', '/roles', { name: 'EQUIPO' });
    assert.equal(createdRole.status, 201);
    const adminNotifications = await waitForCount(adminId, 2);
    assert.equal(adminNotifications.unreadCount, 2);
    assert.deepEqual(new Set(adminNotifications.notifications.map((item) => item.message)), new Set(['Se restauró un contacto.', 'Se creó un rol.']));
    assert.equal((await request(adminId, 'PATCH', '/notifications/read-all')).status, 200);
    assert.equal((await request(adminId, 'GET', '/notifications')).body.unreadCount, 0);
    assert.equal((await request(agentId, 'DELETE', `/notifications/${notificationId}`)).status, 200);
    assert.equal((await request(agentId, 'GET', '/notifications')).body.notifications.length, 0);
    assert.equal((await request(adminId, 'GET', '/notifications')).body.notifications.length, 2);
    assert.equal((await request(agentId, 'PATCH', '/notifications/0/read')).status, 400);
    assert.equal((await request(adminId, 'PATCH', `/roles/${createdRole.body.role.id}`, { description: 'Actualizado' })).status, 200);
    assert.equal((await request(adminId, 'DELETE', `/roles/${createdRole.body.role.id}`)).status, 200);
    const createdUser = await request(adminId, 'POST', '/users', {
      name: 'Temporal', email: 'temporary@example.test', password: 'testing123', role_id: roleIds.USER,
    });
    assert.equal(createdUser.status, 201);
    assert.equal((await request(adminId, 'PATCH', `/users/${createdUser.body.user.id}`, { name: 'Temporal actualizado' })).status, 200);
    assert.equal((await request(adminId, 'DELETE', `/users/${createdUser.body.user.id}`)).status, 200);
    const adminEvents = await waitForCount(adminId, 7);
    for (const message of ['Se actualizó un rol.', 'Se eliminó un rol.', 'Se creó un usuario.', 'Se actualizó un usuario.', 'Se eliminó un usuario.']) {
      assert.ok(adminEvents.notifications.some((item) => item.message === message), message);
    }
    assert.equal((await request(agentId, 'DELETE', `/recordings/${recordings.insertId}`)).status, 200);
    assert.equal((await request(agentId, 'DELETE', `/calls/${calls.insertId}`)).status, 200);
    const agentEvents = await waitForCount(agentId, 2);
    assert.deepEqual(new Set(agentEvents.notifications.map((item) => item.message)), new Set(['Se eliminó una grabación.', 'Se eliminó una llamada.']));
    for (const item of agentEvents.notifications) {
      assert.equal((await request(agentId, 'DELETE', `/notifications/${item.id}`)).status, 200);
    }
    const values = Array.from({ length: 52 }, () => [agentId, 'info', 'Evento de prueba']);
    await connection.query('INSERT INTO notifications (user_id, type, message) VALUES ?', [values]);
    const firstPage = (await request(agentId, 'GET', '/notifications')).body;
    assert.equal(firstPage.notifications.length, 50);
    assert.equal(firstPage.unreadCount, 52);
    const secondPage = (await request(agentId, 'GET', `/notifications?before=${firstPage.nextBefore}`)).body;
    assert.equal(secondPage.notifications.length, 2);
    assert.equal(secondPage.nextBefore, null);
    assert.ok(secondPage.notifications.every((item) => item.id < firstPage.nextBefore));
    assert.equal((await request(otherId, 'GET', `/notifications?before=${firstPage.nextBefore}`)).body.notifications.length, 0);
    assert.equal((await request(agentId, 'GET', '/notifications?before=0')).status, 400);
    assert.equal((await request(agentId, 'POST', '/auth/logout')).status, 200);
    assert.equal((await request(agentId, 'GET', '/notifications')).status, 401);
    let logoutRecorded = false;
    for (let attempt = 0; attempt < 50 && !logoutRecorded; attempt += 1) {
      const [[count]] = await connection.query("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND message = 'Se cerró la sesión.'", [agentId]);
      logoutRecorded = count.total === 1;
      if (!logoutRecorded) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(logoutRecorded);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
