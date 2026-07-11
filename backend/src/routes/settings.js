const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/settingsController');
const ldapCtrl = require('../controllers/ldapSettingsController');
const { authenticate } = require('../middleware/auth');
const { blockUntilPasswordChanged } = require('../middleware/role');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// Logo/favicon uploads (images only, 5MB) stored under <uploads>/branding/.
const brandingStorage = (prefix) => multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(ctrl.BRANDING_DIR, { recursive: true }, (err) => cb(err, ctrl.BRANDING_DIR));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const imageFileFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  const err = new Error('Only image files are allowed');
  err.status = 400;
  err.code = 'INVALID_FILE_TYPE';
  cb(err, false);
};
const logoUpload = multer({
  storage: brandingStorage('logo'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});
const faviconUpload = multer({
  storage: brandingStorage('favicon'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

// Public endpoints (no auth) — needed by the login page and global theming.
router.get('/public', ctrl.getPublic);
router.get('/logo', ctrl.getLogo);
router.get('/favicon', ctrl.getFavicon);

// Admin endpoints.
const manageSystem = [authenticate, blockUntilPasswordChanged, requirePermission('settings.manage_system')];
const manageBranding = [authenticate, blockUntilPasswordChanged, requirePermission('settings.manage_branding')];
// GET is widened to settings.manage_branding too — a branding-only role
// (no manage_system) still needs to load the Company/Branding pages to use
// its own logo/favicon-upload permission (manageBranding below). Safe to
// widen: GET already redacts integration secrets to booleans via
// redactSettings(). PUT/PATCH deliberately stay manage_system-only — the
// same settings blob also holds integrations.* OAuth client secrets, and a
// branding-only role writing to this endpoint could overwrite those, which
// is a real permission escalation, not just a UX gap.
const readSettings = [authenticate, blockUntilPasswordChanged, requirePermission('settings.manage_system', 'settings.manage_branding')];
router.get('/', readSettings, ctrl.get);
router.put('/', manageSystem, ctrl.update);
router.patch('/', manageSystem, ctrl.patch);
router.get('/ldap', manageSystem, ldapCtrl.get);
router.patch('/ldap', manageSystem, ldapCtrl.update);
router.post('/ldap/test', manageSystem, ldapCtrl.test);
router.post('/logo', manageBranding, logoUpload.single('file'), ctrl.uploadLogo);
router.delete('/logo', manageBranding, ctrl.removeLogo);
router.post('/favicon', manageBranding, faviconUpload.single('file'), ctrl.uploadFavicon);
router.delete('/favicon', manageBranding, ctrl.removeFavicon);

module.exports = router;
