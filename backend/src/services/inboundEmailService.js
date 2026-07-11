// Inbound email -> ticket processing. Polled on an admin-configurable
// interval by inboundEmailScheduler.js. Config lives in SystemSettings
// under the inboundEmail.* dot-key namespace (see emailSender.js's header
// comment for the naming convention this follows).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { Op } = require('sequelize');
const {
  Ticket, Contact, Comment, Attachment, User, EmailProcessingLog, SystemSettings,
} = require('../models');
const { decryptToken } = require('../utils/tokenCrypto');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { getFirstTicketStatusByBehavior } = require('./statusBehavior');
const { getAllSettings } = require('../controllers/settingsController');
const { sendMail } = require('./emailSender');
const { notifyComment } = require('./notifications');

const PROCESSED_FOLDER = 'PRISM Processed';

async function readInboundEmailSettingsRows() {
  const rows = await SystemSettings.findAll({ where: { key: { [Op.like]: 'inboundEmail.%' } } });
  const db = {};
  rows.forEach((r) => { db[r.key] = r.value; });
  return db;
}

async function resolveInboundEmailConfig(db) {
  const values = db || await readInboundEmailSettingsRows();
  return {
    enabled: values['inboundEmail.enabled'] === 'true',
    host: values['inboundEmail.host'] || '',
    port: values['inboundEmail.port'] ? Number(values['inboundEmail.port']) : 993,
    ssl: values['inboundEmail.ssl'] !== 'false',
    address: values['inboundEmail.address'] || '',
    username: values['inboundEmail.username'] || values['inboundEmail.address'] || '',
    password: values['inboundEmail.password'] ? (decryptToken(values['inboundEmail.password']) || '') : '',
    pollInterval: values['inboundEmail.pollInterval'] ? Number(values['inboundEmail.pollInterval']) : 5,
  };
}

function isInboundConfigured(config) {
  return !!(config.host && config.address && config.password);
}

// See config/ldap.js's createClient() for why this listener has to exist —
// ImapFlow's client is an EventEmitter too, and a connection-level failure
// emitted outside any in-flight command's callback would otherwise crash
// the whole process as an unhandled 'error' event.
// ImapFlow's own connectionTimeout default is 90 seconds — fine for a
// background poll, but far too long for a "Test connection" button to sit
// spinning on an unreachable host. 10s matches the LDAP test-connection
// feature's timeout for the same UX reason.
const CONNECT_TIMEOUT_MS = 10000;

function createImapClient(config) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.ssl,
    auth: { user: config.username || config.address, pass: config.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });
  client.on('error', () => {});
  return client;
}

function classifyImapError(err) {
  const name = String(err?.authenticationFailed ? 'AuthenticationFailed' : err?.name || '');
  const code = String(err?.code || '');
  const msg = String(err?.message || err?.response || '');
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|LOGIN failed/i.test(msg) || /Auth/i.test(name)) {
    return { success: false, message: 'Authentication failed: invalid username or password' };
  }
  if (code === 'ECONNREFUSED' || /connection refused/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection refused' };
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    return { success: false, message: 'Server unreachable: hostname could not be resolved' };
  }
  if (code === 'ETIMEDOUT' || /timeout|timed out|establish connection|required time/i.test(msg)) {
    return { success: false, message: 'Server unreachable: connection timed out' };
  }
  return { success: false, message: `Connection failed: ${msg || 'Unknown error'}` };
}

// POST /settings/inbound-email/test
async function testImapConnection(config) {
  if (!isInboundConfigured(config)) {
    return { success: false, message: 'Host, email address, and password are all required.' };
  }
  const client = createImapClient(config);
  try {
    await client.connect();
    let messageCount = 0;
    const lock = await client.getMailboxLock('INBOX');
    try {
      messageCount = client.mailbox.exists;
    } finally {
      lock.release();
    }
    return { success: true, message: `Connected successfully. INBOX has ${messageCount} message${messageCount === 1 ? '' : 's'}.` };
  } catch (err) {
    return classifyImapError(err);
  } finally {
    try { await client.logout(); } catch { /* already disconnected */ }
  }
}

// ---- Message-ID based threading ----
// Every outbound email PRISM sends about a ticket (auto-reply or a tech's
// reply) gets a Message-ID that encodes the ticket id directly, so replies
// to it (In-Reply-To/References) can be matched back to that ticket without
// a separate lookup table.
function ticketDomain(fromEmail) {
  const at = String(fromEmail || '').split('@')[1];
  return at || 'prism.local';
}
function buildTicketMessageId(ticketId, fromEmail) {
  return `<prism-ticket-${ticketId}-${Date.now()}@${ticketDomain(fromEmail)}>`;
}
function detectTicketId(subject, inReplyTo, references) {
  const subjectMatch = /\[Ticket #0*(\d+)\]/i.exec(subject || '');
  if (subjectMatch) return parseInt(subjectMatch[1], 10);

  const refList = Array.isArray(references) ? references : (references ? [references] : []);
  const candidates = [inReplyTo, ...refList].filter(Boolean);
  for (const header of candidates) {
    const m = /prism-ticket-(\d+)-/i.exec(header);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The first admin user — attributed as the actor for system-generated
// comments/attachments (Comment.authorId and Attachment.uploadedById are
// both NOT NULL, and there's no human actor for an email-triggered event).
let cachedSystemActorId = null;
async function getSystemActorUserId() {
  if (cachedSystemActorId) return cachedSystemActorId;
  const admin = await User.findOne({ where: { role: 'admin' }, order: [['id', 'ASC']] });
  cachedSystemActorId = admin ? admin.id : null;
  return cachedSystemActorId;
}

async function findOrCreateContact(fromEmail, fromName) {
  const email = String(fromEmail || '').trim().toLowerCase();
  if (!email) return null;
  const existing = await Contact.findOne({ where: { email } });
  if (existing) return existing;

  const parts = String(fromName || '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || email.split('@')[0];
  const lastName = parts.slice(1).join(' ');
  return Contact.create({
    firstName,
    lastName,
    displayName: (fromName || '').trim() || email,
    email,
    status: 'active',
  });
}

async function saveAttachments(mailAttachments, ticketId, uploaderId) {
  if (!Array.isArray(mailAttachments) || !mailAttachments.length || !uploaderId) return;

  const settings = await getAllSettings();
  const maxMB = Number(settings['system.maxAttachmentSizeMB']) || 25;
  const maxBytes = maxMB * 1024 * 1024;

  const dir = path.join(UPLOAD_ROOT, String(ticketId));
  await fs.promises.mkdir(dir, { recursive: true });

  // eslint-disable-next-line no-restricted-syntax
  for (const att of mailAttachments) {
    if (!att.content || att.content.length > maxBytes) continue; // eslint-disable-line no-continue
    const ext = path.extname(att.filename || '') || '';
    const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    // eslint-disable-next-line no-await-in-loop
    await fs.promises.writeFile(path.join(dir, storedName), att.content);
    // eslint-disable-next-line no-await-in-loop
    await Attachment.create({
      filename: storedName,
      originalName: att.filename || 'attachment',
      mimeType: att.contentType || null,
      size: att.content.length,
      ticketId,
      uploadedById: uploaderId,
    });
  }
}

async function sendAutoReply(ticket, contact) {
  const settings = await getAllSettings();
  const companyName = settings['branding.appName'] || settings['company.name'] || 'PRISM';
  const ticketNumber = String(ticket.id).padStart(5, '0');
  const smtpFromRow = await SystemSettings.findOne({ where: { key: 'smtp.fromEmail' } });
  await sendMail({
    to: contact.email,
    subject: `Your request has been received [Ticket #${ticketNumber}]`,
    text: `Hi ${contact.firstName || contact.displayName || 'there'},\n\nWe have received your request and created ticket #${ticketNumber}. Our team will be in touch shortly.\n\n— ${companyName}`,
    headers: { 'X-PRISM-Ticket-ID': ticketNumber },
    messageId: buildTicketMessageId(ticket.id, smtpFromRow?.value),
  });
}

async function createTicketFromEmail({ contact, subject, textBody }) {
  const cleanTitle = String(subject || '').replace(/^\s*(re|fwd?)\s*:\s*/gi, '').trim().slice(0, 255) || '(no subject)';
  const firstOpenStatus = await getFirstTicketStatusByBehavior('open');
  return Ticket.create({
    title: cleanTitle,
    description: textBody || null,
    status: firstOpenStatus?.name || 'Open',
    priority: 'medium',
    type: 'request',
    source: 'email',
    contactId: contact.id,
    assigneeId: null,
    createdBy: null,
  });
}

async function ensureProcessedFolder(client) {
  try {
    const list = await client.list();
    if (!list.some((m) => m.path === PROCESSED_FOLDER)) {
      await client.mailboxCreate(PROCESSED_FOLDER);
    }
  } catch (err) {
    console.error('[inbound-email] failed to ensure "PRISM Processed" folder:', err.message);
  }
}

async function markProcessed(client, uid) {
  try {
    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    await client.messageMove(uid, PROCESSED_FOLDER, { uid: true });
  } catch (err) {
    console.error('[inbound-email] failed to mark/move message uid', uid, err.message);
  }
}

async function processOneMessage(client, uid, config) {
  const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return;

  const parsed = await simpleParser(msg.source);
  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const fromName = parsed.from?.value?.[0]?.name || '';
  const subject = parsed.subject || '(no subject)';
  const textBody = parsed.text || htmlToText(parsed.html) || '';
  const messageId = parsed.messageId || null;

  // Never let PRISM's own outbound mail (auto-replies, tech replies) loop
  // back in as a new "inbound" message if the mailbox ever sees its own sent copy.
  if (fromAddress && fromAddress === config.address.toLowerCase()) {
    await markProcessed(client, uid);
    await EmailProcessingLog.create({ messageId, fromEmail: fromAddress, subject, action: 'ignored', processedAt: new Date(), error: 'From address matches the configured inbox itself' });
    return;
  }

  const ticketId = detectTicketId(subject, parsed.inReplyTo, parsed.references);
  const systemActorId = await getSystemActorUserId();

  if (ticketId) {
    const ticket = await Ticket.findByPk(ticketId);
    if (ticket) {
      const contact = await findOrCreateContact(fromAddress, fromName);
      const comment = await Comment.create({
        body: textBody, authorId: systemActorId, ticketId: ticket.id, type: 'reply',
      });
      await saveAttachments(parsed.attachments, ticket.id, systemActorId);
      if (systemActorId) await notifyComment(ticket, comment, systemActorId).catch(() => {});
      await markProcessed(client, uid);
      await EmailProcessingLog.create({ messageId, fromEmail: fromAddress, subject, action: 'reply_added', ticketId: ticket.id, processedAt: new Date() });
      return;
    }
  }

  const contact = await findOrCreateContact(fromAddress, fromName);
  if (!contact) {
    await markProcessed(client, uid);
    await EmailProcessingLog.create({ messageId, fromEmail: fromAddress, subject, action: 'ignored', processedAt: new Date(), error: 'No usable From address' });
    return;
  }
  const ticket = await createTicketFromEmail({ contact, subject, textBody });
  await saveAttachments(parsed.attachments, ticket.id, systemActorId);
  await markProcessed(client, uid);
  await EmailProcessingLog.create({ messageId, fromEmail: fromAddress, subject, action: 'ticket_created', ticketId: ticket.id, processedAt: new Date() });

  try {
    await sendAutoReply(ticket, contact);
  } catch (err) {
    console.error('[inbound-email] auto-reply failed for ticket', ticket.id, err.message);
  }
}

// Runs one full poll cycle. Never throws — every failure is caught and
// logged so a single bad message (or a transient IMAP hiccup) never aborts
// the whole batch or crashes the scheduler that calls this.
async function pollInbox() {
  const config = await resolveInboundEmailConfig();
  if (!config.enabled || !isInboundConfigured(config)) {
    return { skipped: true };
  }

  const client = createImapClient(config);
  let processedCount = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length) {
        await ensureProcessedFolder(client);
        // eslint-disable-next-line no-restricted-syntax
        for (const uid of uids) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await processOneMessage(client, uid, config);
          } catch (err) {
            console.error('[inbound-email] failed to process message uid', uid, err);
            // eslint-disable-next-line no-await-in-loop
            await EmailProcessingLog.create({ action: 'failed', error: err.message, processedAt: new Date() }).catch(() => {});
          }
          processedCount += 1;
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[inbound-email] poll failed:', err.message);
    return { error: err.message };
  } finally {
    try { await client.logout(); } catch { /* already disconnected */ }
  }
  return { processedCount };
}

module.exports = {
  resolveInboundEmailConfig, readInboundEmailSettingsRows, isInboundConfigured,
  testImapConnection, pollInbox, buildTicketMessageId,
};
