const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/settingsController');
const { authenticate } = require('../middleware/auth');
const { requireRole, blockUntilPasswordChanged } = require('../middleware/role');

const router = express.Router();

// Logo uploads (images only, 5MB) stored under <uploads>/branding/.
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(ctrl.BRANDING_DIR, { recursive: true }, (err) => cb(err, ctrl.BRANDING_DIR));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    const err = new Error('Only image files are allowed');
    err.status = 400;
    err.code = 'INVALID_FILE_TYPE';
    cb(err, false);
  },
});

// Public endpoints (no auth) — needed by the login page and global theming.
router.get('/public', ctrl.getPublic);
router.get('/logo', ctrl.getLogo);

// Admin endpoints.
const admin = [authenticate, blockUntilPasswordChanged, requireRole('admin')];
router.get('/', admin, ctrl.get);
router.put('/', admin, ctrl.update);
router.post('/logo', admin, logoUpload.single('file'), ctrl.uploadLogo);
router.delete('/logo', admin, ctrl.removeLogo);

module.exports = router;
