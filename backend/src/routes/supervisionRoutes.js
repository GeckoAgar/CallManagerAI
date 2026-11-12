const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, requireRole } = require('../middlewares/auth');

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), async (req, res) => {
  try {
    const [totals] = await pool.query('SELECT COUNT(*) AS total_calls FROM calls');
    const [active] = await pool.query("SELECT COUNT(*) AS active_calls FROM calls WHERE status = 'active'");
    const [closed] = await pool.query("SELECT COUNT(*) AS closed_calls FROM calls WHERE status = 'completed'");

    return res.json({
      summary: {
        totalCalls: totals[0].total_calls,
        activeCalls: active[0].active_calls,
        closedCalls: closed[0].closed_calls,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error al cargar reportes', error: error.message });
  }
});

module.exports = router;
