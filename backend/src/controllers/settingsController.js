const path = require('path');
const fs = require('fs');
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

// Every Notification.type value (see the model's ENUM) — all on by default.
const ALL_NOTIFICATION_TYPES = ['assigned', 'comment', 'reply', 'overdue', 'due_soon', 'status_change', 'watcher_update', 'workflow'];
const DEFAULT_NOTIFICATION_TYPES = JSON.stringify(ALL_NOTIFICATION_TYPES);

// Defaults applied when a setting has not been configured.
const DEFAULTS = {
  'company.name': 'Acme Corp',
  'company.supportEmail': '',
  'company.timezone': 'UTC',
  'company.dateFormat': 'YYYY-MM-DD',
  'company.timeFormat': '12h',
  'company.language': 'en',
  'company.logoFilename': '',
  'company.faviconFilename': '',

  'branding.appName': 'PRISM',
  'branding.tagline': 'Project & Request Integrated Service Manager',
  'branding.loginBullets': DEFAULT_LOGIN_BULLETS,

  // OAuth app credentials the admin registers with Google/Microsoft for this
  // PRISM instance (Settings -> Integrations -> Calendar Integration) — the
  // client secrets are write-only from the API's perspective, see
  // redactSettings()/upsertSettings() below.
  'integrations.googleClientId': '',
  'integrations.googleClientSecret': '',
  'integrations.microsoftClientId': '',
  'integrations.microsoftClientSecret': '',
  'integrations.microsoftTenantId': '',

  // System-wide time-tracking defaults (Settings -> Customization -> Time
  // Tracking). defaultMode/defaultMinThreshold seed a new local user's own
  // timerMode/timerMinThreshold at account-creation time (see
  // usersController.js's create) — after that, each user's Preferences page
  // fully overrides their own values, matching "system-wide default, users
  // can override" from the spec. requireBeforeClose is enforced live on
  // every ticket status change, not just at creation (see ticketsController
  // .js's update).
  'timeTracking.defaultMode': 'manual',
  'timeTracking.defaultMinThreshold': '0',
  'timeTracking.requireBeforeClose': 'false',

  // General Settings -> max attachment size — read by upload.js as a soft
  // ceiling under multer's hard limit. (The old system.inboundEmailAddress
  // storage-only stub is gone — superseded by the real inboundEmail.*
  // config below, which actually has a mail-receiving pipeline behind it.)
  'system.maxAttachmentSizeMB': '25',

  // Settings -> Notifications: which event types are allowed to create an
  // in-app notification at all (system-wide gate, not per-user). Checked in
  // notifications.js's createNotification() — the single choke point every
  // notification (event-driven or derived) already passes through.
  'notifications.enabledTypes': DEFAULT_NOTIFICATION_TYPES,

  // Settings -> Customer Happiness: automated post-close CSAT survey emails
  // (distinct from the older staff-entered happy/neutral/unhappy CsatResponse
  // — see csatService.js). sendDelayHours=0 means "send immediately" (the
  // scheduler still applies its own poll interval, so "immediately" is
  // best-effort within a few minutes, not synchronous).
  'csat.enabled': 'false',
  'csat.sendDelayHours': '0',
  'csat.surveyQuestion': 'How satisfied were you with the support you received?',
  'csat.expiryDays': '7',
  'csat.minTicketsToShowRating': '3',

  // Settings -> Asset Alerts: days-before-X thresholds for auto-creating a
  // reminder ticket, one per expiring-item type — see
  // assetAlertScheduler.js. warrantyAlertDays/replacementAlertDays existed
  // as hardcoded 90-day windows in stats/dashboard queries before this;
  // they're now admin-configurable like subscriptionAlertDays always was.
  'assets.subscriptionAlertDays': '30',
  'assets.warrantyAlertDays': '90',
  'assets.replacementAlertDays': '90',
  'licenses.expiryAlertDays': '30',
  'contracts.renewalAlertDays': '60',
};

// Settings that store JSON-encoded values rather than plain strings.
const JSON_KEYS = ['branding.loginBullets', 'notifications.enabledTypes'];

// Never sent back to the client once saved — GET/PUT/PATCH responses redact
// these to '' (with a companion `<key>Set` boolean so the UI can still show
// "configured"), and a blank incoming value on write means "leave unchanged"
// rather than "clear it" (same reasoning as a password field).
const SECRET_KEYS = ['integrations.googleClientSecret', 'integrations.microsoftClientSecret'];

// Keys writable via PATCH/PUT /settings (everything except file upload
// pointers, which have their own dedicated upload endpoints).
const WRITABLE_KEYS = Object.keys(DEFAULTS).filter(
  (k) => k !== 'company.logoFilename' && k !== 'company.faviconFilename'
);

function redactSettings(values) {
  const redacted = { ...values };
  const flags = {};
  SECRET_KEYS.forEach((key) => {
    flags[`${key}Set`] = !!redacted[key];
    redacted[key] = '';
  });
  return { ...redacted, ...flags };
}

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
      timeFormat: values['company.timeFormat'],
      language: values['company.language'],
      hasLogo,
    },
    branding: {
      appName: values['branding.appName'],
      tagline: values['branding.tagline'],
      loginBullets: parseJsonValue(values['branding.loginBullets'], JSON.parse(DEFAULT_LOGIN_BULLETS)),
    },
    logoUrl: hasLogo ? '/api/v1/settings/logo' : null,
    faviconUrl: hasFavicon ? '/api/v1/settings/favicon' : null,
    // Booleans only — never the client id/secret — so the Account
    // Preferences "Connect calendar" modal knows whether to enable the
    // Google/Microsoft buttons without needing admin permissions itself.
    integrations: {
      googleConfigured: !!(values['integrations.googleClientId'] && values['integrations.googleClientSecret']),
      microsoftConfigured: !!(values['integrations.microsoftClientId'] && values['integrations.microsoftClientSecret']),
    },
    // Drives the green dot on the Settings hub's "General Settings" card —
    // exposed here (rather than only on the manage_system-gated
    // GET /settings/ldap) so any authenticated user can see it regardless
    // of their own permissions, same reasoning as the integrations booleans
    // above. "Connected" means database-configured AND has a successful
    // test on record — not just "fields are filled in" (that's `configured`
    // on GET /settings/ldap), matching the "configured and connected" spec.
    ldap: { connected: !!(values['ldap.host'] && values['ldap.lastTestAt']) },
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

// GET /settings — Admin. All system settings + the read-only env/config
// viewer. LDAP config now lives on its own dedicated GET/PATCH /settings/ldap
// (ldapSettingsController.js) — the config.ldap sub-object that used to be
// here is gone, superseded by that.
const get = asyncHandler(async (req, res) => {
  const values = await getAllSettings();
  res.json({
    settings: redactSettings(values),
    public: publicShape(values),
    config: {
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
  const written = [];
  for (const key of keys) {
    let value = incoming[key];
    if (JSON_KEYS.includes(key) && typeof value !== 'string') {
      value = JSON.stringify(value ?? []);
    }
    // A blank secret means "leave the stored value unchanged" — the GET
    // response never sends the real secret back, so a round-trip save
    // (load form, change something unrelated, submit) would otherwise wipe
    // it out with an empty string every time.
    if (SECRET_KEYS.includes(key) && (value === undefined || value === null || String(value).trim() === '')) {
      continue; // eslint-disable-line no-continue
    }
    // eslint-disable-next-line no-await-in-loop
    await SystemSettings.upsert({
      key,
      value: value == null ? '' : String(value),
      updatedById: userId,
    });
    written.push(key);
  }
  return written;
}

// PUT /settings — Admin. Upserts a map of key/value settings (legacy path,
// kept alongside PATCH for the existing Company/other settings pages).
const update = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.settings) || {};
  const keys = await upsertSettings(incoming, req.user.id);
  await writeAudit(req, 'settings.update', 'SystemSettings', null, { keys });

  const values = await getAllSettings();
  res.json({ settings: redactSettings(values), public: publicShape(values) });
});

// PATCH /settings — Admin. Same as PUT, accepts { settings: {...} } or a bare
// key/value body for convenience from the Appearance/Statuses admin pages.
const patch = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.settings) || req.body || {};
  const keys = await upsertSettings(incoming, req.user.id);
  await writeAudit(req, 'settings.update', 'SystemSettings', null, { keys });

  const values = await getAllSettings();
  res.json({ settings: redactSettings(values), public: publicShape(values) });
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
  getAllSettings,
  ALL_NOTIFICATION_TYPES,
};
