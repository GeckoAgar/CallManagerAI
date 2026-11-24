const { registerUser, loginUser, generateToken } = require('../utils/authService');
const { runInTransaction } = require('../utils/surveillanceQueue');
const authModel = require('../models/authModel');

async function register(req, res) {
  try {
    const user = await registerUser(req.body);
    const token = generateToken(user);
    return res.status(201).json({ message: 'Usuario registrado con éxito', token, user });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.message === 'El correo ya está registrado.') {
      return res.status(409).json({ message: 'El correo ya está registrado.' });
    }
    console.error('Registration failed:', error);
    return res.status(500).json({ message: 'No se pudo completar el registro.' });
  }
}

async function login(req, res) {
  try {
    const result = await loginUser(req.body);
    return res.json({ message: 'Inicio de sesión exitoso', ...result });
  } catch (error) {
    if (error.message === 'Credenciales incorrectas.') return res.status(401).json({ message: error.message });
    if (error.message === 'La cuenta no está activa.') return res.status(403).json({ message: error.message });
    console.error('Login failed:', error);
    return res.status(500).json({ message: 'No se pudo completar el inicio de sesión.' });
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

async function logout(req, res, next) {
  try {
    await runInTransaction((connection) => authModel.invalidateSession(connection, req.user.id));
    return res.json({ message: 'Sesión cerrada correctamente.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, me, logout };
