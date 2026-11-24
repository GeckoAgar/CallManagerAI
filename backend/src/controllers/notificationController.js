const { z } = require('zod');
const notificationModel = require('../models/notificationModel');
const { isPositiveId } = require('../utils/resourceValidation');

const cursorSchema = z.string().regex(/^[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value)));

async function list(req, res, next) {
  const before = req.query.before;
  if (!cursorSchema.optional().safeParse(before).success) {
    return res.status(400).json({ message: 'Cursor de notificaciones inválido.' });
  }
  try {
    const notifications = await notificationModel.list(req.user.id, before);
    const unreadCount = await notificationModel.unreadCount(req.user.id);
    const nextBefore = notifications.length === 50 ? notifications[notifications.length - 1].id : null;
    return res.json({ notifications, unreadCount, nextBefore });
  } catch (error) {
    return next(error);
  }
}

async function readAll(req, res, next) {
  try {
    await notificationModel.readAll(req.user.id);
    return res.json({ message: 'Notificaciones marcadas como leídas.' });
  } catch (error) {
    return next(error);
  }
}

async function read(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de notificación inválido.' });
  try {
    if (!await notificationModel.read(id, req.user.id)) {
      return res.status(404).json({ message: 'Notificación no encontrada.' });
    }
    return res.json({ message: 'Notificación marcada como leída.' });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de notificación inválido.' });
  try {
    if (!await notificationModel.remove(id, req.user.id)) {
      return res.status(404).json({ message: 'Notificación no encontrada.' });
    }
    return res.json({ message: 'Notificación eliminada.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, readAll, read, remove };
