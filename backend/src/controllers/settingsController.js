const path = require('path');
const fs = require('fs');
const { ldapConfig } = require('../config/ldap');
const { SystemSettings } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { UPLOAD_ROOT } = require('../middleware/upload');

const BRANDING_DIR = path.join(UPLOAD_ROOT, 'branding');

// Defaults applied when a setting has not been configured.
const DEFAULTS = {
  'company.name': 'PRISM',
  'company.supportEmail': '',
  'company.timezone': 'UTC',
  'company.dateFormat': 'YYYY-MM-DD',
  'company.language': 'en',
  'company.logoFilename': '',
  'branding.primaryColor': '#3a5da6',
  'branding.accentColor': '#38bdf8',
  'branding.loginBgColor': '#0f1b34',
  'branding.welcomeMessage': 'Project & Request Integrated Service Manager',
};

async function getAllSettings() {
  const rows = await SystemSettings.findAll();
  const values = { ...DEFAULTS };
  for (const row of rows) values[row.key] = row.value;
  return values;
}

function publicShape(values) {
  const hasLogo = !!values['company.logoFilename'];
  return {
    company: {
      name: values['company.name'],
      supportEmail: values['company.supportEmail'],
      timezone: values['company.timezone'],
      dateFormat: values['company.dateFormat'],
      language: values['company.language'],
      hasLogo,
    },
    branding: {
      primaryColor: values['branding.primaryColor'],
      accentColor: values['branding.accentColor'],
      loginBgColor: values['branding.loginBgColor'],
      welcomeMessage: values['branding.welcomeMessage'],
    },
    logoUrl: hasLogo ? '/api/v1/settings/logo' : null,
  };
}

// GET /settings/public — PUBLIC (no auth). Branding + company info for the
// login page and global theming.
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
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Logo file missing', 'NOT_FOUND');
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

// PUT /settings — Admin. Upserts a map of key/value settings.
const update = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.settings) || {};
  const allowedKeys = Object.keys(DEFAULTS).filter((k) => k !== 'company.logoFilename');

  const keys = Object.keys(incoming).filter((k) => allowedKeys.includes(k));
  for (const key of keys) {
    await SystemSettings.upsert({
      key,
      value: incoming[key] == null ? '' : String(incoming[key]),
      updatedById: req.user.id,
    });
  }
  await writeAudit(req, 'settings.update', 'SystemSettings', null, { keys });

  const values = await getAllSettings();
  res.json({ settings: values, public: publicShape(values) });
});

// POST /settings/logo — Admin. Uploads a new logo (multipart field "file").
const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');

  // Remove any previous logo file.
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

module.exports = { getPublic, getLogo, get, update, uploadLogo, removeLogo, BRANDING_DIR };
