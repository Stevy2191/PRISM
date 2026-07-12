const express = require('express');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginLimiter, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.me);
router.get('/me/permissions', authenticate, ctrl.myPermissions);
// Forced/voluntary password change for local accounts. Authenticated, but not
// behind the must-change-password guard (so users can actually change it).
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
