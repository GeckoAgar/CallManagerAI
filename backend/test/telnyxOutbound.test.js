const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('../src/config/env');

test('Telnyx outbound calls require a reservation and verified, idempotent webhooks', async () => {
  const database = `cm_telnyx_test_${randomBytes(8).toString('hex')}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const originalEnv = {};
  const values = {
    DB_NAME: database,
    TELNYX_API_KEY: 'test-api-key',
    TELNYX_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    TELNYX_CONNECTION_ID: '123456789',
    TELNYX_PHONE_NUMBER: '+15551230000',
    TELNYX_WEBHOOK_BASE_URL: 'https://test.example',
    JWT_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  };
  for (const [key, value] of Object.entries(values)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const databaseConnection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  const originalFetch = global.fetch;
  let created = false;
  let server;
  let pool;
  let transfers = 0;
  let hangups = 0;
  let failTransfer = false;
  let failHangup = false;
  let safeConnection = true;

  global.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('https://api.telnyx.com/')) return originalFetch(input, options);
    if (url.includes('/credential_connections/')) {
      return Response.json({ data: {
        active: true,
        outbound: { call_parking_enabled: safeConnection },
        webhook_api_version: '2',
        webhook_event_url: `${values.TELNYX_WEBHOOK_BASE_URL}/api/softphone/telnyx/webhook`,
      } });
    }
    if (url.includes('/actions/transfer')) {
      transfers += 1;
      if (failTransfer) return Response.json({ errors: [{ code: 'test_failure' }] }, { status: 422 });
      return Response.json({ data: { result: 'ok' } });
    }
    if (url.includes('/actions/hangup')) {
      hangups += 1;
      if (failHangup) return Response.json({ errors: [{ code: 'test_failure' }] }, { status: 500 });
      return Response.json({ data: { result: 'ok' } });
    }
    if (url.endsWith('/telephony_credentials')) return Response.json({ data: { id: 'test-credential' } });
    if (url.endsWith('/telephony_credentials/test-credential/token')) {
      return new Response('test-login-token', { headers: { 'Content-Type': 'text/plain' } });
    }
    throw new Error(`Unexpected mocked Telnyx request: ${url}`);
  };

  try {
    await databaseConnection.query(`CREATE DATABASE \`${database}\``);
    created = true;
    await databaseConnection.changeUser({ database });
    await databaseConnection.query(`
      CREATE TABLE roles (id INT PRIMARY KEY, name VARCHAR(50));
      CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(120), email VARCHAR(150),
        status VARCHAR(20), role_id INT, token_version INT NOT NULL DEFAULT 0);
      CREATE TABLE calls (id INT AUTO_INCREMENT PRIMARY KEY, agent_id INT,
        agent_device_session_id VARCHAR(36), phone_number VARCHAR(30),
        direction VARCHAR(20), status VARCHAR(20), duration_seconds INT DEFAULT 0,
        provider_call_sid VARCHAR(64) UNIQUE);
      CREATE TABLE agent_presence (user_id INT PRIMARY KEY, status VARCHAR(20),
        device_session_id VARCHAR(36), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);
      CREATE TABLE surveillance_queue (id INT AUTO_INCREMENT PRIMARY KEY, agent_id INT,
        call_id INT UNIQUE, status VARCHAR(20));
      CREATE TABLE telnyx_outbound_calls (call_id INT PRIMARY KEY, reservation_id CHAR(36) UNIQUE,
        call_control_id VARCHAR(512), call_session_id VARCHAR(64), started_at DATETIME,
        phase VARCHAR(20) NOT NULL DEFAULT 'reserved');
      INSERT INTO roles VALUES (1, 'USER');
      INSERT INTO users VALUES (43, 'Agent', 'agent@example.test', 'active', 1, 0);
      INSERT INTO agent_presence (user_id, status, device_session_id)
        VALUES (43, 'available', '8a9bcb72-a7c7-470f-8cfc-a19989a27add');
    `);
    pool = require('../src/config/db').pool;
    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/softphone/telnyx`;
    const auth = jwt.sign({ id: 43, tokenVersion: 0 }, values.JWT_SECRET);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` };
    const reservationBody = {
      deviceSessionId: '8a9bcb72-a7c7-470f-8cfc-a19989a27add',
      phoneNumber: '+15558675309',
    };
    const presenceBase = 'http://127.0.0.1:' + server.address().port + '/api/softphone/presence';
    const registerResponse = await fetch(`${presenceBase}/register`, {
      method: 'PATCH', headers, body: JSON.stringify({ deviceSessionId: reservationBody.deviceSessionId }),
    });
    assert.equal(registerResponse.status, 200);
    const heartbeatResponse = await fetch(`${presenceBase}/heartbeat`, {
      method: 'PATCH', headers, body: JSON.stringify({ deviceSessionId: reservationBody.deviceSessionId }),
    });
    assert.equal((await heartbeatResponse.json()).refreshed, true);
    const presenceResponse = await fetch('http://127.0.0.1:' + server.address().port + '/api/softphone/presence', { headers });
    assert.equal(presenceResponse.status, 200);
    assert.equal((await presenceResponse.json()).presence.status, 'available');
    const otherDevice = '8a9bcb72-a7c7-470f-8cfc-a19989a27ade';
    const conflict = await fetch(`${presenceBase}/register`, {
      method: 'PATCH', headers, body: JSON.stringify({ deviceSessionId: otherDevice }),
    });
    assert.equal(conflict.status, 409);
    const replaced = await fetch(`${presenceBase}/heartbeat`, {
      method: 'PATCH', headers, body: JSON.stringify({ deviceSessionId: otherDevice }),
    });
    assert.equal((await replaced.json()).reason, 'session_replaced');
    const busy = await fetch(presenceBase, {
      method: 'PATCH', headers, body: JSON.stringify({ status: 'busy', deviceSessionId: reservationBody.deviceSessionId }),
    });
    assert.equal(busy.status, 200);
    const available = await fetch(presenceBase, {
      method: 'PATCH', headers, body: JSON.stringify({ status: 'available', deviceSessionId: reservationBody.deviceSessionId }),
    });
    assert.equal(available.status, 200);
    const legacyToken = await fetch('http://127.0.0.1:' + server.address().port + '/api/softphone/token', { headers });
    assert.equal(legacyToken.status, 404);
    const legacyWebhook = await fetch('http://127.0.0.1:' + server.address().port + '/api/softphone/webhooks/voice', {
      method: 'POST', headers,
    });
    assert.equal(legacyWebhook.status, 404);
    safeConnection = false;
    const unsafeToken = await fetch(`${base}/token`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    assert.equal(unsafeToken.status, 503);
    const unsafe = await fetch(`${base}/calls`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    assert.equal(unsafe.status, 503);
    safeConnection = true;
    const tokenResponse = await fetch(`${base}/token`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    assert.equal(tokenResponse.status, 200);
    assert.equal((await tokenResponse.json()).token, 'test-login-token');
    const response = await fetch(`${base}/calls`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    assert.equal(response.status, 201);
    const { reservation } = await response.json();
    const second = await fetch(`${base}/calls`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    assert.equal(second.status, 409);
    const [[reservationState]] = await databaseConnection.query(
      `SELECT c.status, c.agent_device_session_id, p.status AS presence_status
       FROM calls c JOIN agent_presence p ON p.user_id = c.agent_id
       WHERE c.provider_call_sid = ?`, [reservation]
    );
    assert.deepEqual(reservationState, {
      status: 'queued',
      agent_device_session_id: reservationBody.deviceSessionId,
      presence_status: 'busy',
    });

    async function sendEvent(type, payload, valid = true) {
      const body = JSON.stringify({ data: { event_type: type, payload } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');
      return fetch(`${base}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Telnyx-Timestamp': timestamp,
          'Telnyx-Signature-Ed25519': valid ? signature : Buffer.alloc(64).toString('base64'),
        },
        body,
      });
    }
    const payload = {
      connection_id: values.TELNYX_CONNECTION_ID,
      state: 'parked',
      call_control_id: 'test-control-id',
      call_session_id: 'test-session-id',
      to: reservationBody.phoneNumber,
      custom_headers: [{ name: 'X-CallManager-Reservation', value: reservation }],
    };
    assert.equal((await sendEvent('call.initiated', payload, false)).status, 403);
    assert.equal(transfers, 0);
    assert.equal((await sendEvent('call.initiated', payload)).status, 200);
    assert.equal((await sendEvent('call.initiated', payload)).status, 200);
    assert.equal(transfers, 1);
    assert.equal((await fetch(`${base}/calls/end`, { method: 'POST', headers, body: JSON.stringify({ reservation }) })).status, 202);
    assert.equal((await sendEvent('call.bridged', payload)).status, 200);
    let [[call]] = await databaseConnection.query('SELECT status FROM calls');
    assert.equal(call.status, 'active');
    const childHangup = { ...payload, call_control_id: 'child-control-id' };
    failHangup = true;
    assert.equal((await sendEvent('call.hangup', childHangup)).status, 500);
    [[call]] = await databaseConnection.query('SELECT status FROM calls');
    assert.equal(call.status, 'active');
    failHangup = false;
    assert.equal((await sendEvent('call.hangup', childHangup)).status, 200);
    assert.equal((await sendEvent('call.hangup', childHangup)).status, 200);
    assert.equal(hangups, 2);
    [[call]] = await databaseConnection.query('SELECT status FROM calls');
    assert.equal(call.status, 'completed');
    const failing = await fetch(`${base}/calls`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    const failingReservation = (await failing.json()).reservation;
    const failingPayload = {
      ...payload, call_control_id: 'failing-call', call_session_id: 'failing-session',
      custom_headers: [{ name: 'X-CallManager-Reservation', value: failingReservation }],
    };
    failTransfer = true;
    assert.equal((await sendEvent('call.initiated', failingPayload)).status, 200);
    assert.equal((await sendEvent('call.initiated', failingPayload)).status, 200);
    assert.equal(transfers, 2);
    assert.equal(hangups, 3);
    const [[failedCall]] = await databaseConnection.query(
      'SELECT status FROM calls WHERE provider_call_sid = ?', [failingReservation]
    );
    assert.equal(failedCall.status, 'failed');
    failTransfer = false;
    const pending = await fetch(`${base}/calls`, { method: 'POST', headers, body: JSON.stringify(reservationBody) });
    const pendingReservation = (await pending.json()).reservation;
    assert.equal((await fetch(`${base}/calls/end`, { method: 'POST', headers, body: JSON.stringify({ reservation: pendingReservation }) })).status, 204);
    assert.equal((await sendEvent('call.initiated', {
      ...payload, call_control_id: 'late-call', call_session_id: 'late-session',
      custom_headers: [{ name: 'X-CallManager-Reservation', value: pendingReservation }],
    })).status, 200);
    assert.equal(hangups, 4);
    assert.equal(transfers, 2);
    const [[presence]] = await databaseConnection.query('SELECT status FROM agent_presence');
    assert.equal(presence.status, 'available');
    assert.equal((await sendEvent('call.bridged', payload)).status, 200);
    [[call]] = await databaseConnection.query('SELECT status FROM calls');
    assert.equal(call.status, 'completed');
  } finally {
    global.fetch = originalFetch;
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (created) await databaseConnection.query(`DROP DATABASE \`${database}\``);
    await databaseConnection.end();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
