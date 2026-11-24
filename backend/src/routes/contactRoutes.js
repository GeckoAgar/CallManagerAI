const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const contactController = require('../controllers/contactController');

const router = express.Router();

router.use(authenticate);
router.get('/', contactController.list);
router.get('/:id', contactController.get);
router.post('/', contactController.create);
router.patch('/:id', contactController.update);
router.delete('/:id', contactController.remove);
router.post('/:id/restore', requireRole('ADMIN'), contactController.restore);

module.exports = router;
