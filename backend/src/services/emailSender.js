// Outbound email (SMTP) — used by inbound-email auto-reply, tech-reply
// forwarding, and the "Send test email" button on Settings -> General
// Settings -> Outbound Email. Config lives in SystemSettings under the
// smtp.* dot-key namespace (same table/convention as ldap.*, company.*,
// etc — see settings_audit_build/ad_ldap_config_ui_build memory).
const nodemailer = require('nodemailer');
const { Op } = require('sequelize');
const { SystemSettings } = require('../models');
const { decryptToken } = require('../utils/tokenCrypto');

async function readSmtpSettingsRows() {
  const rows = await SystemSettings.findAll({ where: { key: { [Op.like]: 'smtp.%' } } });
  const db = {};
  rows.forEach((r) => { db[r.key] = r.value; });
  return db;
}

async function resolveSmtpConfig(db) {
  const values = db || await readSmtpSettingsRows();
  const ssl = values['smtp.ssl'] !== 'false'; // default true
  return {
    host: values['smtp.host'] || '',
    port: values['smtp.port'] ? Number(values['smtp.port']) : 587,
    ssl,
    username: values['smtp.username'] || '',
    password: values['smtp.password'] ? (decryptToken(values['smtp.password']) || '') : '',
    fromName: values['smtp.fromName'] || '',
    fromEmail: values['smtp.fromEmail'] || '',
  };
}

function isSmtpConfigured(config) {
  return !!(config.host && config.fromEmail);
}

function buildTransport(config) {
  // secure:true = implicit TLS (typically port 465); secure:false lets
  // nodemailer negotiate STARTTLS on its own for 587/25, which is the more
  // common modern setup — same true/false meaning as ImapFlow's `secure`.
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.ssl && config.port === 465,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 10000,
  });
}

// Sends one email. `headers` is a plain object merged in as custom headers
// (used for X-PRISM-Ticket-ID / In-Reply-To / References threading).
// `messageId` overrides nodemailer's auto-generated one — inboundEmailService
// .js sets this to a ticket-encoding value so replies can be threaded back
// without a separate lookup table (see its buildTicketMessageId()).
async function sendMail({ to, subject, text, html, attachments, headers, replyTo, messageId, inReplyTo, references }) {
  const config = await resolveSmtpConfig();
  if (!isSmtpConfigured(config)) {
    const e = new Error('SMTP is not configured (Settings -> General Settings -> Outbound Email)');
    e.code = 'SMTP_NOT_CONFIGURED';
    throw e;
  }
  const transport = buildTransport(config);
  try {
    return await transport.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
      to,
      replyTo: replyTo || config.fromEmail,
      subject,
      text,
      html,
      attachments,
      headers,
      messageId,
      inReplyTo,
      references,
    });
  } finally {
    transport.close();
  }
}

// POST /settings/smtp/test — verifies auth, then optionally sends a real
// test message if `sendTo` is given (the Settings page always passes the
// logged-in admin's email).
async function testSmtpConnection(overrides, sendTo) {
  const saved = await resolveSmtpConfig();
  const config = overrides && Object.keys(overrides).length ? { ...saved, ...buildOverrides(overrides, saved) } : saved;

  if (!isSmtpConfigured(config)) {
    return { success: false, message: 'Host and from-email are both required.' };
  }
  const transport = buildTransport(config);
  try {
    await transport.verify();
  } catch (err) {
    transport.close();
    return classifySmtpError(err);
  }
  if (!sendTo) {
    transport.close();
    return { success: true, message: `Connected to ${config.host} successfully.` };
  }
  try {
    await transport.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
      to: sendTo,
      subject: 'PRISM test email',
      text: 'This is a test email from PRISM to confirm your outbound email (SMTP) settings are working.',
    });
    return { success: true, message: `Test email sent to ${sendTo}.` };
  } catch (err) {
    return classifySmtpError(err);
  } finally {
    transport.close();
  }
}

function buildOverrides(overrides, saved) {
  return {
    host: overrides.host !== undefined ? String(overrides.host).trim() : saved.host,
    port: overrides.port !== undefined ? Number(overrides.port) : saved.port,
    ssl: overrides.ssl !== undefined ? !!overrides.ssl : saved.ssl,
    username: overrides.username !== undefined ? String(overrides.username).trim() : saved.username,
    password: overrides.password && overrides.password !== '***' ? String(overrides.password) : saved.password,
    fromName: overrides.fromName !== undefined ? String(overrides.fromName).trim() : saved.fromName,
    fromEmail: overrides.fromEmail !== undefined ? String(overrides.fromEmail).trim() : saved.fromEmail,
  };
}

function classifySmtpError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === 'EAUTH' || /invalid login|authentication failed/i.test(msg)) {
    return { success: false, message: 'Authentication failed: invalid username or password' };
  }
  if (code === 'ECONNREFUSED' || /connection refused/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection refused' };
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    return { success: false, message: 'Server unreachable: hostname could not be resolved' };
  }
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection timed out' };
  }
  return { success: false, message: `Connection failed: ${msg || 'Unknown error'}` };
}

module.exports = {
  resolveSmtpConfig, readSmtpSettingsRows, isSmtpConfigured, sendMail, testSmtpConnection,
};
