const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const reportController = require('../controllers/reportController');

const router = express.Router();

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), reportController.summary);
router.get('/calls-by-day', authenticate, requireRole('ADMIN', 'USER'), reportController.callsByDay);
router.get('/by-agent', authenticate, requireRole('ADMIN', 'USER'), reportController.byAgent);
router.get('/', authenticate, requireRole('ADMIN', 'USER'), reportController.recordings);

module.exports = router;
