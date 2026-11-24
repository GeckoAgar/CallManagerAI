const roleModel = require('../models/roleModel');
const { isPositiveId } = require('../utils/resourceValidation');
const { roleCreateSchema, roleUpdateSchema, validationError } = require('../validators/resourceSchemas');
const { createPagination, paginatedResponse, parsePagination } = require('../utils/pagination');

const reservedRoles = new Set(['ADMIN', 'USER']);

async function list(req, res, next) {
  const requestedPagination = parsePagination(req.query);
  if (requestedPagination && requestedPagination.error) {
    return res.status(400).json({ message: requestedPagination.error });
  }

  try {
    if (!requestedPagination) return res.json({ roles: await roleModel.list() });

    const total = await roleModel.count(requestedPagination.search);
    const pagination = createPagination(total, requestedPagination.page, requestedPagination.limit);
    const roles = await roleModel.list(requestedPagination.search, pagination);
    return res.json(paginatedResponse(roles, pagination));
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const error = validationError(roleCreateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  const { name, description = '' } = req.body;

  try {
    const id = await roleModel.create(name.trim().toUpperCase(), description.trim());
    const role = await roleModel.findById(id);
    return res.status(201).json({ role });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  const roleId = Number(req.params.id);
  if (!isPositiveId(roleId)) return res.status(400).json({ message: 'Identificador de rol inválido.' });
  const body = req.body;
  const error = validationError(roleUpdateSchema, body);
  if (error) return res.status(400).json({ message: error });

  try {
    const current = await roleModel.findById(roleId);
    if (!current) return res.status(404).json({ message: 'Rol no encontrado.' });
    const nextName = Object.hasOwn(body, 'name') ? body.name.trim().toUpperCase() : current.name;
    if (reservedRoles.has(current.name) && nextName !== current.name) {
      return res.status(409).json({ message: 'No se puede renombrar el rol reservado del sistema.' });
    }

    const fields = {};
    if (Object.hasOwn(body, 'name')) fields.name = nextName;
    if (Object.hasOwn(body, 'description')) fields.description = body.description.trim();
    await roleModel.update(roleId, fields);
    const role = await roleModel.findById(roleId);
    return res.json({ role });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  const roleId = Number(req.params.id);
  if (!isPositiveId(roleId)) return res.status(400).json({ message: 'Identificador de rol inválido.' });

  try {
    const role = await roleModel.findById(roleId);
    if (!role) return res.status(404).json({ message: 'Rol no encontrado.' });
    if (reservedRoles.has(role.name)) {
      return res.status(409).json({ message: 'No se pueden eliminar roles reservados del sistema.' });
    }

    await roleModel.remove(roleId);
    return res.json({ message: 'Rol eliminado.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, create, update, remove };
