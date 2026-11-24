const express = require('express');
const { authenticate } = require('../middlewares/auth');
const callController = require('../controllers/callController');

const router = express.Router();

router.use(authenticate);
router.get('/', callController.list);
router.get('/:id', callController.get);
router.post('/', callController.create);
router.patch('/:id', callController.update);
router.delete('/:id', callController.remove);

module.exports = router;
