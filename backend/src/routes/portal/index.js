// The client portal API, mounted at /api/v1/portal. Everything here runs on
// the portal session (app.js), never the staff one; everything past /auth and
// /config needs a signed-in contact (portalGuard).
const express = require('express');
const { portalAuthenticate } = require('../../middleware/portalAuth');
const { portalGlobalLimiter } = require('../../middleware/rateLimit');
const ctrl = require('../../controllers/portal/authController');
const authRoutes = require('./auth');

const portalGuard = [portalAuthenticate, portalGlobalLimiter];

const router = express.Router();

router.get('/config', ctrl.config);
router.use('/auth', authRoutes);
router.get('/me', portalGuard, ctrl.me);

module.exports = router;
module.exports.portalGuard = portalGuard;
