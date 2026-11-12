const express = require('express');
const router = express.Router();
const { registerValidation, loginValidation, validateRequest } = require('../validators/authValidators');
const { registerUser, loginUser, generateToken } = require('../utils/authService');
const { authenticate } = require('../middlewares/auth');

router.post('/register', registerValidation, validateRequest, async (req, res) => {
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
});

router.post('/login', loginValidation, validateRequest, async (req, res) => {
  try {
    const result = await loginUser(req.body);
    return res.json({ message: 'Inicio de sesión exitoso', ...result });
  } catch (error) {
    if (error.message === 'Credenciales incorrectas.') {
      return res.status(401).json({ message: error.message });
    }
    if (error.message === 'La cuenta no está activa.') {
      return res.status(403).json({ message: error.message });
    }

    console.error('Login failed:', error);
    return res.status(500).json({ message: 'No se pudo completar el inicio de sesión.' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  return res.json({ user: req.user });
});

router.post('/logout', authenticate, async (req, res) => {
  return res.json({ message: 'Sesión cerrada correctamente.' });
});

module.exports = router;
