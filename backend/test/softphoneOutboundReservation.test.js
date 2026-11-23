const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const twilio = require('twilio');

require('../src/config/env');

test('outbound webhook saves the call and atomically marks its device busy', async () => {
  const database = `cm_softphone_test_${randomBytes(8).toString('hex')}`;
  const authToken = 'softphone-webhook-test-token';
  const webhookBaseUrl = 'https://softphone.example.test';
  const originalEnv = {};
  const config = {
    DB_NAME: database,
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'softphone-api-key-secret',
    TWILIO_TWIML_APP_SID: `AP${'c'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_PHONE_NUMBER: '+15551230000',
    TWILIO_WEBHOOK_BASE_URL: webhookBaseUrl,
  };
  for (const [key, value] of Object.entries(config)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  let created = false;
  let pool;
  let server;

  try {
    await connection.query(`CREATE DATABASE \`${database}\``);
    created = true;
    await connection.changeUser({ database });
    await connection.query(`
      CREATE TABLE calls (
        id INT PRIMARY KEY AUTO_INCREMENT,
        agent_id INT,
        agent_device_session_id VARCHAR(36),
        phone_number VARCHAR(30),
        direction ENUM('inbound', 'outbound'),
        status ENUM('queued', 'active', 'completed', 'failed'),
        duration_seconds INT DEFAULT 0,
        score DECIMAL(5,2) DEFAULT 0,
        provider_call_sid VARCHAR(64) NULL UNIQUE
      );
      CREATE TABLE agent_presence (
        user_id INT PRIMARY KEY,
        status ENUM('offline', 'available', 'busy') NOT NULL DEFAULT 'offline',
        device_session_id VARCHAR(36),
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);
    process.env.DB_NAME = database;
    pool = require('../src/config/db').pool;
    const app = require('../src/app');
    const [agentId, deviceSessionId] = [43, '8a9bcb72-a7c7-470f-8cfc-a19989a27add'];
    await connection.query(
      `INSERT INTO agent_presence (user_id, status, device_session_id)
       VALUES (?, 'available', ?)`,
      [agentId, deviceSessionId]
    );
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    async function placeTestWebhook(callSid) {
      const params = {
        ApplicationSid: config.TWILIO_TWIML_APP_SID,
        CallSid: callSid,
        DeviceSessionId: deviceSessionId,
        From: `client:agent_${agentId}_${deviceSessionId.replace(/-/g, '')}`,
        To: '+15558675309',
      };
      const url = `${webhookBaseUrl}/api/softphone/webhooks/voice`;
      const signature = twilio.getExpectedTwilioSignature(authToken, url, params);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/softphone/webhooks/voice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': signature,
        },
        body: new URLSearchParams(params),
      });
      return { status: response.status, body: await response.text() };
    }

    const firstCall = await placeTestWebhook(`CA${'1'.repeat(32)}`);
    assert.equal(firstCall.status, 200);
    assert.match(firstCall.body, /<Dial\b/);
    assert.doesNotMatch(firstCall.body, /not registered or available/i);

    const [[savedCall]] = await connection.query(
      'SELECT agent_id, agent_device_session_id, phone_number, direction, status FROM calls'
    );
    assert.deepEqual(savedCall, {
      agent_id: agentId,
      agent_device_session_id: deviceSessionId,
      phone_number: '+15558675309',
      direction: 'outbound',
      status: 'queued',
    });
    const [[presence]] = await connection.query(
      'SELECT status FROM agent_presence WHERE user_id = ?',
      [agentId]
    );
    assert.equal(presence.status, 'busy');

    const secondCall = await placeTestWebhook(`CA${'2'.repeat(32)}`);
    assert.equal(secondCall.status, 200);
    assert.match(secondCall.body, /not registered or available/i);
    const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM calls');
    assert.equal(count.total, 1);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
