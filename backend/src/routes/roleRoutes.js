const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth');
const roleController = require('../controllers/roleController');

const router = express.Router();

router.use(authenticate, requireRole('ADMIN'));
router.get('/', roleController.list);
router.post('/', roleController.create);
router.patch('/:id', roleController.update);
router.delete('/:id', roleController.remove);

module.exports = router;
