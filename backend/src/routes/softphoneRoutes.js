const express = require('express');
const { authenticate } = require('../middlewares/auth');
const softphoneController = require('../controllers/softphoneController');

const router = express.Router();

router.use(authenticate);
router.get('/presence', softphoneController.getPresence);
router.patch('/presence/register', softphoneController.register);
router.patch('/presence/heartbeat', softphoneController.heartbeat);
router.patch('/presence', softphoneController.setPresence);

module.exports = router;
