const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getJwtSecret } = require('../config/env');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Token requerido.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: 'Token inválido o expirado.' });
    }
    return next(error);
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Usuario no encontrado.' });
    }

    if (rows[0].status !== 'active') {
      return res.status(403).json({ message: 'La cuenta no está activa.' });
    }

    req.user = {
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      roleId: rows[0].role_id,
      roleName: rows[0].role_name,
      status: rows[0].status,
    };

    next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado.' });
    }

    const userRole = req.user.roleName || req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ message: 'No tienes permisos para realizar esta acción.' });
    }

    next();
  };
}

module.exports = { authenticate, requireRole };
