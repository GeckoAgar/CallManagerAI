const express = require('express');
const twilio = require('twilio');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');

const VoiceResponse = twilio.twiml.VoiceResponse;
const validPhoneNumber = /^\+[1-9]\d{7,14}$/;

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

async function saveCall({ callSid, agentId, phoneNumber, direction }) {
  await pool.query(
    `INSERT IGNORE INTO calls
       (agent_id, phone_number, direction, status, duration_seconds, score, provider_call_sid)
     VALUES (?, ?, ?, 'queued', 0, 0, ?)`,
    [agentId, phoneNumber, direction, callSid]
  );
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
      const identityMatch = /^client:agent_(\d+)$/.exec(from);
      if (!identityMatch || !callSid || !validPhoneNumber.test(to)) {
        voiceResponse.say('The requested call cannot be completed.');
        voiceResponse.hangup();
        return sendVoiceResponse(res, voiceResponse);
      }

      const agentId = Number(identityMatch[1]);
      await saveCall({ callSid, agentId, phoneNumber: to, direction: 'outbound' });
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

    const [agents] = await pool.query(
      `SELECT p.user_id
       FROM agent_presence p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'available' AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
         AND u.status = 'active'
       ORDER BY p.updated_at ASC
       LIMIT 1`
    );
    const agentId = agents.length ? agents[0].user_id : null;
    await saveCall({ callSid, agentId, phoneNumber: from, direction: 'inbound' });

    if (!agentId) {
      await pool.query(
        "UPDATE calls SET status = 'failed' WHERE provider_call_sid = ?",
        [callSid]
      );
      voiceResponse.say('There are no agents available to take your call. Please try again later.');
      voiceResponse.hangup();
      return sendVoiceResponse(res, voiceResponse);
    }

    await pool.query(
      `UPDATE agent_presence SET status = 'busy', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND status = 'available'`,
      [agentId]
    );
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
    }, `agent_${agentId}`);
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
      if (active || completed) {
        const status = active ? 'active' : 'completed';
        const childDuration = Number(req.body.CallDuration);
        await pool.query(
          `UPDATE calls SET status = ?,
             duration_seconds = CASE WHEN ? = 'completed' AND ? >= 0 THEN ? ELSE duration_seconds END
           WHERE provider_call_sid = ?`,
          [
            status,
            childStatus,
            Number.isInteger(childDuration) ? childDuration : -1,
            Number.isInteger(childDuration) && childDuration >= 0 ? childDuration : 0,
            parentCallSid,
          ]
        );
      }
      return sendVoiceResponse(res, voiceResponse);
    }

    if (callSid) {
      const status = result === 'completed' ? 'completed' : 'failed';
      const [calls] = await pool.query(
        'SELECT agent_id FROM calls WHERE provider_call_sid = ?',
        [callSid]
      );
      await pool.query(
        `UPDATE calls SET status = ?, duration_seconds = ?
         WHERE provider_call_sid = ?`,
        [status, Number.isInteger(duration) && duration >= 0 ? duration : 0, callSid]
      );
      if (calls.length && calls[0].agent_id) {
        await pool.query(
          `UPDATE agent_presence SET status = 'available', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND status = 'busy'`,
          [calls[0].agent_id]
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

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, {
    identity: `agent_${req.user.id}`,
    ttl: 3600,
  });
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: config.twimlAppSid,
    incomingAllow: true,
  }));
  return res.json({ token: token.toJwt(), identity: `agent_${req.user.id}` });
});

router.get('/presence', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT status, updated_at FROM agent_presence WHERE user_id = ?',
      [req.user.id]
    );
    return res.json({ presence: rows[0] || { status: 'offline', updated_at: null } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/presence', async (req, res, next) => {
  const { status } = req.body || {};
  if (!['offline', 'available', 'busy'].includes(status)) {
    return res.status(400).json({ message: 'Estado de agente inválido.' });
  }

  try {
    await pool.query(
      `INSERT INTO agent_presence (user_id, status)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, status]
    );
    return res.json({ presence: { status } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
