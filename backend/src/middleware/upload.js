// Multer configuration for ticket attachments.
// Files are stored on the mounted volume at /uploads/{ticketId}/.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = process.env.UPLOAD_DIR || '/uploads';
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

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
});

module.exports = { upload, UPLOAD_ROOT, MAX_SIZE };
