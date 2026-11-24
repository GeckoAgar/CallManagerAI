const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const userController = require('../controllers/userController');

const router = express.Router();

router.get('/', authenticate, requireRole('ADMIN'), userController.list);
router.get('/:id', authenticate, userController.get);
router.post('/', authenticate, requireRole('ADMIN'), userController.create);
router.patch('/:id', authenticate, requireRole('ADMIN'), userController.update);
router.delete('/:id', authenticate, requireRole('ADMIN'), userController.remove);

module.exports = router;
