const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');
const { hasText, isPositiveId, optionalText } = require('../utils/resourceValidation');

const reservedRoles = new Set(['ADMIN', 'USER']);

router.use(authenticate, requireRole('ADMIN'));

router.get('/', async (req, res, next) => {
  try {
    const [roles] = await pool.query('SELECT id, name, description, created_at FROM roles ORDER BY id ASC');
    return res.json({ roles });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const { name, description = '' } = req.body;
  const normalizedName = typeof name === 'string' ? name.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(normalizedName) || !optionalText(description, 255)) {
    return res.status(400).json({ message: 'Nombre de rol (2-50 caracteres, letras, números y _) y descripción válidos son obligatorios.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO roles (name, description) VALUES (?, ?)',
      [normalizedName, description.trim()]
    );
    const [rows] = await pool.query('SELECT id, name, description, created_at FROM roles WHERE id = ?', [result.insertId]);
    return res.status(201).json({ role: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  const roleId = Number(req.params.id);
  if (!isPositiveId(roleId)) return res.status(400).json({ message: 'Identificador de rol inválido.' });
  const body = req.body;
  if (!body || Object.keys(body).length === 0 || Object.keys(body).some((key) => !['name', 'description'].includes(key))) {
    return res.status(400).json({ message: 'Proporciona un nombre o descripción válidos para actualizar.' });
  }
  if (Object.hasOwn(body, 'name') && (!hasText(body.name, 50) || !/^[A-Za-z][A-Za-z0-9_]{1,49}$/.test(body.name.trim()))) {
    return res.status(400).json({ message: 'Nombre de rol inválido.' });
  }
  if (Object.hasOwn(body, 'description') && !optionalText(body.description, 255)) {
    return res.status(400).json({ message: 'Descripción inválida.' });
  }

  try {
    const [currentRows] = await pool.query('SELECT id, name FROM roles WHERE id = ?', [roleId]);
    if (!currentRows.length) return res.status(404).json({ message: 'Rol no encontrado.' });
    const nextName = Object.hasOwn(body, 'name') ? body.name.trim().toUpperCase() : currentRows[0].name;
    if (reservedRoles.has(currentRows[0].name) && nextName !== currentRows[0].name) {
      return res.status(409).json({ message: 'No se puede renombrar el rol reservado del sistema.' });
    }

    const assignments = [];
    const values = [];
    if (Object.hasOwn(body, 'name')) { assignments.push('name = ?'); values.push(nextName); }
    if (Object.hasOwn(body, 'description')) { assignments.push('description = ?'); values.push(body.description.trim()); }
    values.push(roleId);
    await pool.query(`UPDATE roles SET ${assignments.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT id, name, description, created_at FROM roles WHERE id = ?', [roleId]);
    return res.json({ role: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const roleId = Number(req.params.id);
  if (!isPositiveId(roleId)) return res.status(400).json({ message: 'Identificador de rol inválido.' });

  try {
    const [rows] = await pool.query('SELECT name FROM roles WHERE id = ?', [roleId]);
    if (!rows.length) return res.status(404).json({ message: 'Rol no encontrado.' });
    if (reservedRoles.has(rows[0].name)) {
      return res.status(409).json({ message: 'No se pueden eliminar roles reservados del sistema.' });
    }

    await pool.query('DELETE FROM roles WHERE id = ?', [roleId]);
    return res.json({ message: 'Rol eliminado.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
