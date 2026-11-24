const jwt = require('jsonwebtoken');
const authModel = require('../models/authModel');
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
    const user = await authModel.findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'Usuario no encontrado.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'La cuenta no está activa.' });
    }
    if ((decoded.tokenVersion ?? 0) !== user.token_version) {
      return res.status(401).json({ message: 'La sesión ya no es válida. Inicia sesión nuevamente.' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.role_id,
      roleName: user.role_name,
      status: user.status,
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
