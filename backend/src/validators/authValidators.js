const { z } = require('zod');
const isEmail = require('validator/lib/isEmail');

const email = z.string({ required_error: 'Debe proporcionar un email válido.', invalid_type_error: 'Debe proporcionar un email válido.' })
  .trim().refine(isEmail, 'Debe proporcionar un email válido.');
const registerSchema = z.object({
  name: z.string({ required_error: 'El nombre es obligatorio.', invalid_type_error: 'El nombre es obligatorio.' })
    .trim().min(2, 'El nombre es obligatorio.'),
  email,
  password: z.string({ required_error: 'La contraseña debe tener al menos 6 caracteres.', invalid_type_error: 'La contraseña debe tener al menos 6 caracteres.' })
    .min(6, 'La contraseña debe tener al menos 6 caracteres.'),
}).passthrough();
const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'La contraseña es obligatoria.', invalid_type_error: 'La contraseña es obligatoria.' })
    .min(1, 'La contraseña es obligatoria.'),
}).passthrough();

function validateRequest(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        type: 'field',
        value: issue.path.length ? req.body?.[issue.path[0]] : req.body,
        msg: issue.message,
        path: issue.path.join('.'),
        location: 'body',
      }));
      return res.status(400).json({ message: 'Datos inválidos', errors });
    }
    req.body = result.data;
    return next();
  };
}

module.exports = {
  registerValidation: validateRequest(registerSchema),
  loginValidation: validateRequest(loginSchema),
};
