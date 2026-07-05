const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/settingsController');
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
router.get('/', manageSystem, ctrl.get);
router.put('/', manageSystem, ctrl.update);
router.patch('/', manageSystem, ctrl.patch);
router.post('/logo', manageBranding, logoUpload.single('file'), ctrl.uploadLogo);
router.delete('/logo', manageBranding, ctrl.removeLogo);
router.post('/favicon', manageBranding, faviconUpload.single('file'), ctrl.uploadFavicon);
router.delete('/favicon', manageBranding, ctrl.removeFavicon);

module.exports = router;
