const express = require('express');
const ctrl = require('../../controllers/portal/authController');
const { portalLoginLimiter, portalForgotLimiter } = require('../../middleware/rateLimit');

// No session needed: these are how a contact gets one.
const router = express.Router();

router.post('/login', portalLoginLimiter, ctrl.login);
router.post('/logout', ctrl.logout);
router.post('/invite/check', portalLoginLimiter, ctrl.checkInvite);
router.post('/invite/accept', portalLoginLimiter, ctrl.acceptInvite);
router.post('/reset', portalLoginLimiter, ctrl.resetPassword);
router.post('/forgot', portalForgotLimiter, ctrl.forgot);
// Sign in with Microsoft (7b): a browser round trip, so GETs that redirect.
router.get('/microsoft/start', portalLoginLimiter, ctrl.microsoftStart);
router.get('/microsoft/callback', portalLoginLimiter, ctrl.microsoftCallback);

module.exports = router;
