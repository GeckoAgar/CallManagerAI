const { z } = require('zod');
const contactModel = require('../models/contactModel');
const { isPositiveId } = require('../utils/resourceValidation');
const { contactCreateSchema, contactUpdateSchema, validationError } = require('../validators/resourceSchemas');
const { createPagination, paginatedResponse, parsePagination } = require('../utils/pagination');

async function list(req, res, next) {
  if (!z.literal('true').optional().safeParse(req.query.deleted).success) {
    return res.status(400).json({ message: 'El parámetro deleted debe ser true.' });
  }
  const deleted = req.query.deleted === 'true';
  if (deleted && req.user.roleName !== 'ADMIN') {
    return res.status(403).json({ message: 'Solo ADMIN puede consultar contactos eliminados.' });
  }
  const requested = parsePagination(req.query);
  if (requested && requested.error) return res.status(400).json({ message: requested.error });

  try {
    if (!requested) return res.json({ contacts: await contactModel.list(req.user, deleted) });
    const total = await contactModel.count(req.user, deleted, requested.search);
    const pagination = createPagination(total, requested.page, requested.limit);
    const contacts = await contactModel.list(req.user, deleted, requested.search, pagination);
    return res.json(paginatedResponse(contacts, pagination));
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  try {
    const contact = await contactModel.findById(id, req.user);
    if (!contact) return res.status(404).json({ message: 'Contacto no encontrado.' });
    return res.json({ contact });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const error = validationError(contactCreateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  const { name, company = null, phone = null, email = null, status = 'active' } = req.body;
  const ownerId = req.user.roleName === 'ADMIN'
    ? (req.body.owner_id ? Number(req.body.owner_id) : null)
    : req.user.id;
  try {
    const id = await contactModel.create({
      owner_id: ownerId, name: name.trim(), company: company || null, phone: phone || null,
      email: email ? email.trim().toLowerCase() : null, status,
    });
    return res.status(201).json({ contact: await contactModel.findById(id) });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  const error = validationError(contactUpdateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'owner_id')) {
    return res.status(403).json({ message: 'Solo ADMIN puede cambiar el propietario de un contacto.' });
  }

  const normalizers = {
    name: (value) => value.trim(),
    company: (value) => value || null,
    phone: (value) => value || null,
    email: (value) => value ? value.trim().toLowerCase() : null,
    status: (value) => value,
    owner_id: (value) => value ? Number(value) : null,
  };
  const fields = {};
  for (const [field, normalize] of Object.entries(normalizers)) {
    if (Object.hasOwn(req.body, field)) fields[field] = normalize(req.body[field]);
  }
  if (!Object.keys(fields).length) return res.status(400).json({ message: 'No hay campos para actualizar.' });
  try {
    if (!await contactModel.update(id, req.user, fields)) {
      return res.status(404).json({ message: 'Contacto no encontrado.' });
    }
    return res.json({ contact: await contactModel.findById(id) });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  try {
    if (!await contactModel.remove(id, req.user)) return res.status(404).json({ message: 'Contacto no encontrado.' });
    return res.json({ message: 'Contacto eliminado. Un administrador puede restaurarlo.' });
  } catch (error) {
    return next(error);
  }
}

async function restore(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de contacto inválido.' });
  try {
    if (!await contactModel.restore(id)) return res.status(404).json({ message: 'Contacto eliminado no encontrado.' });
    return res.json({ message: 'Contacto restaurado.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, get, create, update, remove, restore };
