const express = require('express');
const { registerValidation, loginValidation } = require('../validators/authValidators');
const { authenticate } = require('../middlewares/auth');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/register', registerValidation, authController.register);
router.post('/login', loginValidation, authController.login);
router.get('/me', authenticate, authController.me);
router.post('/logout', authenticate, authController.logout);

module.exports = router;
