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
    // req.params.id reaches here before the controller validates the ticket
    // exists, so it must be sanitized directly: an encoded path segment like
    // "..%2F..%2Fbranding" would otherwise let path.join() escape UPLOAD_ROOT.
    const ticketId = parseInt(req.params.id, 10);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return cb(new Error('Invalid ticket id'));
    }
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

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    const err = new Error(`File type ${ext} is not allowed`);
    err.status = 400;
    err.code = 'INVALID_FILE_TYPE';
    return cb(err, false);
  }
  cb(null, true);
};

const upload = multer({ storage, limits: { fileSize: MAX_SIZE }, fileFilter });

// Project attachments — stored under a "projects/" subdirectory (rather than
// bare /uploads/{id}/, which ticket attachments already own) so a project and
// a ticket that happen to share the same numeric id never collide on disk.
const projectStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return cb(new Error('Invalid project id'));
    }
    const dir = path.join(UPLOAD_ROOT, 'projects', String(projectId));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, unique);
  },
});
const projectUpload = multer({ storage: projectStorage, limits: { fileSize: MAX_SIZE }, fileFilter });

// Contact CSV import — parsed in-memory and discarded, never written to
// disk (the wizard re-sends the parsed rows on later steps instead of the
// raw file, so there's nothing to persist here).
const CSV_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      const err = new Error('Only .csv files are supported');
      err.status = 400;
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  },
});

module.exports = { upload, projectUpload, csvUpload, UPLOAD_ROOT, MAX_SIZE, CSV_MAX_SIZE };
