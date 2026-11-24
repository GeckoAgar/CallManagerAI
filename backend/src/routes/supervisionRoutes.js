const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const supervisionController = require('../controllers/supervisionController');

const router = express.Router();

router.use(authenticate, requireRole('ADMIN'));
router.get('/summary', supervisionController.summary);
router.get('/agents', supervisionController.agents);
router.get('/queue', supervisionController.queue);
router.post('/queue/:id/monitoring', supervisionController.monitoring);
router.post('/queue/:id/escalate', supervisionController.escalate);
router.delete('/queue/:id', supervisionController.remove);

module.exports = router;
