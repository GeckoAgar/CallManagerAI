const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { allowedStatuses, hasText, isPositiveId, optionalText, validEmail, validEnum } = require('../utils/resourceValidation');

router.use(authenticate);

function contactAccessFilter(user, alias = 'c') {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ` AND ${alias ? `${alias}.` : ''}owner_id = ?`, values: [user.id] };
}

function validateContact(body, partial = false) {
  const fields = ['name', 'company', 'phone', 'email', 'status', 'owner_id'];
  if (!body || Object.keys(body).some((key) => !fields.includes(key))) return 'Campos de contacto inválidos.';
  if (!partial && !hasText(body.name, 120)) return 'El nombre del contacto es obligatorio.';
  if (Object.hasOwn(body, 'name') && !hasText(body.name, 120)) return 'Nombre inválido.';
  if (Object.hasOwn(body, 'company') && !optionalText(body.company, 120)) return 'Empresa inválida.';
  if (Object.hasOwn(body, 'phone') && !optionalText(body.phone, 30)) return 'Teléfono inválido.';
  if (Object.hasOwn(body, 'email') && body.email !== '' && !validEmail(body.email)) return 'Correo inválido.';
  if (Object.hasOwn(body, 'status') && !validEnum(body.status, allowedStatuses.contact)) return 'Estado inválido.';
  if (Object.hasOwn(body, 'owner_id') && body.owner_id !== null && body.owner_id !== '' && !isPositiveId(body.owner_id)) {
    return 'Propietario inválido.';
  }
  return null;
}

router.get('/', async (req, res, next) => {
  const filter = contactAccessFilter(req.user);
  try {
    const [contacts] = await pool.query(
      `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at,
              u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
       WHERE 1 = 1${filter.clause}
       ORDER BY c.id DESC`,
      filter.values
    );
    return res.json({ contacts });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  const filter = contactAccessFilter(req.user);
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at,
              u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contacto no encontrado.' });
    return res.json({ contact: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const validationError = validateContact(req.body);
  if (validationError) return res.status(400).json({ message: validationError });

  const { name, company = null, phone = null, email = null, status = 'active' } = req.body;
  const ownerId = req.user.roleName === 'ADMIN'
    ? (req.body.owner_id ? Number(req.body.owner_id) : null)
    : req.user.id;

  try {
    const [result] = await pool.query(
      `INSERT INTO contacts (owner_id, name, company, phone, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ownerId, name.trim(), company || null, phone || null, email ? email.trim().toLowerCase() : null, status]
    );
    const [rows] = await pool.query(
      `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at,
              u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?`,
      [result.insertId]
    );
    return res.status(201).json({ contact: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  const validationError = validateContact(req.body, true);
  if (validationError) return res.status(400).json({ message: validationError });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'owner_id')) {
    return res.status(403).json({ message: 'Solo ADMIN puede cambiar el propietario de un contacto.' });
  }

  const filter = contactAccessFilter(req.user, '');
  const assignments = [];
  const values = [];
  const fields = {
    name: (value) => value.trim(),
    company: (value) => value || null,
    phone: (value) => value || null,
    email: (value) => value ? value.trim().toLowerCase() : null,
    status: (value) => value,
    owner_id: (value) => value ? Number(value) : null,
  };
  for (const [field, normalize] of Object.entries(fields)) {
    if (Object.hasOwn(req.body, field)) {
      assignments.push(`${field} = ?`);
      values.push(normalize(req.body[field]));
    }
  }
  if (!assignments.length) return res.status(400).json({ message: 'No hay campos para actualizar.' });

  try {
    const [result] = await pool.query(
      `UPDATE contacts SET ${assignments.join(', ')} WHERE id = ?${filter.clause}`,
      [...values, id, ...filter.values]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Contacto no encontrado.' });
    const [rows] = await pool.query(
      `SELECT c.id, c.owner_id, c.name, c.company, c.phone, c.email, c.status, c.created_at,
              u.name AS owner_name
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?`,
      [id]
    );
    return res.json({ contact: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  const filter = contactAccessFilter(req.user, '');
  try {
    const [result] = await pool.query(
      `DELETE FROM contacts WHERE id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Contacto no encontrado.' });
    return res.json({ message: 'Contacto eliminado.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
