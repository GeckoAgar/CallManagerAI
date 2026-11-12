const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const {
  allowedStatuses,
  hasText,
  isPositiveId,
  validEnum,
  validNonNegativeNumber,
  validScore,
} = require('../utils/resourceValidation');

router.use(authenticate);

function callAccessFilter(user, alias = 'c') {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ` AND ${alias ? `${alias}.` : ''}agent_id = ?`, values: [user.id] };
}

function validateCall(body, partial = false) {
  const allowedFields = ['contact_id', 'agent_id', 'phone_number', 'direction', 'status', 'duration_seconds', 'score'];
  if (!body || Object.keys(body).some((field) => !allowedFields.includes(field))) return 'Campos de llamada inválidos.';
  if (!partial && !hasText(body.phone_number, 30)) return 'El número telefónico es obligatorio.';
  if (Object.hasOwn(body, 'phone_number') && !hasText(body.phone_number, 30)) return 'Número telefónico inválido.';
  if (Object.hasOwn(body, 'contact_id') && body.contact_id !== null && body.contact_id !== '' && !isPositiveId(body.contact_id)) return 'Contacto inválido.';
  if (Object.hasOwn(body, 'agent_id') && body.agent_id !== null && body.agent_id !== '' && !isPositiveId(body.agent_id)) return 'Asesor inválido.';
  if (Object.hasOwn(body, 'direction') && !validEnum(body.direction, ['inbound', 'outbound'])) return 'Dirección de llamada inválida.';
  if (Object.hasOwn(body, 'status') && !validEnum(body.status, allowedStatuses.call)) return 'Estado de llamada inválido.';
  if (Object.hasOwn(body, 'duration_seconds') && !validNonNegativeNumber(body.duration_seconds, 2147483647)) return 'Duración inválida.';
  if (Object.hasOwn(body, 'score') && !validScore(body.score)) return 'La calificación debe estar entre 0 y 100.';
  return null;
}

async function validateContactAccess(contactId, user) {
  if (contactId == null || contactId === '') return true;
  const [contacts] = await pool.query(
    `SELECT id FROM contacts WHERE id = ?${user.roleName === 'ADMIN' ? '' : ' AND owner_id = ?'}`,
    user.roleName === 'ADMIN' ? [contactId] : [contactId, user.id]
  );
  return contacts.length > 0;
}

router.get('/', async (req, res, next) => {
  const filter = callAccessFilter(req.user);
  try {
    const [calls] = await pool.query(
      `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
              c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
       FROM calls c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = c.agent_id
       WHERE 1 = 1${filter.clause}
       ORDER BY c.id DESC`,
      filter.values
    );
    return res.json({ calls });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  const filter = callAccessFilter(req.user);
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
              c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
       FROM calls c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = c.agent_id
       WHERE c.id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!rows.length) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ call: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const validationError = validateCall(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'agent_id')) {
    return res.status(403).json({ message: 'No puedes asignar llamadas a otro usuario.' });
  }

  try {
    const contactId = req.body.contact_id || null;
    if (!(await validateContactAccess(contactId, req.user))) {
      return res.status(400).json({ message: 'El contacto no existe o no está disponible para tu cuenta.' });
    }
    const agentId = req.user.roleName === 'ADMIN'
      ? (req.body.agent_id ? Number(req.body.agent_id) : req.user.id)
      : req.user.id;
    const [result] = await pool.query(
      `INSERT INTO calls (contact_id, agent_id, phone_number, direction, status, duration_seconds, score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        contactId,
        agentId,
        req.body.phone_number.trim(),
        req.body.direction || 'inbound',
        req.body.status || 'queued',
        req.body.duration_seconds == null ? 0 : Number(req.body.duration_seconds),
        req.body.score == null ? 0 : Number(req.body.score),
      ]
    );
    const [rows] = await pool.query(
      `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
              c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
       FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = c.agent_id WHERE c.id = ?`,
      [result.insertId]
    );
    return res.status(201).json({ call: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  const validationError = validateCall(req.body, true);
  if (validationError) return res.status(400).json({ message: validationError });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'agent_id')) {
    return res.status(403).json({ message: 'No puedes reasignar una llamada.' });
  }

  const filter = callAccessFilter(req.user, '');
  const normalizers = {
    contact_id: (value) => value || null,
    agent_id: (value) => value ? Number(value) : null,
    phone_number: (value) => value.trim(),
    direction: (value) => value,
    status: (value) => value,
    duration_seconds: (value) => Number(value),
    score: (value) => Number(value),
  };
  const assignments = [];
  const values = [];
  for (const [field, normalize] of Object.entries(normalizers)) {
    if (Object.hasOwn(req.body, field)) {
      assignments.push(`${field} = ?`);
      values.push(normalize(req.body[field]));
    }
  }
  if (!assignments.length) return res.status(400).json({ message: 'No hay campos para actualizar.' });

  try {
    if (Object.hasOwn(req.body, 'contact_id') && !(await validateContactAccess(req.body.contact_id, req.user))) {
      return res.status(400).json({ message: 'El contacto no existe o no está disponible para tu cuenta.' });
    }

    const [result] = await pool.query(
      `UPDATE calls SET ${assignments.join(', ')} WHERE id = ?${filter.clause}`,
      [...values, id, ...filter.values]
    );
    if (!result.affectedRows) {
      const [existing] = await pool.query(`SELECT id FROM calls WHERE id = ?${filter.clause}`, [id, ...filter.values]);
      if (!existing.length) return res.status(404).json({ message: 'Llamada no encontrada.' });
    }
    const [rows] = await pool.query(
      `SELECT c.id, c.contact_id, c.agent_id, c.phone_number, c.direction, c.status,
              c.duration_seconds, c.score, c.created_at, ct.name AS contact_name, u.name AS agent_name
       FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = c.agent_id WHERE c.id = ?`,
      [id]
    );
    return res.json({ call: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  const filter = callAccessFilter(req.user, '');
  try {
    const [result] = await pool.query(
      `DELETE FROM calls WHERE id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ message: 'Llamada eliminada.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
