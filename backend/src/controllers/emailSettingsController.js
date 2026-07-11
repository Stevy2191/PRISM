const { SystemSettings, EmailProcessingLog, Ticket } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { encryptToken } = require('../utils/tokenCrypto');
const {
  resolveInboundEmailConfig, readInboundEmailSettingsRows, testImapConnection,
} = require('../services/inboundEmailService');
const {
  resolveSmtpConfig, readSmtpSettingsRows, testSmtpConnection,
} = require('../services/emailSender');

// ==================== Inbound email (IMAP) ====================

const INBOUND_KEYS = {
  enabled: 'inboundEmail.enabled',
  host: 'inboundEmail.host',
  port: 'inboundEmail.port',
  ssl: 'inboundEmail.ssl',
  address: 'inboundEmail.address',
  username: 'inboundEmail.username',
  password: 'inboundEmail.password',
  pollInterval: 'inboundEmail.pollInterval',
};
const VALID_POLL_INTERVALS = [1, 2, 5, 10];

// GET /settings/inbound-email
const getInbound = asyncHandler(async (req, res) => {
  const db = await readInboundEmailSettingsRows();
  const config = await resolveInboundEmailConfig(db);
  res.json({
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    ssl: config.ssl,
    address: config.address,
    username: config.username,
    password: db['inboundEmail.password'] ? '***' : '',
    pollInterval: config.pollInterval,
  });
});

// PATCH /settings/inbound-email
const updateInbound = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const updates = [];

  if (body.enabled !== undefined) updates.push({ key: INBOUND_KEYS.enabled, value: String(!!body.enabled) });
  if (body.host !== undefined) updates.push({ key: INBOUND_KEYS.host, value: String(body.host).trim() });
  if (body.port !== undefined) {
    const n = Number(body.port);
    if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, 'Port must be a positive number', 'VALIDATION_ERROR');
    updates.push({ key: INBOUND_KEYS.port, value: String(n) });
  }
  if (body.ssl !== undefined) updates.push({ key: INBOUND_KEYS.ssl, value: String(!!body.ssl) });
  if (body.address !== undefined) updates.push({ key: INBOUND_KEYS.address, value: String(body.address).trim() });
  if (body.username !== undefined) updates.push({ key: INBOUND_KEYS.username, value: String(body.username).trim() });
  if (body.pollInterval !== undefined) {
    const n = Number(body.pollInterval);
    if (!VALID_POLL_INTERVALS.includes(n)) throw new ApiError(400, 'Invalid poll interval', 'VALIDATION_ERROR');
    updates.push({ key: INBOUND_KEYS.pollInterval, value: String(n) });
  }
  // Write-only password: blank/"***" means "leave unchanged" — same
  // convention as the LDAP bind password and OAuth client secrets.
  if (body.password && body.password !== '***') {
    updates.push({ key: INBOUND_KEYS.password, value: encryptToken(String(body.password)) });
  }

  await Promise.all(updates.map(({ key, value }) => SystemSettings.upsert({ key, value, updatedById: req.user.id })));
  await writeAudit(req, 'settings.inbound_email_update', 'SystemSettings', null, { fields: updates.map((u) => u.key) });
  res.json({ ok: true });
});

// Builds a full config for testing from saved values + unsaved form
// overrides — lets "Test connection" work before "Save" is clicked.
async function buildCandidateInboundConfig(overrides) {
  const saved = await resolveInboundEmailConfig();
  if (!overrides || typeof overrides !== 'object' || !Object.keys(overrides).length) return saved;

  return {
    ...saved,
    host: overrides.host !== undefined ? String(overrides.host).trim() : saved.host,
    port: overrides.port !== undefined ? Number(overrides.port) : saved.port,
    ssl: overrides.ssl !== undefined ? !!overrides.ssl : saved.ssl,
    address: overrides.address !== undefined ? String(overrides.address).trim() : saved.address,
    username: overrides.username !== undefined ? String(overrides.username).trim() : saved.username,
    password: overrides.password && overrides.password !== '***' ? String(overrides.password) : saved.password,
  };
}

// POST /settings/inbound-email/test
const testInbound = asyncHandler(async (req, res) => {
  const config = await buildCandidateInboundConfig(req.body);
  const result = await testImapConnection(config);
  res.json(result);
});

// ==================== Outbound email (SMTP) ====================

const SMTP_KEYS = {
  host: 'smtp.host',
  port: 'smtp.port',
  username: 'smtp.username',
  password: 'smtp.password',
  fromName: 'smtp.fromName',
  fromEmail: 'smtp.fromEmail',
  ssl: 'smtp.ssl',
};

// GET /settings/smtp
const getSmtp = asyncHandler(async (req, res) => {
  const db = await readSmtpSettingsRows();
  const config = await resolveSmtpConfig(db);
  res.json({
    host: config.host,
    port: config.port,
    ssl: config.ssl,
    username: config.username,
    password: db['smtp.password'] ? '***' : '',
    fromName: config.fromName,
    fromEmail: config.fromEmail,
  });
});

// PATCH /settings/smtp
const updateSmtp = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const updates = [];

  if (body.host !== undefined) updates.push({ key: SMTP_KEYS.host, value: String(body.host).trim() });
  if (body.port !== undefined) {
    const n = Number(body.port);
    if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, 'Port must be a positive number', 'VALIDATION_ERROR');
    updates.push({ key: SMTP_KEYS.port, value: String(n) });
  }
  if (body.ssl !== undefined) updates.push({ key: SMTP_KEYS.ssl, value: String(!!body.ssl) });
  if (body.username !== undefined) updates.push({ key: SMTP_KEYS.username, value: String(body.username).trim() });
  if (body.fromName !== undefined) updates.push({ key: SMTP_KEYS.fromName, value: String(body.fromName).trim() });
  if (body.fromEmail !== undefined) updates.push({ key: SMTP_KEYS.fromEmail, value: String(body.fromEmail).trim() });
  if (body.password && body.password !== '***') {
    updates.push({ key: SMTP_KEYS.password, value: encryptToken(String(body.password)) });
  }

  await Promise.all(updates.map(({ key, value }) => SystemSettings.upsert({ key, value, updatedById: req.user.id })));
  await writeAudit(req, 'settings.smtp_update', 'SystemSettings', null, { fields: updates.map((u) => u.key) });
  res.json({ ok: true });
});

// POST /settings/smtp/test — Body: { ...overrides, sendTest: bool }. When
// sendTest is true, sends a real message to the logged-in admin's email.
const testSmtp = asyncHandler(async (req, res) => {
  const { sendTest, ...overrides } = req.body || {};
  if (sendTest && !req.user.email) {
    throw new ApiError(400, 'Your account has no email address on file to send the test to', 'VALIDATION_ERROR');
  }
  const result = await testSmtpConnection(overrides, sendTest ? req.user.email : null);
  res.json(result);
});

// ==================== Email processing log ====================

// GET /settings/email-log — last 100 processed inbound emails.
const getEmailLog = asyncHandler(async (req, res) => {
  const logs = await EmailProcessingLog.findAll({
    include: [{ model: Ticket, as: 'ticket', attributes: ['id', 'title'] }],
    order: [['processedAt', 'DESC']],
    limit: 100,
  });
  res.json({ logs });
});

module.exports = {
  getInbound, updateInbound, testInbound, getSmtp, updateSmtp, testSmtp, getEmailLog,
};
