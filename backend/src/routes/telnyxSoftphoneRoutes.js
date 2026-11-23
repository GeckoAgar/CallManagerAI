const express = require('express');
const { randomUUID } = require('node:crypto');
const Telnyx = require('telnyx');
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { runInTransaction, syncSurveillanceQueueForCall } = require('../utils/surveillanceQueue');

const router = express.Router();
const phonePattern = /^\+[1-9]\d{7,14}$/;
const sessionPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const reservationHeader = 'x-callmanager-reservation';

function config() {
  const { TELNYX_API_KEY, TELNYX_PUBLIC_KEY, TELNYX_CONNECTION_ID,
    TELNYX_PHONE_NUMBER, TELNYX_WEBHOOK_BASE_URL } = process.env;
  if (!TELNYX_API_KEY || !TELNYX_PUBLIC_KEY || !TELNYX_CONNECTION_ID ||
      !phonePattern.test(TELNYX_PHONE_NUMBER || '') || !TELNYX_WEBHOOK_BASE_URL) return null;
  let url;
  try {
    url = new URL(TELNYX_WEBHOOK_BASE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null;
  return {
    connectionId: TELNYX_CONNECTION_ID,
    phoneNumber: TELNYX_PHONE_NUMBER,
    webhookUrl: `${url.origin}/api/softphone/telnyx/webhook`,
    client: new Telnyx({ apiKey: TELNYX_API_KEY, publicKey: TELNYX_PUBLIC_KEY, maxRetries: 0, timeout: 5000 }),
  };
}

async function ensureSafeConnection(settings) {
  const { data } = await settings.client.credentialConnections.retrieve(settings.connectionId);
  return data?.active && data.outbound?.call_parking_enabled === true &&
    data.webhook_api_version === '2' && data.webhook_event_url === settings.webhookUrl;
}

async function endCall(connection, call) {
  if (call.phase === 'finished') return;
  const status = call.phase === 'active' ? 'completed' : 'failed';
  await connection.query(
    `UPDATE calls SET status = ?,
       duration_seconds = CASE WHEN ? = 'completed' AND ? IS NOT NULL
         THEN GREATEST(TIMESTAMPDIFF(SECOND, ?, UTC_TIMESTAMP()), 0) ELSE 0 END
     WHERE id = ?`,
    [status, status, call.started_at, call.started_at, call.id]
  );
  await connection.query("UPDATE telnyx_outbound_calls SET phase = 'finished' WHERE call_id = ?", [call.id]);
  await syncSurveillanceQueueForCall(connection, {
    callId: call.id, previousStatus: call.status, previousAgentId: call.agent_id,
    status, agentId: call.agent_id,
  });
  await connection.query(
    `UPDATE agent_presence SET status = 'available', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    [call.agent_id, call.agent_device_session_id]
  );
}

router.post('/webhook', async (req, res, next) => {
  const settings = config();
  if (!settings || !Buffer.isBuffer(req.body)) return res.status(503).send('Telnyx no está configurado.');
  let event;
  try {
    event = await settings.client.webhooks.unwrap(req.body.toString('utf8'), { headers: req.headers });
  } catch {
    return res.status(403).send('Firma de Telnyx inválida.');
  }

  const { event_type: type, payload = {} } = event.data || {};
  if (payload.connection_id !== settings.connectionId) return res.sendStatus(200);
  try {
    if (type === 'call.initiated' && payload.state === 'parked') {
      const header = (payload.custom_headers || []).find(
        (item) => typeof item.name === 'string' && item.name.toLowerCase() === reservationHeader
      );
      const reservation = header?.value;
      if (!sessionPattern.test(reservation || '') || !payload.call_control_id || !payload.call_session_id) {
        if (payload.call_control_id) await settings.client.calls.actions.hangup(payload.call_control_id);
        return res.sendStatus(200);
      }

      const callId = await runInTransaction(async (connection) => {
        const [rows] = await connection.query(
          `SELECT c.id, c.phone_number, c.agent_id, c.agent_device_session_id, c.status,
                  t.phase, t.started_at, t.call_control_id
           FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
           WHERE t.reservation_id = ? FOR UPDATE`,
          [reservation]
        );
        const call = rows[0];
        if (!call || call.phase !== 'reserved' || call.status !== 'queued' ||
            payload.to !== call.phone_number) {
          if (!call || call.call_control_id !== payload.call_control_id) {
            await settings.client.calls.actions.hangup(payload.call_control_id);
          }
          return null;
        }
        const [presence] = await connection.query(
          `SELECT user_id FROM agent_presence
           WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
             AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) FOR UPDATE`,
          [call.agent_id, call.agent_device_session_id]
        );
        if (!presence.length) {
          await settings.client.calls.actions.hangup(payload.call_control_id);
          await endCall(connection, call);
          return null;
        }
        await connection.query(
          `UPDATE telnyx_outbound_calls SET phase = 'transferring',
             call_control_id = ?, call_session_id = ? WHERE call_id = ?`,
          [payload.call_control_id, payload.call_session_id, call.id]
        );
        return call.id;
      });
      if (callId) {
        try {
          await runInTransaction(async (connection) => {
            const [rows] = await connection.query(
              `SELECT c.phone_number, t.phase FROM telnyx_outbound_calls t
               JOIN calls c ON c.id = t.call_id WHERE t.call_id = ? FOR UPDATE`,
              [callId]
            );
            if (rows[0]?.phase !== 'transferring') return;
            await settings.client.calls.actions.transfer(payload.call_control_id, {
              to: rows[0].phone_number,
              from: settings.phoneNumber,
              command_id: reservation,
              client_state: Buffer.from(reservation).toString('base64'),
              timeout_secs: 30,
            });
          });
        } catch (error) {
          console.error('Error transfiriendo llamada Telnyx:', error.code || error.name);
          await settings.client.calls.actions.hangup(payload.call_control_id);
          await runInTransaction(async (connection) => {
            const [rows] = await connection.query(
              `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id, t.phase, t.started_at
               FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
               WHERE t.call_id = ? FOR UPDATE`,
              [callId]
            );
            if (rows.length) await endCall(connection, rows[0]);
          });
        }
      }
      return res.sendStatus(200);
    }

    if (['call.bridged', 'call.hangup'].includes(type) && payload.call_session_id) {
      await runInTransaction(async (connection) => {
        const [rows] = await connection.query(
          `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id,
                  t.phase, t.started_at, t.call_control_id
           FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
           WHERE t.call_session_id = ? FOR UPDATE`,
          [payload.call_session_id]
        );
        const call = rows[0];
        if (!call || call.phase === 'finished') return;
        if (type === 'call.bridged' && call.phase === 'transferring') {
          await connection.query(
            "UPDATE telnyx_outbound_calls SET phase = 'active', started_at = UTC_TIMESTAMP() WHERE call_id = ?",
            [call.id]
          );
          await connection.query("UPDATE calls SET status = 'active' WHERE id = ?", [call.id]);
          await syncSurveillanceQueueForCall(connection, {
            callId: call.id, previousStatus: call.status, previousAgentId: call.agent_id,
            status: 'active', agentId: call.agent_id,
          });
        } else if (type === 'call.hangup') {
          if (call.call_control_id && call.call_control_id !== payload.call_control_id) {
            await settings.client.calls.actions.hangup(call.call_control_id);
          }
          await endCall(connection, call);
        }
      });
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('Error procesando un evento de Telnyx:', error.code || error.name);
    return next(new Error('No se pudo procesar el evento de Telnyx.'));
  }
});

router.use(authenticate);

router.post('/token', async (req, res) => {
  const settings = config();
  const { deviceSessionId } = req.body || {};
  if (!settings) return res.status(503).json({ message: 'Telnyx no está configurado en el servidor.' });
  if (!sessionPattern.test(deviceSessionId || '')) {
    return res.status(400).json({ message: 'Identificador de sesión inválido.' });
  }
  try {
    const [presence] = await pool.query(
      `SELECT user_id FROM agent_presence WHERE user_id = ? AND device_session_id = ?
       AND status = 'available' AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
      [req.user.id, deviceSessionId]
    );
    if (!presence.length) return res.status(409).json({ message: 'El dispositivo no está disponible.' });
    if (!await ensureSafeConnection(settings)) {
      return res.status(503).json({ message: 'La conexión Telnyx debe tener call parking y el webhook configurados.' });
    }
    const { data } = await settings.client.telephonyCredentials.create({
      connection_id: settings.connectionId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      name: `callmanager-${req.user.id}`,
    });
    const token = await settings.client.telephonyCredentials.createToken(data.id);
    return res.json({ token, callerNumber: settings.phoneNumber });
  } catch (error) {
    console.error('Error preparando Telnyx:', error.code || error.name);
    return res.status(502).json({ message: 'No se pudo preparar la conexión Telnyx.' });
  }
});

router.post('/calls', async (req, res, next) => {
  const settings = config();
  const { deviceSessionId, phoneNumber } = req.body || {};
  if (!settings) return res.status(503).json({ message: 'Telnyx no está configurado.' });
  if (!sessionPattern.test(deviceSessionId || '') || !phonePattern.test(phoneNumber || '')) {
    return res.status(400).json({ message: 'Sesión o número de destino inválido.' });
  }
  try {
    if (!await ensureSafeConnection(settings)) {
      return res.status(503).json({ message: 'La conexión Telnyx no está configurada de forma segura.' });
    }
    const reservation = randomUUID();
    const callId = await runInTransaction(async (connection) => {
      const [agents] = await connection.query(
        `SELECT user_id FROM agent_presence WHERE user_id = ? AND device_session_id = ?
         AND status = 'available' AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) FOR UPDATE`,
        [req.user.id, deviceSessionId]
      );
      if (!agents.length) return null;
      const [call] = await connection.query(
        `INSERT INTO calls (agent_id, agent_device_session_id, phone_number, direction, status, provider_call_sid)
         VALUES (?, ?, ?, 'outbound', 'queued', ?)`,
        [req.user.id, deviceSessionId, phoneNumber, reservation]
      );
      await connection.query(
        'INSERT INTO telnyx_outbound_calls (call_id, reservation_id) VALUES (?, ?)',
        [call.insertId, reservation]
      );
      await connection.query(
        "UPDATE agent_presence SET status = 'busy', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [req.user.id]
      );
      return call.insertId;
    });
    if (!callId) return res.status(409).json({ message: 'El dispositivo no está disponible.' });
    return res.status(201).json({ reservation });
  } catch (error) {
    return next(error);
  }
});

router.post('/calls/status', async (req, res, next) => {
  const { reservation } = req.body || {};
  if (!sessionPattern.test(reservation || '')) return res.status(400).json({ message: 'Identificador inválido.' });
  try {
    const [rows] = await pool.query(
      `SELECT c.status, c.duration_seconds FROM calls c
       JOIN telnyx_outbound_calls t ON t.call_id = c.id
       WHERE t.reservation_id = ? AND c.agent_id = ?`,
      [reservation, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ call: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/calls/end', async (req, res, next) => {
  const { reservation } = req.body || {};
  if (!config()) return res.status(503).json({ message: 'Telnyx no está configurado.' });
  if (!sessionPattern.test(reservation || '')) return res.status(400).json({ message: 'Identificador inválido.' });
  try {
    const outcome = await runInTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT c.id, c.status, c.agent_id, c.agent_device_session_id,
                t.phase, t.started_at, t.call_control_id
         FROM telnyx_outbound_calls t JOIN calls c ON c.id = t.call_id
         WHERE t.reservation_id = ? AND c.agent_id = ? FOR UPDATE`,
        [reservation, req.user.id]
      );
      if (!rows.length) return 'missing';
      const call = rows[0];
      if (call.phase === 'finished') return 'finished';
      if (call.phase !== 'reserved') return 'pending';
      await endCall(connection, call);
      return 'finished';
    });
    if (outcome === 'missing') return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.sendStatus(outcome === 'pending' ? 202 : 204);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
