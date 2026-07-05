const express = require('express');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Simple in-memory rate limiter for the login endpoint.
// Limits each IP to 20 attempts per 15-minute window to slow brute-force attacks.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 20;

function loginRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now > record.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  record.count += 1;
  if (record.count > LOGIN_MAX) {
    return res.status(429).json({
      error: true,
      message: 'Too many login attempts, please try again later',
      code: 'RATE_LIMITED',
    });
  }
  return next();
}

router.post('/login', loginRateLimit, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.me);
router.get('/me/permissions', authenticate, ctrl.myPermissions);
// Forced/voluntary password change for local accounts. Authenticated, but not
// behind the must-change-password guard (so users can actually change it).
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
