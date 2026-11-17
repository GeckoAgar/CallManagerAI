const express = require('express');
const twilio = require('twilio');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { runInTransaction, syncSurveillanceQueueForCall } = require('../utils/surveillanceQueue');

const VoiceResponse = twilio.twiml.VoiceResponse;
const validPhoneNumber = /^\+[1-9]\d{7,14}$/;
const validDeviceSessionId = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function getTwilioConfig() {
  const {
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_API_KEY_SID: apiKeySid,
    TWILIO_API_KEY_SECRET: apiKeySecret,
    TWILIO_TWIML_APP_SID: twimlAppSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_PHONE_NUMBER: phoneNumber,
    TWILIO_WEBHOOK_BASE_URL: webhookBaseUrl,
  } = process.env;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid || !authToken ||
      !phoneNumber || !webhookBaseUrl) {
    return null;
  }
  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid, authToken, phoneNumber, webhookBaseUrl };
}

function webhookUrl(req, config) {
  return `${config.webhookBaseUrl.replace(/\/$/, '')}${req.originalUrl}`;
}

function validTwilioRequest(req, config) {
  const signature = req.get('X-Twilio-Signature');
  return Boolean(signature && twilio.validateRequest(
    config.authToken,
    signature,
    webhookUrl(req, config),
    req.body
  ));
}

function sendVoiceResponse(res, voiceResponse) {
  return res.type('text/xml').send(voiceResponse.toString());
}

function callStatusCallbackUrl(config) {
  return `${config.webhookBaseUrl.replace(/\/$/, '')}/api/softphone/webhooks/dial-status`;
}

async function insertCallOnce(connection, { callSid, agentId, deviceSessionId = null, phoneNumber, direction }) {
  try {
    const [result] = await connection.query(
      `INSERT INTO calls
         (agent_id, agent_device_session_id, phone_number, direction, status, duration_seconds, score, provider_call_sid)
       VALUES (?, ?, ?, ?, 'queued', 0, 0, ?)`,
      [agentId, deviceSessionId, phoneNumber, direction, callSid]
    );
    return { created: true, callId: result.insertId };
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return { created: false };
  }
}

async function saveOutboundCall({ callSid, agentId, deviceSessionId, phoneNumber }) {
  return runInTransaction((connection) => insertCallOnce(connection, {
    callSid,
    agentId,
    deviceSessionId,
    phoneNumber,
    direction: 'outbound',
  }));
}

async function isRegisteredAndAvailable(agentId, deviceSessionId) {
  const [rows] = await pool.query(
    `SELECT user_id
     FROM agent_presence
     WHERE user_id = ? AND device_session_id = ? AND status = 'available'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    [agentId, deviceSessionId]
  );
  return rows.length > 0;
}

async function reserveInboundCall({ callSid, phoneNumber }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runInTransaction(async (connection) => {
        const inserted = await insertCallOnce(connection, {
          callSid,
          agentId: null,
          phoneNumber,
          direction: 'inbound',
        });
        if (!inserted.created) return { state: 'duplicate' };

        const [agents] = await connection.query(
          `SELECT p.user_id, p.device_session_id
           FROM agent_presence p
           JOIN users u ON u.id = p.user_id
           JOIN roles r ON r.id = u.role_id
           WHERE p.status = 'available' AND p.device_session_id IS NOT NULL
             AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
             AND u.status = 'active' AND r.name = 'USER'
           ORDER BY p.updated_at ASC, p.user_id ASC
           LIMIT 1 FOR UPDATE`
        );

        if (!agents.length) {
          const [result] = await connection.query(
            `UPDATE calls SET status = 'failed'
             WHERE id = ? AND provider_call_sid = ? AND status = 'queued' AND agent_id IS NULL`,
            [inserted.callId, callSid]
          );
          if (result.affectedRows !== 1) {
            throw new Error('Unable to mark the unassigned inbound call as failed.');
          }
          return { state: 'unavailable' };
        }

        const agentId = agents[0].user_id;
        const deviceSessionId = agents[0].device_session_id;
        const [presenceResult] = await connection.query(
          `UPDATE agent_presence SET status = 'busy', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND device_session_id = ? AND status = 'available'
             AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
          [agentId, deviceSessionId]
        );
        if (presenceResult.affectedRows !== 1) {
          const [callResult] = await connection.query(
            `UPDATE calls SET status = 'failed'
             WHERE id = ? AND provider_call_sid = ? AND status = 'queued' AND agent_id IS NULL`,
            [inserted.callId, callSid]
          );
          if (callResult.affectedRows !== 1) {
            throw new Error('Unable to mark the inbound call with a failed reservation.');
          }
          return { state: 'unavailable' };
        }

        const [assignmentResult] = await connection.query(
          `UPDATE calls SET agent_id = ?, agent_device_session_id = ?
           WHERE id = ? AND provider_call_sid = ? AND status = 'queued' AND agent_id IS NULL`,
          [agentId, deviceSessionId, inserted.callId, callSid]
        );
        if (assignmentResult.affectedRows !== 1) {
          throw new Error('Unable to assign the reserved agent to the inbound call.');
        }

        return { state: 'reserved', agentId, deviceSessionId };
      });
    } catch (error) {
      if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw new Error('Unable to reserve an agent after retrying transaction conflicts.');
}

router.post('/webhooks/voice', async (req, res, next) => {
  const config = getTwilioConfig();
  if (!config) return res.status(503).send('Twilio is not configured.');
  if (!validTwilioRequest(req, config)) return res.status(403).send('Invalid Twilio signature.');

  const voiceResponse = new VoiceResponse();
  const from = String(req.body.From || '');
  const to = String(req.body.To || '');
  const callSid = String(req.body.CallSid || '');

  try {
    if (from.startsWith('client:agent_')) {
      const identityMatch = /^client:agent_(\d+)_([\da-f]{32})$/i.exec(from);
      const deviceSessionId = String(req.body.DeviceSessionId || '');
      if (!identityMatch || !callSid || !validPhoneNumber.test(to) ||
          !validDeviceSessionId.test(deviceSessionId) ||
          identityMatch[2].toLowerCase() !== deviceSessionId.replace(/-/g, '').toLowerCase()) {
        voiceResponse.say('The requested call cannot be completed.');
        voiceResponse.hangup();
        return sendVoiceResponse(res, voiceResponse);
      }

      const agentId = Number(identityMatch[1]);
      if (!(await isRegisteredAndAvailable(agentId, deviceSessionId))) {
        voiceResponse.say('The calling device is not registered or available.');
        voiceResponse.hangup();
        return sendVoiceResponse(res, voiceResponse);
      }

      const savedCall = await saveOutboundCall({ callSid, agentId, deviceSessionId, phoneNumber: to });
      if (!savedCall.created) {
        voiceResponse.hangup();
        return sendVoiceResponse(res, voiceResponse);
      }

      const dial = voiceResponse.dial({
        callerId: config.phoneNumber,
        answerOnBridge: true,
        action: callStatusCallbackUrl(config),
        method: 'POST',
      });
      dial.number({
        statusCallback: callStatusCallbackUrl(config),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      }, to);
      return sendVoiceResponse(res, voiceResponse);
    }

    if (to !== config.phoneNumber || !callSid || !validPhoneNumber.test(from)) {
      voiceResponse.say('This number is not configured to receive calls.');
      voiceResponse.hangup();
      return sendVoiceResponse(res, voiceResponse);
    }

    const reservation = await reserveInboundCall({ callSid, phoneNumber: from });
    if (reservation.state === 'duplicate') {
      voiceResponse.hangup();
      return sendVoiceResponse(res, voiceResponse);
    }
    if (reservation.state === 'unavailable') {
      voiceResponse.say('There are no agents available to take your call. Please try again later.');
      voiceResponse.hangup();
      return sendVoiceResponse(res, voiceResponse);
    }

    const dial = voiceResponse.dial({
      answerOnBridge: true,
      timeout: 25,
      action: callStatusCallbackUrl(config),
      method: 'POST',
    });
    dial.client({
      statusCallback: callStatusCallbackUrl(config),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    }, `agent_${reservation.agentId}_${reservation.deviceSessionId.replace(/-/g, '')}`);
    return sendVoiceResponse(res, voiceResponse);
  } catch (error) {
    return next(error);
  }
});

router.post('/webhooks/dial-status', async (req, res, next) => {
  const config = getTwilioConfig();
  if (!config) return res.status(503).send('Twilio is not configured.');
  if (!validTwilioRequest(req, config)) return res.status(403).send('Invalid Twilio signature.');

  const callSid = String(req.body.CallSid || '');
  const result = String(req.body.DialCallStatus || '');
  const duration = Number(req.body.DialCallDuration);
  const parentCallSid = String(req.body.ParentCallSid || '');
  const childStatus = String(req.body.CallStatus || '');
  const voiceResponse = new VoiceResponse();

  try {
    if (parentCallSid && childStatus) {
      const active = childStatus === 'in-progress' || childStatus === 'answered';
      const completed = childStatus === 'completed';
      const failed = ['busy', 'canceled', 'failed', 'no-answer'].includes(childStatus);
      if (active || completed || failed) {
        const status = active ? 'active' : completed ? 'completed' : 'failed';
        const childDuration = Number(req.body.CallDuration);
        const call = await runInTransaction(async (connection) => {
          const [calls] = await connection.query(
            `SELECT id, agent_id, agent_device_session_id, status FROM calls
             WHERE provider_call_sid = ? FOR UPDATE`,
            [parentCallSid]
          );
          if (!calls.length) return null;
          const previousCall = calls[0];
          await connection.query(
            `UPDATE calls SET status = ?,
               duration_seconds = CASE WHEN ? = 'completed' AND ? >= 0 THEN ? ELSE duration_seconds END
             WHERE id = ?`,
            [
              status,
              childStatus,
              Number.isInteger(childDuration) ? childDuration : -1,
              Number.isInteger(childDuration) && childDuration >= 0 ? childDuration : 0,
              previousCall.id,
            ]
          );
          await syncSurveillanceQueueForCall(connection, {
            callId: previousCall.id,
            previousStatus: previousCall.status,
            previousAgentId: previousCall.agent_id,
            status,
            agentId: previousCall.agent_id,
          });
          return previousCall;
        });
        if (call && call.agent_id && (completed || failed)) {
          await pool.query(
            `UPDATE agent_presence SET status = 'available', updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
               AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
            [call.agent_id, call.agent_device_session_id]
          );
        }
      }
      return sendVoiceResponse(res, voiceResponse);
    }

    if (callSid) {
      const status = result === 'completed' ? 'completed' : 'failed';
      const call = await runInTransaction(async (connection) => {
        const [calls] = await connection.query(
          `SELECT id, agent_id, agent_device_session_id, status FROM calls
           WHERE provider_call_sid = ? FOR UPDATE`,
          [callSid]
        );
        if (!calls.length) return null;
        const previousCall = calls[0];
        await connection.query(
          `UPDATE calls SET status = ?, duration_seconds = ?
           WHERE id = ?`,
          [status, Number.isInteger(duration) && duration >= 0 ? duration : 0, previousCall.id]
        );
        await syncSurveillanceQueueForCall(connection, {
          callId: previousCall.id,
          previousStatus: previousCall.status,
          previousAgentId: previousCall.agent_id,
          status,
          agentId: previousCall.agent_id,
        });
        return previousCall;
      });
      if (call && call.agent_id) {
        await pool.query(
          `UPDATE agent_presence SET status = 'available', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND device_session_id = ? AND status = 'busy'
             AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
        [call.agent_id, call.agent_device_session_id]
        );
      }
    }
    return sendVoiceResponse(res, voiceResponse);
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate);

router.get('/token', (req, res) => {
  const config = getTwilioConfig();
  if (!config) {
    return res.status(503).json({ message: 'El servicio de telefonía no está configurado en el servidor.' });
  }
  const { deviceSessionId } = req.query;
  if (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId)) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const identity = `agent_${req.user.id}_${deviceSessionId.replace(/-/g, '')}`;
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, {
    identity,
    ttl: 3600,
  });
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: config.twimlAppSid,
    incomingAllow: true,
  }));
  return res.json({ token: token.toJwt(), identity });
});

router.get('/presence', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT CASE WHEN device_session_id IS NULL
                         OR updated_at < DATE_SUB(NOW(), INTERVAL 90 SECOND)
                   THEN 'offline' ELSE status END AS status,
              CASE WHEN device_session_id IS NOT NULL
                         AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
                   THEN TRUE ELSE FALSE END AS deviceRegistered,
              updated_at
       FROM agent_presence
       WHERE user_id = ?`,
      [req.user.id]
    );
    return res.json({ presence: rows[0] || { status: 'offline', deviceRegistered: false, updated_at: null } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence/register', async (req, res, next) => {
  const { deviceSessionId } = req.body || {};
  if (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId)) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const presence = await runInTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO agent_presence (user_id, status, device_session_id)
         VALUES (?, 'offline', NULL)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [req.user.id]
      );
      const [rows] = await connection.query(
        `SELECT device_session_id, status,
                updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) AS is_fresh
         FROM agent_presence
         WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      const current = rows[0];
      if (current && current.device_session_id &&
          current.device_session_id !== deviceSessionId && current.is_fresh &&
          current.status !== 'offline') {
        return { conflict: true };
      }

      const nextStatus = current?.device_session_id === deviceSessionId && current.status === 'busy'
        ? 'busy'
        : 'available';
      if (current) {
        await connection.query(
          `UPDATE agent_presence
           SET status = ?, device_session_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [nextStatus, deviceSessionId, req.user.id]
        );
      }
      return { status: nextStatus };
    });
    if (presence.conflict) {
      return res.status(409).json({ message: 'Ya existe otro dispositivo registrado para este usuario.' });
    }
    return res.json({ presence: { status: presence.status, deviceRegistered: true } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence/heartbeat', async (req, res, next) => {
  const { deviceSessionId } = req.body || {};
  if (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId)) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const heartbeat = await runInTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT device_session_id, status,
                updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND) AS is_fresh
         FROM agent_presence
         WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      if (!rows.length) return { refreshed: false, reason: 'not_registered' };

      const presence = rows[0];
      if (presence.device_session_id !== deviceSessionId) {
        return { refreshed: false, reason: 'session_replaced' };
      }

      if (!presence.is_fresh || !['available', 'busy'].includes(presence.status)) {
        await connection.query(
          `UPDATE agent_presence SET status = 'offline', device_session_id = NULL
           WHERE user_id = ? AND device_session_id = ?`,
          [req.user.id, deviceSessionId]
        );
        return { refreshed: false, reason: 'expired' };
      }

      const [result] = await connection.query(
        `UPDATE agent_presence SET updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND device_session_id = ?
           AND status IN ('available', 'busy')
           AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
        [req.user.id, deviceSessionId]
      );
      return result.affectedRows === 1
        ? { refreshed: true }
        : { refreshed: false, reason: 'expired' };
    });
    return res.json(heartbeat);
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence', async (req, res, next) => {
  const { status, deviceSessionId } = req.body || {};
  if (!['offline', 'available', 'busy'].includes(status)) {
    return res.status(400).json({ message: 'Estado de agente inválido.' });
  }

  if (status !== 'offline' &&
      (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId))) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }
  if (status === 'offline' && deviceSessionId != null &&
      (typeof deviceSessionId !== 'string' || !validDeviceSessionId.test(deviceSessionId))) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    if (status === 'offline') {
      await pool.query(
        `UPDATE agent_presence SET status = 'offline', device_session_id = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?${deviceSessionId ? ' AND device_session_id = ?' : ''}`,
        deviceSessionId ? [req.user.id, deviceSessionId] : [req.user.id]
      );
      return res.json({ presence: { status: 'offline', deviceRegistered: false } });
    }

    const [result] = await pool.query(
      `UPDATE agent_presence SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND device_session_id = ?
         AND status IN ('available', 'busy')
         AND updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
      [status, req.user.id, deviceSessionId]
    );
    if (result.affectedRows !== 1) {
      return res.status(409).json({ message: 'El dispositivo no está registrado o su sesión venció.' });
    }
    return res.json({ presence: { status } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
