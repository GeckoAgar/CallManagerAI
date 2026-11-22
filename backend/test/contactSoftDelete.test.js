const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('../src/config/env');

test('contactos eliminados conservan su historial y solo ADMIN puede restaurarlos', async () => {
  const database = `cm_contact_test_${randomBytes(8).toString('hex')}`;
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
      .replace(/^\s*deleted_at TIMESTAMP NULL DEFAULT NULL,\s*$/m, '');
    assert.notEqual(tables, schema);
    await connection.query(tables);

    const migration = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', '007_contact_soft_delete.sql'), 'utf8');
    const testMigration = migration.replace('USE callmanagerai;', `USE \`${database}\`;`);
    await connection.query(testMigration);
    await connection.query(testMigration);

    process.env.DB_NAME = database;
    const db = require('../src/config/db');
    pool = db.pool;
    const app = require('../src/app');
    const [roles] = await connection.query('SELECT id, name FROM roles');
    const roleIds = Object.fromEntries(roles.map((role) => [role.name, role.id]));
    const [users] = await connection.query(
      `INSERT INTO users (name, email, password_hash, role_id) VALUES
       ('Admin', 'admin@example.test', 'hash', ?),
       ('Agente', 'agent@example.test', 'hash', ?),
       ('Otro', 'other@example.test', 'hash', ?)`,
      [roleIds.ADMIN, roleIds.USER, roleIds.USER]
    );
    const adminId = users.insertId;
    const agentId = adminId + 1;
    const otherId = adminId + 2;
    const [contacts] = await connection.query(
      "INSERT INTO contacts (owner_id, name, status) VALUES (?, 'Contacto', 'inactive')",
      [agentId]
    );
    const contactId = contacts.insertId;
    const [calls] = await connection.query(
      "INSERT INTO calls (contact_id, agent_id, phone_number, status) VALUES (?, ?, '+5491123456789', 'completed')",
      [contactId, agentId]
    );
    const callId = calls.insertId;
    await connection.query(
      "INSERT INTO recordings (call_id, file_name) VALUES (?, 'historial')",
      [callId]
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

    assert.equal((await request(otherId, 'DELETE', `/contacts/${contactId}`)).status, 404);
    assert.equal((await request(agentId, 'DELETE', `/contacts/${contactId}`)).status, 200);
    assert.equal((await request(agentId, 'DELETE', `/contacts/${contactId}`)).status, 404);
    assert.equal((await request(agentId, 'GET', `/contacts/${contactId}`)).status, 404);
    assert.equal((await request(adminId, 'PATCH', `/contacts/${contactId}`, { name: 'Otro' })).status, 404);
    assert.deepEqual((await request(agentId, 'GET', '/contacts')).body.contacts, []);
    assert.deepEqual((await request(adminId, 'GET', '/contacts?page=1&limit=10')).body.data, []);
    assert.equal((await request(agentId, 'GET', '/contacts?deleted=true')).status, 403);
    assert.equal((await request(agentId, 'POST', `/contacts/${contactId}/restore`)).status, 403);

    const deleted = await request(adminId, 'GET', '/contacts?deleted=true&page=1&limit=10');
    assert.equal(deleted.body.total, 1);
    assert.equal(deleted.body.data[0].id, contactId);
    assert.ok(deleted.body.data[0].deleted_at);
    assert.equal((await request(adminId, 'GET', '/contacts?deleted=true')).body.contacts.length, 1);
    assert.equal((await request(agentId, 'POST', '/calls', {
      contact_id: contactId,
      phone_number: '+5491123456789',
    })).status, 400);
    const edit = await request(agentId, 'PATCH', `/calls/${callId}`, {
      contact_id: contactId,
      duration_seconds: 45,
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.call.contact_id, contactId);
    assert.equal(edit.body.call.contact_name, 'Contacto');
    const [otherCalls] = await connection.query(
      "INSERT INTO calls (agent_id, phone_number) VALUES (?, '+5491123456789')",
      [agentId]
    );
    assert.equal((await request(agentId, 'PATCH', `/calls/${otherCalls.insertId}`, { contact_id: contactId })).status, 400);
    const [recordings] = await connection.query('SELECT call_id FROM recordings WHERE call_id = ?', [callId]);
    assert.equal(recordings.length, 1);

    assert.equal((await request(adminId, 'POST', `/contacts/${contactId}/restore`)).status, 200);
    assert.equal((await request(adminId, 'POST', `/contacts/${contactId}/restore`)).status, 404);
    const restored = await request(agentId, 'GET', `/contacts/${contactId}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.contact.status, 'inactive');
    assert.equal((await request(agentId, 'POST', '/calls', {
      contact_id: contactId,
      phone_number: '+5491123456789',
    })).status, 201);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
