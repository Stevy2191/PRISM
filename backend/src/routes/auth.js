const express = require('express');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.me);
// Forced/voluntary password change for local accounts. Authenticated, but not
// behind the must-change-password guard (so users can actually change it).
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
