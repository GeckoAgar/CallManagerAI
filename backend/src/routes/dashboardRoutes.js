const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const dashboardController = require('../controllers/dashboardController');

const router = express.Router();

router.get('/summary', authenticate, requireRole('ADMIN', 'USER'), dashboardController.summary);

module.exports = router;
