const bcrypt = require('bcryptjs');
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');
const { allowedStatuses, hasText, isPositiveId, validEmail, validEnum } = require('../utils/resourceValidation');

async function ensureAdminRemains(connection, userId, nextRoleId, nextStatus) {
  const [currentRows] = await connection.query(
    `SELECT u.status, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? FOR UPDATE`,
    [userId]
  );
  if (!currentRows.length) return false;

  const current = currentRows[0];
  if (current.role_name !== 'ADMIN' || (nextRoleId == null && nextStatus == null)) return true;

  let nextRole = current.role_name;
  if (nextRoleId != null) {
    const [roles] = await connection.query('SELECT name FROM roles WHERE id = ?', [nextRoleId]);
    if (!roles.length) return null;
    nextRole = roles[0].name;
  }
  const finalStatus = nextStatus || current.status;

  if (nextRole === 'ADMIN' && finalStatus === 'active') return true;
  const [admins] = await connection.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'ADMIN' AND u.status = 'active' AND u.id <> ? FOR UPDATE`,
    [userId]
  );
  return admins.length > 0;
}

router.get('/', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id DESC`
    );
    return res.json({ users: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  const requestedId = Number(req.params.id);
  if (!isPositiveId(requestedId)) {
    return res.status(400).json({ message: 'Identificador de usuario inválido.' });
  }
  if (req.user.roleName !== 'ADMIN' && req.user.id !== requestedId) {
    return res.status(403).json({ message: 'Solo puedes consultar tu propio perfil.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [requestedId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });
    return res.json({ user: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  const { name, email, password, role_id: roleId, status = 'active' } = req.body;
  if (!hasText(name, 120) || !validEmail(email) || typeof password !== 'string' || password.length < 6 ||
      !isPositiveId(roleId) || !validEnum(status, allowedStatuses.user)) {
    return res.status(400).json({ message: 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), passwordHash, Number(roleId), status]
    );
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [result.insertId]
    );
    return res.status(201).json({ user: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  const userId = Number(req.params.id);
  if (!isPositiveId(userId)) return res.status(400).json({ message: 'Identificador de usuario inválido.' });

  const body = req.body;
  const allowedFields = ['name', 'email', 'password', 'role_id', 'status'];
  if (!body || Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return res.status(400).json({ message: 'Proporciona campos válidos para actualizar.' });
  }
  if (Object.hasOwn(body, 'name') && !hasText(body.name, 120)) return res.status(400).json({ message: 'Nombre inválido.' });
  if (Object.hasOwn(body, 'email') && !validEmail(body.email)) return res.status(400).json({ message: 'Correo inválido.' });
  if (Object.hasOwn(body, 'password') && (typeof body.password !== 'string' || body.password.length < 6)) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (Object.hasOwn(body, 'role_id') && !isPositiveId(body.role_id)) return res.status(400).json({ message: 'Rol inválido.' });
  if (Object.hasOwn(body, 'status') && !validEnum(body.status, allowedStatuses.user)) return res.status(400).json({ message: 'Estado inválido.' });
  if (userId === req.user.id &&
      (Object.hasOwn(body, 'role_id') || (Object.hasOwn(body, 'status') && body.status !== 'active'))) {
    return res.status(400).json({ message: 'No puedes cambiar tu propio rol ni desactivar tu cuenta desde esta operación.' });
  }

  const fields = [];
  const values = [];
  if (Object.hasOwn(body, 'name')) { fields.push('name = ?'); values.push(body.name.trim()); }
  if (Object.hasOwn(body, 'email')) { fields.push('email = ?'); values.push(body.email.trim().toLowerCase()); }
  if (Object.hasOwn(body, 'role_id')) { fields.push('role_id = ?'); values.push(Number(body.role_id)); }
  if (Object.hasOwn(body, 'status')) { fields.push('status = ?'); values.push(body.status); }

  let connection;
  try {
    if (Object.hasOwn(body, 'password')) {
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(body.password, 10));
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const remains = await ensureAdminRemains(
      connection,
      userId,
      Object.hasOwn(body, 'role_id') ? Number(body.role_id) : null,
      Object.hasOwn(body, 'status') ? body.status : null
    );
    if (remains === false) {
      await connection.rollback();
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    if (remains === null) {
      await connection.rollback();
      return res.status(400).json({ message: 'El rol seleccionado no existe.' });
    }
    if (!remains) {
      await connection.rollback();
      return res.status(409).json({ message: 'Debe quedar al menos un administrador activo.' });
    }

    values.push(userId);
    await connection.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    await connection.commit();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });
    return res.json({ user: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  const userId = Number(req.params.id);
  if (!isPositiveId(userId)) return res.status(400).json({ message: 'Identificador de usuario inválido.' });
  if (userId === req.user.id) return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta.' });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const remains = await ensureAdminRemains(connection, userId, null, 'inactive');
    if (remains === false) {
      await connection.rollback();
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    if (!remains) {
      await connection.rollback();
      return res.status(409).json({ message: 'No se puede eliminar al último administrador activo.' });
    }

    const [result] = await connection.query('DELETE FROM users WHERE id = ?', [userId]);
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    await connection.commit();
    return res.json({ message: 'Usuario eliminado.' });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
