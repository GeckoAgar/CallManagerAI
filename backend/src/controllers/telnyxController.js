const { randomUUID } = require('node:crypto');
const Telnyx = require('telnyx');
const telnyxModel = require('../models/telnyxModel');
const { runInTransaction, syncSurveillanceQueueForCall } = require('../utils/surveillanceQueue');
const { deviceSessionId: sessionSchema, phoneNumber: phoneSchema } = require('../utils/resourceValidation');

const phonePattern = /^\+[1-9]\d{7,14}$/;
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
  await telnyxModel.finishCall(connection, call, status);
  await syncSurveillanceQueueForCall(connection, {
    callId: call.id, previousStatus: call.status, previousAgentId: call.agent_id,
    status, agentId: call.agent_id,
  });
  await telnyxModel.releaseAgent(connection, call);
}

async function webhook(req, res, next) {
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
      if (!sessionSchema.safeParse(reservation).success || !payload.call_control_id || !payload.call_session_id) {
        if (payload.call_control_id) await settings.client.calls.actions.hangup(payload.call_control_id);
        return res.sendStatus(200);
      }

      const callId = await runInTransaction(async (connection) => {
        const call = await telnyxModel.lockReservation(connection, reservation);
        if (!call || call.phase !== 'reserved' || call.status !== 'queued' ||
            payload.to !== call.phone_number) {
          if (!call || call.call_control_id !== payload.call_control_id) {
            await settings.client.calls.actions.hangup(payload.call_control_id);
          }
          return null;
        }
        const presence = await telnyxModel.lockBusyAgent(connection, call.agent_id, call.agent_device_session_id);
        if (!presence) {
          await settings.client.calls.actions.hangup(payload.call_control_id);
          await endCall(connection, call);
          return null;
        }
        await telnyxModel.markTransferring(connection, call.id, payload.call_control_id, payload.call_session_id);
        return call.id;
      });
      if (callId) {
        try {
          await runInTransaction(async (connection) => {
            const call = await telnyxModel.lockTransfer(connection, callId);
            if (call?.phase !== 'transferring') return;
            await settings.client.calls.actions.transfer(payload.call_control_id, {
              to: call.phone_number,
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
            const call = await telnyxModel.lockCall(connection, callId);
            if (call) await endCall(connection, call);
          });
        }
      }
      return res.sendStatus(200);
    }

    if (['call.bridged', 'call.hangup'].includes(type) && payload.call_session_id) {
      await runInTransaction(async (connection) => {
        const call = await telnyxModel.lockSession(connection, payload.call_session_id);
        if (!call || call.phase === 'finished') return;
        if (type === 'call.bridged' && call.phase === 'transferring') {
          await telnyxModel.markActive(connection, call.id);
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
}

async function token(req, res) {
  const settings = config();
  const { deviceSessionId } = req.body || {};
  if (!settings) return res.status(503).json({ message: 'Telnyx no está configurado en el servidor.' });
  if (!sessionSchema.safeParse(deviceSessionId).success) {
    return res.status(400).json({ message: 'Identificador de sesión inválido.' });
  }
  try {
    const presence = await telnyxModel.availableAgent(req.user.id, deviceSessionId);
    if (!presence) return res.status(409).json({ message: 'El dispositivo no está disponible.' });
    if (!await ensureSafeConnection(settings)) {
      return res.status(503).json({ message: 'La conexión Telnyx debe tener call parking y el webhook configurados.' });
    }
    const { data } = await settings.client.telephonyCredentials.create({
      connection_id: settings.connectionId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      name: `callmanager-${req.user.id}`,
    });
    const credential = await settings.client.telephonyCredentials.createToken(data.id);
    return res.json({ token: credential, callerNumber: settings.phoneNumber });
  } catch (error) {
    console.error('Error preparando Telnyx:', error.code || error.name);
    return res.status(502).json({ message: 'No se pudo preparar la conexión Telnyx.' });
  }
}

async function createCall(req, res, next) {
  const settings = config();
  const { deviceSessionId, phoneNumber } = req.body || {};
  if (!settings) return res.status(503).json({ message: 'Telnyx no está configurado.' });
  if (!sessionSchema.safeParse(deviceSessionId).success || !phoneSchema.safeParse(phoneNumber).success) {
    return res.status(400).json({ message: 'Sesión o número de destino inválido.' });
  }
  try {
    if (!await ensureSafeConnection(settings)) {
      return res.status(503).json({ message: 'La conexión Telnyx no está configurada de forma segura.' });
    }
    const reservation = randomUUID();
    const callId = await runInTransaction(async (connection) => {
      const agent = await telnyxModel.availableAgent(req.user.id, deviceSessionId, connection, true);
      if (!agent) return null;
      return telnyxModel.createReservation(connection, req.user.id, deviceSessionId, phoneNumber, reservation);
    });
    if (!callId) return res.status(409).json({ message: 'El dispositivo no está disponible.' });
    return res.status(201).json({ reservation });
  } catch (error) {
    return next(error);
  }
}

async function callStatus(req, res, next) {
  const { reservation } = req.body || {};
  if (!sessionSchema.safeParse(reservation).success) return res.status(400).json({ message: 'Identificador inválido.' });
  try {
    const call = await telnyxModel.getStatus(reservation, req.user.id);
    if (!call) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ call });
  } catch (error) {
    return next(error);
  }
}

async function end(req, res, next) {
  const { reservation } = req.body || {};
  if (!config()) return res.status(503).json({ message: 'Telnyx no está configurado.' });
  if (!sessionSchema.safeParse(reservation).success) return res.status(400).json({ message: 'Identificador inválido.' });
  try {
    const outcome = await runInTransaction(async (connection) => {
      const call = await telnyxModel.lockOwnedReservation(connection, reservation, req.user.id);
      if (!call) return 'missing';
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
}

module.exports = { webhook, token, createCall, callStatus, end };
