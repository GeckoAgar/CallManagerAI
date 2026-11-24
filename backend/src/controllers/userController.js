const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const userModel = require('../models/userModel');
const { isPositiveId } = require('../utils/resourceValidation');
const { userCreateSchema, userUpdateSchema, validationError } = require('../validators/resourceSchemas');
const { createPagination, paginatedResponse, parsePagination } = require('../utils/pagination');

async function ensureAdminRemains(connection, userId, nextRoleId, nextStatus) {
  const current = await userModel.lockStatus(connection, userId);
  if (!current) return false;
  if (current.role_name !== 'ADMIN' || (nextRoleId == null && nextStatus == null)) return true;

  let nextRole = current.role_name;
  if (nextRoleId != null) {
    const role = await userModel.findRole(connection, nextRoleId);
    if (!role) return null;
    nextRole = role.name;
  }
  const finalStatus = nextStatus || current.status;

  if (nextRole === 'ADMIN' && finalStatus === 'active') return true;
  return (await userModel.lockOtherActiveAdmins(connection, userId)) > 0;
}

async function list(req, res, next) {
  const requestedPagination = parsePagination(req.query);
  if (requestedPagination && requestedPagination.error) {
    return res.status(400).json({ message: requestedPagination.error });
  }

  try {
    if (requestedPagination) {
      const total = await userModel.count(requestedPagination.search);
      const pagination = createPagination(total, requestedPagination.page, requestedPagination.limit);
      const rows = await userModel.list(requestedPagination.search, pagination);
      return res.json(paginatedResponse(rows, pagination));
    }

    const rows = await userModel.list();
    return res.json({ users: rows });
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  const requestedId = Number(req.params.id);
  if (!isPositiveId(requestedId)) {
    return res.status(400).json({ message: 'Identificador de usuario inválido.' });
  }
  if (req.user.roleName !== 'ADMIN' && req.user.id !== requestedId) {
    return res.status(403).json({ message: 'Solo puedes consultar tu propio perfil.' });
  }

  try {
    const user = await userModel.findById(requestedId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const error = validationError(userCreateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  const { name, email, password, role_id: roleId, status = 'active' } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const id = await userModel.create({
      name: name.trim(), email: email.trim().toLowerCase(), password_hash: passwordHash,
      role_id: Number(roleId), status,
    });
    return res.status(201).json({ user: await userModel.findById(id) });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  const userId = Number(req.params.id);
  if (!isPositiveId(userId)) return res.status(400).json({ message: 'Identificador de usuario inválido.' });

  const body = req.body;
  const error = validationError(userUpdateSchema, body);
  if (error) return res.status(400).json({ message: error });
  if (userId === req.user.id &&
      (Object.hasOwn(body, 'role_id') || (Object.hasOwn(body, 'status') && body.status !== 'active'))) {
    return res.status(400).json({ message: 'No puedes cambiar tu propio rol ni desactivar tu cuenta desde esta operación.' });
  }

  const fields = {};
  if (Object.hasOwn(body, 'name')) fields.name = body.name.trim();
  if (Object.hasOwn(body, 'email')) fields.email = body.email.trim().toLowerCase();
  if (Object.hasOwn(body, 'role_id')) fields.role_id = Number(body.role_id);
  if (Object.hasOwn(body, 'status')) fields.status = body.status;

  let connection;
  try {
    if (Object.hasOwn(body, 'password')) {
      fields.password_hash = await bcrypt.hash(body.password, 10);
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

    await userModel.update(connection, userId, fields);
    await connection.commit();
    const user = await userModel.findById(userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });
    return res.json({ user });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

async function remove(req, res, next) {
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

    const affectedRows = await userModel.remove(connection, userId);
    if (!affectedRows) {
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
}

module.exports = { list, get, create, update, remove };
