const callModel = require('../models/callModel');
const { runInTransaction, syncSurveillanceQueueForCall } = require('../utils/surveillanceQueue');
const { isPositiveId } = require('../utils/resourceValidation');
const { callCreateSchema, callUpdateSchema, validationError } = require('../validators/resourceSchemas');
const { createPagination, paginatedResponse, parsePagination } = require('../utils/pagination');

async function list(req, res, next) {
  const requestedPagination = parsePagination(req.query);
  if (requestedPagination && requestedPagination.error) {
    return res.status(400).json({ message: requestedPagination.error });
  }

  try {
    if (requestedPagination) {
      const total = await callModel.count(req.user, requestedPagination.search);
      const pagination = createPagination(total, requestedPagination.page, requestedPagination.limit);
      const calls = await callModel.list(req.user, requestedPagination.search, pagination);
      return res.json(paginatedResponse(calls, pagination));
    }

    const calls = await callModel.list(req.user);
    return res.json({ calls });
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  try {
    const call = await callModel.findById(id, req.user);
    if (!call) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ call });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const error = validationError(callCreateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'agent_id')) {
    return res.status(403).json({ message: 'No puedes asignar llamadas a otro usuario.' });
  }

  try {
    const contactId = req.body.contact_id || null;
    const agentId = req.user.roleName === 'ADMIN'
      ? (req.body.agent_id ? Number(req.body.agent_id) : req.user.id)
      : req.user.id;
    const status = req.body.status || 'queued';
    const call = await runInTransaction(async (connection) => {
      if (!(await callModel.canAccessContact(connection, contactId, req.user))) return null;
      const callId = await callModel.create(connection, {
        contact_id: contactId,
        agent_id: agentId,
        phone_number: req.body.phone_number.trim(),
        direction: req.body.direction || 'inbound',
        status,
        duration_seconds: req.body.duration_seconds == null ? 0 : Number(req.body.duration_seconds),
        score: req.body.score == null ? 0 : Number(req.body.score),
      });
      await syncSurveillanceQueueForCall(connection, {
        callId,
        previousStatus: null,
        previousAgentId: null,
        status,
        agentId,
      });
      return callModel.findById(callId, null, connection);
    });
    if (!call) return res.status(400).json({ message: 'El contacto no existe o no está disponible para tu cuenta.' });
    return res.status(201).json({ call });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  const error = validationError(callUpdateSchema, req.body);
  if (error) return res.status(400).json({ message: error });
  if (req.user.roleName !== 'ADMIN' && Object.hasOwn(req.body, 'agent_id')) {
    return res.status(403).json({ message: 'No puedes reasignar una llamada.' });
  }

  const normalizers = {
    contact_id: (value) => value || null,
    agent_id: (value) => value ? Number(value) : null,
    phone_number: (value) => value.trim(),
    direction: (value) => value,
    status: (value) => value,
    duration_seconds: (value) => Number(value),
    score: (value) => Number(value),
  };
  const fields = {};
  for (const [field, normalize] of Object.entries(normalizers)) {
    if (Object.hasOwn(req.body, field)) {
      fields[field] = normalize(req.body[field]);
    }
  }
  if (!Object.keys(fields).length) return res.status(400).json({ message: 'No hay campos para actualizar.' });

  try {
    const result = await runInTransaction(async (connection) => {
      const previousCall = await callModel.lockById(connection, id, req.user);
      if (!previousCall) return { error: 'not-found' };
      if (Object.hasOwn(req.body, 'contact_id') &&
          String(req.body.contact_id || '') !== String(previousCall.contact_id || '') &&
          !(await callModel.canAccessContact(connection, req.body.contact_id, req.user))) {
        return { error: 'invalid-contact' };
      }
      await callModel.update(connection, id, req.user, fields);
      const status = Object.hasOwn(req.body, 'status') ? req.body.status : previousCall.status;
      const agentId = Object.hasOwn(req.body, 'agent_id')
        ? (req.body.agent_id ? Number(req.body.agent_id) : null)
        : previousCall.agent_id;
      await syncSurveillanceQueueForCall(connection, {
        callId: id,
        previousStatus: previousCall.status,
        previousAgentId: previousCall.agent_id,
        status,
        agentId,
      });

      return { call: await callModel.findById(id, null, connection) };
    });
    if (result.error === 'not-found') return res.status(404).json({ message: 'Llamada no encontrada.' });
    if (result.error === 'invalid-contact') {
      return res.status(400).json({ message: 'El contacto no existe o no está disponible para tu cuenta.' });
    }
    return res.json({ call: result.call });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de llamada inválido.' });
  try {
    const deleted = await runInTransaction(async (connection) => {
      const existing = await callModel.lockById(connection, id, req.user);
      if (!existing) return false;
      return callModel.remove(connection, id, req.user);
    });
    if (!deleted) return res.status(404).json({ message: 'Llamada no encontrada.' });
    return res.json({ message: 'Llamada eliminada.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, get, create, update, remove };
