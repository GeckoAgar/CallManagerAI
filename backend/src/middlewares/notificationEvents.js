const { pool } = require('../config/db');

const events = [
  { method: 'POST', path: /^\/api\/users$/, type: 'info', message: 'Se creó un usuario.' },
  { method: 'PATCH', path: /^\/api\/users\/\d+$/, type: 'info', message: 'Se actualizó un usuario.' },
  { method: 'POST', path: /^\/api\/roles$/, type: 'info', message: 'Se creó un rol.' },
  { method: 'PATCH', path: /^\/api\/roles\/\d+$/, type: 'info', message: 'Se actualizó un rol.' },
  { method: 'DELETE', path: /^\/api\/users\/\d+$/, type: 'warning', message: 'Se eliminó un usuario.' },
  { method: 'DELETE', path: /^\/api\/roles\/\d+$/, type: 'warning', message: 'Se eliminó un rol.' },
  { method: 'DELETE', path: /^\/api\/contacts\/\d+$/, type: 'warning', message: 'Se eliminó un contacto.' },
  { method: 'DELETE', path: /^\/api\/calls\/\d+$/, type: 'warning', message: 'Se eliminó una llamada.' },
  { method: 'DELETE', path: /^\/api\/recordings\/\d+$/, type: 'warning', message: 'Se eliminó una grabación.' },
  { method: 'POST', path: /^\/api\/contacts\/\d+\/restore$/, type: 'info', message: 'Se restauró un contacto.' },
  { method: 'POST', path: /^\/api\/auth\/logout$/, type: 'info', message: 'Se cerró la sesión.' },
];

function notificationEvents(req, res, next) {
  const path = req.originalUrl.split('?')[0];
  const event = events.find((item) => item.method === req.method && item.path.test(path));
  if (event) {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300 || !req.user) return;
      pool.query(
        'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)',
        [req.user.id, event.type, event.message]
      ).catch((error) => console.error('Failed to record notification:', error));
    });
  }
  next();
}

module.exports = { notificationEvents };
