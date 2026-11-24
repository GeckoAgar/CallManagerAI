const recordingModel = require('../models/recordingModel');
const { isPositiveId } = require('../utils/resourceValidation');
const { recordingCreateSchema, recordingUpdateSchema, validationError } = require('../validators/resourceSchemas');
const { createPagination, paginatedResponse, parsePagination } = require('../utils/pagination');

async function list(req, res, next) {
  const requestedPagination = parsePagination(req.query);
  if (requestedPagination && requestedPagination.error) {
    return res.status(400).json({ message: requestedPagination.error });
  }

  try {
    if (requestedPagination) {
      const total = await recordingModel.count(req.user, requestedPagination.search);
      const pagination = createPagination(total, requestedPagination.page, requestedPagination.limit);
      const recordings = await recordingModel.list(req.user, requestedPagination.search, pagination);
      return res.json(paginatedResponse(recordings, pagination));
    }

    const recordings = await recordingModel.list(req.user);
    return res.json({ recordings });
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  try {
    const recording = await recordingModel.findById(id, req.user);
    if (!recording) return res.status(404).json({ message: 'Grabación no encontrada.' });
    return res.json({ recording });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const error = validationError(recordingCreateSchema, req.body);
  if (error) return res.status(400).json({ message: error });

  try {
    if (!(await recordingModel.canAccessCall(Number(req.body.call_id), req.user))) {
      return res.status(400).json({ message: 'La llamada no existe o no está disponible para tu cuenta.' });
    }
    const id = await recordingModel.create({
      call_id: Number(req.body.call_id),
      file_name: req.body.file_name.trim(),
      url: req.body.url || null,
      duration_seconds: req.body.duration_seconds == null ? 0 : Number(req.body.duration_seconds),
      transcription: req.body.transcription || null,
    });
    return res.status(201).json({ recording: await recordingModel.findById(id) });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  const error = validationError(recordingUpdateSchema, req.body);
  if (error) return res.status(400).json({ message: error });

  try {
    const existing = await recordingModel.findById(id, req.user);
    if (!existing) return res.status(404).json({ message: 'Grabación no encontrada.' });

    if (Object.hasOwn(req.body, 'call_id') && !(await recordingModel.canAccessCall(Number(req.body.call_id), req.user))) {
      return res.status(400).json({ message: 'La llamada no existe o no está disponible para tu cuenta.' });
    }

    const normalizers = {
      call_id: (value) => Number(value),
      file_name: (value) => value.trim(),
      url: (value) => value || null,
      duration_seconds: (value) => Number(value),
      transcription: (value) => value || null,
    };
    const fields = {};
    for (const [field, normalize] of Object.entries(normalizers)) {
      if (Object.hasOwn(req.body, field)) {
        fields[field] = normalize(req.body[field]);
      }
    }
    if (!Object.keys(fields).length) return res.status(400).json({ message: 'No hay campos para actualizar.' });

    await recordingModel.update(id, fields);
    return res.json({ recording: await recordingModel.findById(id) });
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  try {
    if (!await recordingModel.remove(id, req.user)) return res.status(404).json({ message: 'Grabación no encontrada.' });
    return res.json({ message: 'Grabación eliminada.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, get, create, update, remove };
