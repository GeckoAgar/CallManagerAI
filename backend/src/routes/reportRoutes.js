const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');

router.get('/', authenticate, requireRole('ADMIN', 'USER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.call_id, r.file_name, r.url, r.duration_seconds, r.transcription, r.created_at
       FROM recordings r
       JOIN calls c ON c.id = r.call_id
       WHERE (? = 'ADMIN' OR c.agent_id = ?)
       ORDER BY r.id DESC`,
      [req.user.roleName, req.user.id]
    );
    return res.json({ recordings: rows });
  } catch (error) {
    console.error('Failed to load report recordings:', error);
    return res.status(500).json({ message: 'Error al obtener grabaciones.' });
  }
});

module.exports = router;
