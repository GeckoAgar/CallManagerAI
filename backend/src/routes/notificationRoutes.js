const express = require('express');
const { authenticate } = require('../middlewares/auth');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

router.use(authenticate);
router.get('/', notificationController.list);
router.patch('/read-all', notificationController.readAll);
router.patch('/:id/read', notificationController.read);
router.delete('/:id', notificationController.remove);

module.exports = router;
