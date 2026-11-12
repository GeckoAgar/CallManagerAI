const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getJwtSecret } = require('../config/env');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function findRoleByName(roleName) {
  const [rows] = await pool.query('SELECT * FROM roles WHERE name = ? LIMIT 1', [roleName]);
  return rows[0];
}

async function registerUser({ name, email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);

  if (existing.length) {
    throw new Error('El correo ya está registrado.');
  }

  const selectedRole = await findRoleByName('USER');
  if (!selectedRole) {
    throw new Error('Rol no encontrado.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
    [name, normalizedEmail, passwordHash, selectedRole.id, 'active']
  );

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.status, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [result.insertId]
  );

  return rows[0];
}

async function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const [rows] = await pool.query(
    `SELECT u.*, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.email = ?`,
    [normalizedEmail]
  );

  if (!rows.length) {
    throw new Error('Credenciales incorrectas.');
  }

  const user = rows[0];
  if (user.status !== 'active') {
    throw new Error('La cuenta no está activa.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error('Credenciales incorrectas.');
  }

  return {
    token: generateToken({ id: user.id, email: user.email, roleName: user.role_name }),
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
