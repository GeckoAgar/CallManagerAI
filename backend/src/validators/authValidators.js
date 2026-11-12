const { body, validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Datos inválidos', errors: errors.array() });
  }
  next();
}

const registerValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('El nombre es obligatorio.'),
  body('email').trim().isEmail().withMessage('Debe proporcionar un email válido.'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.'),
];

const loginValidation = [
  body('email').trim().isEmail().withMessage('Debe proporcionar un email válido.'),
  body('password').notEmpty().withMessage('La contraseña es obligatoria.'),
];

module.exports = { registerValidation, loginValidation, validateRequest };
