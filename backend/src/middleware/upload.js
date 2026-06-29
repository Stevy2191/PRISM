// Multer configuration for ticket attachments.
// Files are stored on the mounted volume at /uploads/{ticketId}/.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/uploads';
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

// Extensions that could be executed server-side or auto-run on Windows/macOS.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.sh', '.bash', '.bat', '.cmd', '.ps1', '.ps2', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.jar', '.msi', '.msp', '.scr', '.hta',
  '.pif', '.com', '.cpl', '.dll', '.sys', '.drv', '.ocx', '.app', '.deb', '.rpm',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ticketId = req.params.id;
    const dir = path.join(UPLOAD_ROOT, String(ticketId));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    // Randomized on-disk name; original name preserved in DB.
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      const err = new Error(`File type ${ext} is not allowed`);
      err.status = 400;
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  },
});

module.exports = { upload, UPLOAD_ROOT, MAX_SIZE };
