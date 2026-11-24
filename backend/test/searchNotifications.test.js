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

    for (const [method, url, body, message] of [
      ['POST', '/contacts', { name: '' }, 'El nombre del contacto es obligatorio.'],
      ['PATCH', `/contacts/${contactId}`, { status: 'deleted' }, 'Estado inválido.'],
      ['POST', '/calls', { phone_number: '123', score: 101 }, 'La calificación debe estar entre 0 y 100.'],
      ['POST', '/recordings', { call_id: calls.insertId, file_name: 'audio', url: 'ftp://example.test' }, 'La URL debe usar HTTP o HTTPS.'],
      ['PATCH', `/users/${agentId}`, { role_id: 0 }, 'Rol inválido.'],
      ['POST', '/roles', { name: '1invalid' }, 'Nombre de rol (2-50 caracteres, letras, números y _) y descripción válidos son obligatorios.'],
      ['PATCH', '/softphone/presence/register', { deviceSessionId: 'invalid' }, 'Identificador de sesión del dispositivo inválido.'],
    ]) {
      const invalid = await request(adminId, method, url, body);
      assert.equal(invalid.status, 400, url);
      assert.equal(invalid.body.message, message, url);
    }
    const invalidLogin = await request(adminId, 'POST', '/auth/login', { email: 'malo', password: '' });
    assert.equal(invalidLogin.status, 400);
    assert.deepEqual(invalidLogin.body.errors.map((error) => error.path), ['email', 'password']);
    const registered = await request(adminId, 'POST', '/auth/register', {
      name: ' Nueva cuenta ', email: ' nueva@example.test ', password: 'testing123',
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.name, 'Nueva cuenta');
    assert.equal((await request(adminId, 'POST', '/auth/login', {
      email: ' nueva@example.test ', password: 'testing123',
    })).status, 200);
    assert.equal((await request(adminId, 'PATCH', `/roles/${roleIds.ADMIN}`, { name: 'CAMBIADO' })).status, 409);
    assert.equal((await request(adminId, 'DELETE', `/roles/${roleIds.ADMIN}`)).status, 409);
    assert.equal((await request(agentId, 'GET', `/users/${adminId}`)).status, 403);
    assert.equal((await request(adminId, 'PATCH', `/users/${adminId}`, { status: 'inactive' })).status, 400);
    const newContact = await request(agentId, 'POST', '/contacts', {
      name: ' Contacto temporal ', email: 'TEST@EXAMPLE.TEST',
    });
    assert.equal(newContact.status, 201);
    assert.equal(newContact.body.contact.owner_id, agentId);
    assert.equal(newContact.body.contact.name, 'Contacto temporal');
    assert.equal(newContact.body.contact.email, 'test@example.test');
    assert.equal((await request(otherId, 'PATCH', `/contacts/${newContact.body.contact.id}`, { name: 'Otro' })).status, 404);
    const updatedContact = await request(agentId, 'PATCH', `/contacts/${newContact.body.contact.id}`, { company: 'Empresa' });
    assert.equal(updatedContact.status, 200);
    assert.equal(updatedContact.body.contact.company, 'Empresa');
    await connection.query('DELETE FROM contacts WHERE id = ?', [newContact.body.contact.id]);

    const newRecording = await request(agentId, 'POST', '/recordings', {
      call_id: calls.insertId, file_name: ' audio temporal ', duration_seconds: '12',
    });
    assert.equal(newRecording.status, 201);
    assert.equal(newRecording.body.recording.file_name, 'audio temporal');
    assert.equal(newRecording.body.recording.duration_seconds, 12);
    assert.equal((await request(otherId, 'GET', `/recordings/${newRecording.body.recording.id}`)).status, 404);
    assert.equal((await request(otherId, 'PATCH', `/recordings/${newRecording.body.recording.id}`, { file_name: 'Otro' })).status, 404);
    assert.equal((await request(agentId, 'PATCH', `/recordings/${newRecording.body.recording.id}`, { call_id: calls.insertId + 1 })).status, 400);
    const updatedRecording = await request(agentId, 'PATCH', `/recordings/${newRecording.body.recording.id}`, { transcription: 'Prueba' });
    assert.equal(updatedRecording.status, 200);
    assert.equal(updatedRecording.body.recording.transcription, 'Prueba');
    await connection.query('DELETE FROM recordings WHERE id = ?', [newRecording.body.recording.id]);

    const newCall = await request(agentId, 'POST', '/calls', {
      contact_id: contactId, phone_number: ' 555123 ', status: 'active',
    });
    assert.equal(newCall.status, 201);
    assert.equal(newCall.body.call.phone_number, '555123');
    assert.equal(newCall.body.call.agent_id, agentId);
    assert.equal((await request(otherId, 'GET', `/calls/${newCall.body.call.id}`)).status, 404);
    assert.equal((await request(agentId, 'PATCH', `/calls/${newCall.body.call.id}`, { agent_id: otherId })).status, 403);
    const [activeQueue] = await connection.query('SELECT id, status FROM surveillance_queue WHERE call_id = ?', [newCall.body.call.id]);
    assert.equal(activeQueue.length, 1);
    assert.equal(activeQueue[0].status, 'waiting');
    assert.equal((await request(agentId, 'GET', '/supervision/summary')).status, 403);
    assert.equal((await request(adminId, 'GET', '/supervision/summary')).body.summary.activeCalls, 1);
    assert.ok((await request(adminId, 'GET', '/supervision/agents')).body.agents.some((agent) => agent.id === agentId));
    assert.ok((await request(adminId, 'GET', '/supervision/queue')).body.queue.some((item) => item.id === activeQueue[0].id));
    assert.equal((await request(adminId, 'POST', `/supervision/queue/${activeQueue[0].id}/monitoring`)).status, 200);
    assert.equal((await request(adminId, 'POST', `/supervision/queue/${activeQueue[0].id}/escalate`)).status, 200);
    assert.equal((await request(adminId, 'POST', `/supervision/queue/${activeQueue[0].id}/monitoring`)).status, 409);
    assert.equal((await request(agentId, 'PATCH', `/calls/${newCall.body.call.id}`, { status: 'completed' })).status, 200);
    const [closedQueue] = await connection.query('SELECT id FROM surveillance_queue WHERE call_id = ?', [newCall.body.call.id]);
    assert.equal(closedQueue.length, 0);
    await connection.query('DELETE FROM calls WHERE id = ?', [newCall.body.call.id]);

    assert.equal((await request(adminId, 'GET', '/reports/summary')).body.summary.totalCalls, 2);
    assert.equal((await request(agentId, 'GET', '/reports/summary')).body.summary.totalCalls, 1);
    assert.equal((await fetch(`${base}/reports/inexistente`)).status, 404);
    const callsByDay = (await request(agentId, 'GET', '/reports/calls-by-day')).body.callsByDay;
    assert.equal(callsByDay.length, 7);
    assert.equal(callsByDay.reduce((total, day) => total + day.totalCalls, 0), 1);
    const agents = (await request(agentId, 'GET', '/reports/by-agent')).body.agents;
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agentId, agentId);
    assert.equal(agents[0].totalCalls, 1);
    const reportRecordings = (await request(agentId, 'GET', '/reports')).body.recordings;
    assert.equal(reportRecordings.length, 1);
    assert.equal(reportRecordings[0].id, recordings.insertId);

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
    assert.equal((await request(adminId, 'PATCH', `/users/${registered.body.user.id}`, { password: 'newpassword123' })).status, 200);
    assert.equal((await request(registered.body.user.id, 'GET', `/users/${registered.body.user.id}`)).status, 401);
    assert.equal((await request(adminId, 'POST', '/auth/login', {
      email: 'nueva@example.test', password: 'newpassword123',
    })).status, 200);
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
