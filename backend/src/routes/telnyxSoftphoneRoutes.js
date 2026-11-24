const express = require('express');
const { authenticate } = require('../middlewares/auth');
const telnyxController = require('../controllers/telnyxController');

const router = express.Router();

router.post('/webhook', telnyxController.webhook);
router.use(authenticate);
router.post('/token', telnyxController.token);
router.post('/calls', telnyxController.createCall);
router.post('/calls/status', telnyxController.callStatus);
router.post('/calls/end', telnyxController.end);

module.exports = router;
