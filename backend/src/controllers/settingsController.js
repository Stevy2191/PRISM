const path = require('path');
const fs = require('fs');
const { ldapConfig } = require('../config/ldap');
const { SystemSettings } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { UPLOAD_ROOT } = require('../middleware/upload');

const BRANDING_DIR = path.join(UPLOAD_ROOT, 'branding');

const DEFAULT_LOGIN_BULLETS = JSON.stringify([
  'Ticket & project tracking',
  'Time logging & reports',
  'AD & local auth',
  'API access',
]);

// Defaults applied when a setting has not been configured.
const DEFAULTS = {
  'company.name': 'Acme Corp',
  'company.supportEmail': '',
  'company.timezone': 'UTC',
  'company.dateFormat': 'YYYY-MM-DD',
  'company.language': 'en',
  'company.logoFilename': '',
  'company.faviconFilename': '',

  'branding.appName': 'PRISM',
  'branding.tagline': 'Project & Request Integrated Service Manager',
  'branding.loginBullets': DEFAULT_LOGIN_BULLETS,

  // Full theme palette — defaults match PRISM's current dark scheme.
  'theme.preset': 'dark',
  'theme.bg': '#080b12',
  'theme.sidebar': '#0a0d14',
  'theme.card': '#0d1120',
  'theme.border': '#161c2d',
  'theme.accent': '#3b82f6',
  'theme.accentHover': '#1d4ed8',
  'theme.textPrimary': '#f1f5f9',
  'theme.textSecondary': '#94a3b8',
  'theme.textMuted': '#475569',
  'theme.success': '#22c55e',
  'theme.warning': '#f59e0b',
  'theme.danger': '#ef4444',
  'theme.timer': '#4ade80',
};

// Settings that store JSON-encoded values rather than plain strings.
const JSON_KEYS = ['branding.loginBullets'];

// Keys writable via PATCH/PUT /settings (everything except file upload
// pointers, which have their own dedicated upload endpoints).
const WRITABLE_KEYS = Object.keys(DEFAULTS).filter(
  (k) => k !== 'company.logoFilename' && k !== 'company.faviconFilename'
);

async function getAllSettings() {
  const rows = await SystemSettings.findAll();
  const values = { ...DEFAULTS };
  for (const row of rows) values[row.key] = row.value;
  return values;
}

function parseJsonValue(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function publicShape(values) {
  const hasLogo = !!values['company.logoFilename'];
  const hasFavicon = !!values['company.faviconFilename'];
  return {
    appName: values['branding.appName'],
    company: {
      name: values['company.name'],
      supportEmail: values['company.supportEmail'],
      timezone: values['company.timezone'],
      dateFormat: values['company.dateFormat'],
      language: values['company.language'],
      hasLogo,
    },
    branding: {
      appName: values['branding.appName'],
      tagline: values['branding.tagline'],
      loginBullets: parseJsonValue(values['branding.loginBullets'], JSON.parse(DEFAULT_LOGIN_BULLETS)),
    },
    theme: {
      preset: values['theme.preset'],
      bg: values['theme.bg'],
      sidebar: values['theme.sidebar'],
      card: values['theme.card'],
      border: values['theme.border'],
      accent: values['theme.accent'],
      accentHover: values['theme.accentHover'],
      textPrimary: values['theme.textPrimary'],
      textSecondary: values['theme.textSecondary'],
      textMuted: values['theme.textMuted'],
      success: values['theme.success'],
      warning: values['theme.warning'],
      danger: values['theme.danger'],
      timer: values['theme.timer'],
    },
    logoUrl: hasLogo ? '/api/v1/settings/logo' : null,
    faviconUrl: hasFavicon ? '/api/v1/settings/favicon' : null,
  };
}

// GET /settings/public — PUBLIC (no auth). Branding + theme + app name for
// the login page and global theming, fetched on every page load.
const getPublic = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  res.json(publicShape(values));
});

// GET /settings/logo — PUBLIC. Streams the current logo file.
const getLogo = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const filename = values['company.logoFilename'];
  if (!filename) throw new ApiError(404, 'No logo set', 'NOT_FOUND');
  const filePath = path.join(BRANDING_DIR, filename);
  await fs.promises.access(filePath).catch(() => {
    throw new ApiError(404, 'Logo file missing', 'NOT_FOUND');
  });
  res.sendFile(filePath);
});

// GET /settings/favicon — PUBLIC. Streams the current favicon file.
const getFavicon = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const filename = values['company.faviconFilename'];
  if (!filename) throw new ApiError(404, 'No favicon set', 'NOT_FOUND');
  const filePath = path.join(BRANDING_DIR, filename);
  await fs.promises.access(filePath).catch(() => {
    throw new ApiError(404, 'Favicon file missing', 'NOT_FOUND');
  });
  res.sendFile(filePath);
});

// GET /settings — Admin. All system settings + the read-only env/config viewer.
const get = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  res.json({
    settings: values,
    public: publicShape(values),
    config: {
      ldap: {
        url: ldapConfig.url,
        baseDN: ldapConfig.baseDN,
        bindDN: ldapConfig.bindDN,
        userFilter: ldapConfig.userFilter,
        bindPasswordSet: !!ldapConfig.bindPassword,
      },
      database: {
        host: process.env.DB_HOST || null,
        port: process.env.DB_PORT || null,
        name: process.env.DB_NAME || null,
        user: process.env.DB_USER || null,
      },
      app: {
        nodeEnv: process.env.NODE_ENV || 'development',
        sessionSecretSet: !!process.env.SESSION_SECRET,
      },
    },
  });
});

// Shared upsert logic for PUT/PATCH /settings — a map of key/value pairs.
// JSON-shaped settings (currently just branding.loginBullets) are
// re-serialized so callers can pass either a JS array or a JSON string.
async function upsertSettings(incoming, userId) {
  const keys = Object.keys(incoming).filter((k) => WRITABLE_KEYS.includes(k));
  for (const key of keys) {
    let value = incoming[key];
    if (JSON_KEYS.includes(key) && typeof value !== 'string') {
      value = JSON.stringify(value ?? []);
    }
    // eslint-disable-next-line no-await-in-loop
    await SystemSettings.upsert({
      key,
      value: value == null ? '' : String(value),
      updatedById: userId,
    });
  }
  return keys;
}

// PUT /settings — Admin. Upserts a map of key/value settings (legacy path,
// kept alongside PATCH for the existing Company/other settings pages).
const update = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.settings) || {};
  const keys = await upsertSettings(incoming, req.user.id);
  await writeAudit(req, 'settings.update', 'SystemSettings', null, { keys });

  const values = await getAllSettings();
  res.json({ settings: values, public: publicShape(values) });
});

// PATCH /settings — Admin. Same as PUT, accepts { settings: {...} } or a bare
// key/value body for convenience from the Appearance/Statuses admin pages.
const patch = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.settings) || req.body || {};
  const keys = await upsertSettings(incoming, req.user.id);
  await writeAudit(req, 'settings.update', 'SystemSettings', null, { keys });

  const values = await getAllSettings();
  res.json({ settings: values, public: publicShape(values) });
});

// POST /settings/logo — Admin. Uploads a new logo (multipart field "file").
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  const values = await getAllSettings();
  const prev = values['company.logoFilename'];
  if (prev && prev !== req.file.filename) {
    fs.rm(path.join(BRANDING_DIR, prev), { force: true }, () => {});
  }

  await SystemSettings.upsert({
    key: 'company.logoFilename',
    value: req.file.filename,
    updatedById: req.user.id,
  });
  await writeAudit(req, 'settings.logo_upload', 'SystemSettings', null, { filename: req.file.filename });

  res.json({ ok: true, logoUrl: '/api/v1/settings/logo' });
});

// DELETE /settings/logo — Admin. Removes the logo.
const removeLogo = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const prev = values['company.logoFilename'];
  if (prev) fs.rm(path.join(BRANDING_DIR, prev), { force: true }, () => {});
  await SystemSettings.upsert({ key: 'company.logoFilename', value: '', updatedById: req.user.id });
  await writeAudit(req, 'settings.logo_remove', 'SystemSettings', null, null);
  res.json({ ok: true });
});

// POST /settings/favicon — Admin. Uploads a new favicon (multipart field "file").
const uploadFavicon = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  const values = await getAllSettings();
  const prev = values['company.faviconFilename'];
  if (prev && prev !== req.file.filename) {
    fs.rm(path.join(BRANDING_DIR, prev), { force: true }, () => {});
  }

  await SystemSettings.upsert({
    key: 'company.faviconFilename',
    value: req.file.filename,
    updatedById: req.user.id,
  });
  await writeAudit(req, 'settings.favicon_upload', 'SystemSettings', null, { filename: req.file.filename });

  res.json({ ok: true, faviconUrl: '/api/v1/settings/favicon' });
});

// DELETE /settings/favicon — Admin. Removes the favicon (reverts to the
// built-in geometric mark).
const removeFavicon = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  const prev = values['company.faviconFilename'];
  if (prev) fs.rm(path.join(BRANDING_DIR, prev), { force: true }, () => {});
  await SystemSettings.upsert({ key: 'company.faviconFilename', value: '', updatedById: req.user.id });
  await writeAudit(req, 'settings.favicon_remove', 'SystemSettings', null, null);
  res.json({ ok: true });
});

module.exports = {
  getPublic,
  getLogo,
  getFavicon,
  get,
  update,
  patch,
  uploadLogo,
  removeLogo,
  uploadFavicon,
  removeFavicon,
  BRANDING_DIR,
};
