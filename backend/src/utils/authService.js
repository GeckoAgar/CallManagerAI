const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authModel = require('../models/authModel');
const { getJwtSecret } = require('../config/env');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, tokenVersion: user.tokenVersion ?? user.token_version ?? 0 },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function registerUser({ name, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await authModel.findUserIdByEmail(normalizedEmail);

  if (existing) {
    throw new Error('El correo ya está registrado.');
  }

  const selectedRole = await authModel.findRoleByName('USER');
  if (!selectedRole) {
    throw new Error('Rol no encontrado.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = await authModel.createUser(name, normalizedEmail, passwordHash, selectedRole.id);
  const user = await authModel.findUserById(id);
  const { role_id, ...registeredUser } = user;
  return { ...registeredUser, tokenVersion: user.token_version };
}

async function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await authModel.findUserForLogin(normalizedEmail);
  if (!user) {
    throw new Error('Credenciales incorrectas.');
  }

  if (user.status !== 'active') {
    throw new Error('La cuenta no está activa.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error('Credenciales incorrectas.');
  }

  return {
    token: generateToken({
      id: user.id,
      email: user.email,
      roleName: user.role_name,
      tokenVersion: user.token_version,
    }),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      roleName: user.role_name,
      status: user.status,
    },
  };
}

module.exports = { generateToken, registerUser, loginUser };
