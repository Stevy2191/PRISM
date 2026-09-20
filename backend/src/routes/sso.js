const express = require('express');
const ctrl = require('../controllers/ssoController');
const { ssoLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Every route here is public by necessity — they run before a session exists.
// Protection comes from the single-use, expiring state row each login carries
// and from the protocol libraries' own signature/nonce validation.
router.use(ssoLimiter);

// Drives the buttons on the login page.
router.get('/providers', ctrl.listPublicProviders);

router.get('/:slug/start', ctrl.start);
router.get('/:slug/callback', ctrl.oidcCallback);

// SAML's assertion arrives as a cross-site form POST, so this route needs a
// urlencoded body parser; the app-level express.urlencoded() already provides
// it. There is no CSRF token to check here by design — see ssoController.
router.post('/:slug/acs', ctrl.samlAcs);

router.get('/:slug/metadata', ctrl.samlMetadata);

module.exports = router;
