const express = require('express');
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { isPositiveId } = require('../utils/resourceValidation');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  const before = req.query.before;
  if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))) {
    return res.status(400).json({ message: 'Cursor de notificaciones inválido.' });
  }
  try {
    const [notifications] = await pool.query(
      `SELECT id, type, message, read_at, created_at
       FROM notifications WHERE user_id = ?${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT 50`,
      before ? [req.user.id, Number(before)] : [req.user.id]
    );
    const [[count]] = await pool.query(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    const nextBefore = notifications.length === 50 ? notifications[notifications.length - 1].id : null;
    return res.json({ notifications, unreadCount: Number(count.unreadCount), nextBefore });
  } catch (error) {
    return next(error);
  }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL',
      [req.user.id]
    );
    return res.json({ message: 'Notificaciones marcadas como leídas.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de notificación inválido.' });
  try {
    const [result] = await pool.query(
      'UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Notificación no encontrada.' });
    return res.json({ message: 'Notificación marcada como leída.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de notificación inválido.' });
  try {
    const [result] = await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Notificación no encontrada.' });
    return res.json({ message: 'Notificación eliminada.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
