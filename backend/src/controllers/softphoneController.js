const softphoneModel = require('../models/softphoneModel');
const { runInTransaction } = require('../utils/surveillanceQueue');
const { deviceSessionId: deviceSessionSchema } = require('../utils/resourceValidation');
const { z } = require('zod');

const presenceStatusSchema = z.enum(['offline', 'available', 'busy']);

async function getPresence(req, res, next) {
  try {
    const presence = await softphoneModel.getPresence(req.user.id);
    return res.json({ presence: presence || { status: 'offline', deviceRegistered: false, updated_at: null } });
  } catch (error) {
    return next(error);
  }
}

async function register(req, res, next) {
  const { deviceSessionId } = req.body || {};
  if (!deviceSessionSchema.safeParse(deviceSessionId).success) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const presence = await runInTransaction(async (connection) => {
      await softphoneModel.ensurePresence(connection, req.user.id);
      const current = await softphoneModel.lockPresence(connection, req.user.id);
      if (current && current.device_session_id &&
          current.device_session_id !== deviceSessionId && current.is_fresh &&
          current.status !== 'offline') {
        return { conflict: true };
      }

      const nextStatus = current?.device_session_id === deviceSessionId && current.status === 'busy'
        ? 'busy'
        : 'available';
      if (current) {
        await softphoneModel.registerDevice(connection, req.user.id, deviceSessionId, nextStatus);
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
}

async function heartbeat(req, res, next) {
  const { deviceSessionId } = req.body || {};
  if (!deviceSessionSchema.safeParse(deviceSessionId).success) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    const heartbeat = await runInTransaction(async (connection) => {
      const presence = await softphoneModel.lockPresence(connection, req.user.id);
      if (!presence) return { refreshed: false, reason: 'not_registered' };
      if (presence.device_session_id !== deviceSessionId) {
        return { refreshed: false, reason: 'session_replaced' };
      }

      if (!presence.is_fresh || !['available', 'busy'].includes(presence.status)) {
        await softphoneModel.expireDevice(connection, req.user.id, deviceSessionId);
        return { refreshed: false, reason: 'expired' };
      }

      const affectedRows = await softphoneModel.heartbeat(connection, req.user.id, deviceSessionId);
      return affectedRows === 1
        ? { refreshed: true }
        : { refreshed: false, reason: 'expired' };
    });
    return res.json(heartbeat);
  } catch (error) {
    return next(error);
  }
}

async function setPresence(req, res, next) {
  const { status, deviceSessionId } = req.body || {};
  if (!presenceStatusSchema.safeParse(status).success) {
    return res.status(400).json({ message: 'Estado de agente inválido.' });
  }

  const sessionSchema = status === 'offline' ? deviceSessionSchema.nullish() : deviceSessionSchema;
  if (!sessionSchema.safeParse(deviceSessionId).success) {
    return res.status(400).json({ message: 'Identificador de sesión del dispositivo inválido.' });
  }

  try {
    if (status === 'offline') {
      await softphoneModel.setOffline(req.user.id, deviceSessionId);
      return res.json({ presence: { status: 'offline', deviceRegistered: false } });
    }

    const affectedRows = await softphoneModel.setPresence(req.user.id, deviceSessionId, status);
    if (affectedRows !== 1) {
      return res.status(409).json({ message: 'El dispositivo no está registrado o su sesión venció.' });
    }
    return res.json({ presence: { status } });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getPresence, register, heartbeat, setPresence };
