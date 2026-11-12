const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const { hasText, isPositiveId, optionalText, validNonNegativeNumber } = require('../utils/resourceValidation');

router.use(authenticate);

function recordingAccessFilter(user, alias = 'r') {
  return user.roleName === 'ADMIN'
    ? { clause: '', values: [] }
    : { clause: ` AND c.agent_id = ?`, values: [user.id] };
}

function validateRecording(body, partial = false) {
  const allowedFields = ['call_id', 'file_name', 'url', 'duration_seconds', 'transcription'];
  if (!body || Object.keys(body).some((field) => !allowedFields.includes(field))) return 'Campos de grabación inválidos.';
  if (!partial && !isPositiveId(body.call_id)) return 'La llamada es obligatoria.';
  if (!partial && !hasText(body.file_name, 200)) return 'El nombre del archivo es obligatorio.';
  if (Object.hasOwn(body, 'call_id') && !isPositiveId(body.call_id)) return 'Llamada inválida.';
  if (Object.hasOwn(body, 'file_name') && !hasText(body.file_name, 200)) return 'Nombre de archivo inválido.';
  if (Object.hasOwn(body, 'url') && !optionalText(body.url, 255)) return 'URL inválida.';
  if (Object.hasOwn(body, 'url') && body.url) {
    try {
      const parsed = new URL(body.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return 'La URL debe usar HTTP o HTTPS.';
    } catch {
      return 'URL inválida.';
    }
  }
  if (Object.hasOwn(body, 'duration_seconds') && !validNonNegativeNumber(body.duration_seconds, 2147483647)) return 'Duración inválida.';
  if (Object.hasOwn(body, 'transcription') && !optionalText(body.transcription, 65535)) return 'Transcripción demasiado larga.';
  return null;
}

async function canAccessCall(callId, user) {
  const [rows] = await pool.query(
    `SELECT id FROM calls WHERE id = ?${user.roleName === 'ADMIN' ? '' : ' AND agent_id = ?'}`,
    user.roleName === 'ADMIN' ? [callId] : [callId, user.id]
  );
  return rows.length > 0;
}

router.get('/', async (req, res, next) => {
  const filter = recordingAccessFilter(req.user);
  try {
    const [recordings] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
              c.phone_number, c.agent_id
       FROM recordings r JOIN calls c ON c.id = r.call_id
       WHERE 1 = 1${filter.clause}
       ORDER BY r.id DESC`,
      filter.values
    );
    return res.json({ recordings });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  const filter = recordingAccessFilter(req.user);
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
              c.phone_number, c.agent_id
       FROM recordings r JOIN calls c ON c.id = r.call_id
       WHERE r.id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!rows.length) return res.status(404).json({ message: 'Grabación no encontrada.' });
    return res.json({ recording: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const validationError = validateRecording(req.body);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    if (!(await canAccessCall(Number(req.body.call_id), req.user))) {
      return res.status(400).json({ message: 'La llamada no existe o no está disponible para tu cuenta.' });
    }
    const [result] = await pool.query(
      `INSERT INTO recordings (call_id, file_name, url, duration_seconds, transcription)
       VALUES (?, ?, ?, ?, ?)`,
      [
        Number(req.body.call_id),
        req.body.file_name.trim(),
        req.body.url || null,
        req.body.duration_seconds == null ? 0 : Number(req.body.duration_seconds),
        req.body.transcription || null,
      ]
    );
    const [rows] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
              c.phone_number, c.agent_id
       FROM recordings r JOIN calls c ON c.id = r.call_id WHERE r.id = ?`,
      [result.insertId]
    );
    return res.status(201).json({ recording: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  const validationError = validateRecording(req.body, true);
  if (validationError) return res.status(400).json({ message: validationError });

  const filter = recordingAccessFilter(req.user);
  try {
    const [existing] = await pool.query(
      `SELECT r.id FROM recordings r JOIN calls c ON c.id = r.call_id
       WHERE r.id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!existing.length) return res.status(404).json({ message: 'Grabación no encontrada.' });

    if (Object.hasOwn(req.body, 'call_id') && !(await canAccessCall(Number(req.body.call_id), req.user))) {
      return res.status(400).json({ message: 'La llamada no existe o no está disponible para tu cuenta.' });
    }

    const normalizers = {
      call_id: (value) => Number(value),
      file_name: (value) => value.trim(),
      url: (value) => value || null,
      duration_seconds: (value) => Number(value),
      transcription: (value) => value || null,
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

    await pool.query(`UPDATE recordings SET ${assignments.join(', ')} WHERE id = ?`, [...values, id]);
    const [rows] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at,
              c.phone_number, c.agent_id
       FROM recordings r JOIN calls c ON c.id = r.call_id WHERE r.id = ?`,
      [id]
    );
    return res.json({ recording: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isPositiveId(id)) return res.status(400).json({ message: 'Identificador de grabación inválido.' });
  const filter = recordingAccessFilter(req.user);
  try {
    const [result] = await pool.query(
      `DELETE r FROM recordings r JOIN calls c ON c.id = r.call_id
       WHERE r.id = ?${filter.clause}`,
      [id, ...filter.values]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Grabación no encontrada.' });
    return res.json({ message: 'Grabación eliminada.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
