const express = require('express');
const { authenticate } = require('../middlewares/auth');
const recordingController = require('../controllers/recordingController');

const router = express.Router();

router.use(authenticate);
router.get('/', recordingController.list);
router.get('/:id', recordingController.get);
router.post('/', recordingController.create);
router.patch('/:id', recordingController.update);
router.delete('/:id', recordingController.remove);

module.exports = router;
