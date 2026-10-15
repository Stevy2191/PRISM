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
  Ticket, Contact, Comment, Attachment, User, EmailProcessingLog, SystemSettings, Company, CompanyDomain, TicketCc,
} = require('../models');
const { decryptToken } = require('../utils/tokenCrypto');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { getFirstTicketStatusByBehavior, getTicketStatusBehaviorMap } = require('./statusBehavior');
const { getAllSettings } = require('../controllers/settingsController');
const { sendTicketEmail, buildTicketMessageId } = require('./email/ticketMail');
const { findTicketRef, classifyInbound } = require('./email/inboundClassify');
const { verifySender, isMicrosoftHost } = require('./email/senderAuth');
const { isEmail, MAX_EXTRA: MAX_TICKET_CCS } = require('./email/recipients');
const { ownAddresses } = require('./email/ticketMail');
const { assertCanWorkTicket } = require('./ticketPeople');
const { canEditTicket } = require('./permissionService');
const { FREE_MAIL_DOMAINS } = require('./companyService');
const { notifyComment, createNotification } = require('./notifications');
const { moveToSystemStatus } = require('./statusMoves');

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
    staffSenderCheck: values['inboundEmail.staffSenderCheck'] === 'off' ? 'off' : 'strict',
    trustedAuthServId: values['inboundEmail.trustedAuthServId'] || '',
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
// Outbound ticket mail carries a Message-ID that encodes the ticket id
// (services/email/ticketMail.js), matched again below.
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

  // Spec: match the sender's domain to an active client company; free-mail
  // never matches; otherwise the model hook files the contact under the
  // internal company. (A sender address can be forged, so this only decides
  // which company's staff see the new contact and its tickets.)
  const domain = email.slice(email.lastIndexOf('@') + 1);
  let companyId;
  if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
    const owner = await CompanyDomain.findOne({
      where: { domain },
      include: [{ model: Company, as: 'company', where: { status: 'active', isClient: true }, attributes: ['id'] }],
    });
    if (owner) companyId = owner.companyId;
  }

  const parts = String(fromName || '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || email.split('@')[0];
  const lastName = parts.slice(1).join(' ');
  return Contact.create({
    firstName,
    lastName,
    displayName: (fromName || '').trim() || email,
    email,
    status: 'active',
    companyId,
  });
}

async function saveAttachments(mailAttachments, ticketId, uploaderId, commentId = null) {
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
      commentId,
      uploadedById: uploaderId,
    });
  }
}

async function sendAutoReply(ticket, contact) {
  await sendTicketEmail('contact_auto_reply', { ticket, contact, to: [contact.email] });
}

async function createTicketFromEmail({
  contact, subject, textBody, assigneeId = null,
}) {
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
    // Spec: the department defaults to the contact's (it is in the
    // contact's company, as the ticket will be).
    departmentId: contact.departmentId || null,
    assigneeId,
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

function logResult(parsed, fromAddress, subject, result, error) {
  return EmailProcessingLog.create({
    messageId: parsed.messageId || null,
    fromEmail: fromAddress || null,
    subject,
    action: result.action,
    ticketId: result.ticketId,
    processedAt: new Date(),
    error: error || null,
  });
}

// All addresses in a parsed address header (mailparser groups them).
function addressesOf(field) {
  const groups = Array.isArray(field) ? field : (field ? [field] : []);
  const out = [];
  groups.forEach((g) => (g.value || []).forEach((a) => {
    if (a.address) out.push({ address: a.address.trim().toLowerCase(), name: a.name || '' });
    (a.group || []).forEach((m) => { if (m.address) out.push({ address: m.address.trim().toLowerCase(), name: m.name || '' }); });
  }));
  return out;
}

// The active PRISM user an address belongs to, if any; `ambiguous` when
// more than one active account has it.
async function findStaffByEmail(address) {
  if (!address) return { user: null, ambiguous: false };
  const users = await User.findAll({ where: { email: address, isActive: true }, order: [['id', 'ASC']], limit: 2 });
  return { user: users[0] || null, ambiguous: users.length > 1 };
}

// Adds addresses to a ticket's CC list (from email: addedById null), up to
// the list's cap, skipping invalid ones and ones already on it.
async function addCcs(ticketId, addresses) {
  const existing = new Set((await TicketCc.findAll({ where: { ticketId }, attributes: ['email'] })).map((c) => c.email));
  // eslint-disable-next-line no-restricted-syntax
  for (const email of addresses) {
    if (existing.size >= MAX_TICKET_CCS) break;
    if (!isEmail(email) || existing.has(email)) continue; // eslint-disable-line no-continue
    existing.add(email);
    // eslint-disable-next-line no-await-in-loop
    await TicketCc.create({ ticketId, email, addedById: null });
  }
}

// Unverified mail's attachments are not kept: anyone can forge a From
// address, and a saved file would look like any other ticket attachment.
function unverifiedBody(address, textBody, attachments) {
  const names = (Array.isArray(attachments) ? attachments : []).map((a) => a.filename || 'attachment');
  const dropped = names.length ? `\n\nAttachments not saved: ${names.join(', ')}` : '';
  return `Unverified sender ${address}:\n\n${textBody}${dropped}`;
}

// Everything after fetching: decides what a parsed message is (see
// services/email/inboundClassify.js), acts on it and logs it. Returns
// { action, ticketId }.
async function handleParsedMessage(parsed, config) {
  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const fromName = parsed.from?.value?.[0]?.name || '';
  const subject = parsed.subject || '(no subject)';
  const textBody = parsed.text || htmlToText(parsed.html) || '';
  const own = new Set([String(config.address || '').toLowerCase(), ...(await ownAddresses())].filter(Boolean));

  // Never let PRISM's own outbound mail (auto-replies, tech replies) loop
  // back in as a new "inbound" message if the mailbox ever sees its own sent copy.
  if (fromAddress && own.has(fromAddress)) {
    const result = { action: 'ignored', ticketId: null };
    await logResult(parsed, fromAddress, subject, result, 'From address matches the configured inbox itself');
    return result;
  }

  // Which ticket: "[Ticket #N]" or PRISM's own threading, then the ticket an
  // email this one replies to was filed on, then a bare "#N".
  let ref = findTicketRef(subject, parsed.inReplyTo, parsed.references);
  if (!ref || ref.loose) {
    const cited = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])]
      .filter((v) => typeof v === 'string' && v.length <= 500);
    const earlier = cited.length
      ? await EmailProcessingLog.findOne({ where: { messageId: cited, ticketId: { [Op.ne]: null } }, order: [['id', 'DESC']] })
      : null;
    if (earlier) ref = { id: earlier.ticketId, loose: false };
  }
  const withContact = { include: [{ model: Contact, as: 'contact', attributes: ['email'] }] };
  let ticket = ref ? await Ticket.findByPk(ref.id, withContact) : null;
  // A merged ticket's mail belongs to the ticket it was merged into (5b).
  // Followed before the sender is classified, so the contact and CC checks
  // run against the live ticket. Bounded: a loop or a missing link stops at
  // the last ticket found.
  for (let hops = 0; ticket && ticket.mergedIntoId && hops < 10; hops += 1) {
    // eslint-disable-next-line no-await-in-loop
    const next = await Ticket.findByPk(ticket.mergedIntoId, withContact);
    if (!next) break;
    ticket = next;
  }

  // Who is the sender? The subject/In-Reply-To/References headers are
  // attacker-controlled — a ticket number there is not proof the sender
  // belongs to that ticket. Its contact is its side; staff must pass the
  // receiving server's sender check (even when on the CC list); others on
  // the CC list are its side too; anyone else gets a new ticket of their
  // own instead of injecting content into this one.
  let senderKind = 'other';
  const isContact = !!(ticket && fromAddress && ticket.contact
    && String(ticket.contact.email || '').toLowerCase() === fromAddress);
  const staffMatch = isContact ? { user: null, ambiguous: false } : await findStaffByEmail(fromAddress);
  const staff = staffMatch.user;
  if (isContact) senderKind = 'contact_side';
  else if (staff) senderKind = 'staff';
  else if (ticket && fromAddress && (await TicketCc.findOne({ where: { ticketId: ticket.id, email: fromAddress } }))) senderKind = 'contact_side';
  // A bare "#N" only counts for that ticket's own contact or CC list.
  if (ticket && ref.loose && senderKind !== 'contact_side') ticket = null;

  let verified = false;
  let staffCanEdit = false;
  if (staff) {
    // Two active accounts with one address: no telling who sent it.
    verified = !staffMatch.ambiguous && verifySender(parsed.headers, fromAddress, {
      mode: config.staffSenderCheck || 'strict',
      trustedAuthServId: config.trustedAuthServId || '',
      microsoftMailbox: isMicrosoftHost(config.host),
    }).verified;
    staffCanEdit = !!ticket && (await canEditTicket(staff, ticket));
  }

  // The customers on a staff email: To/Cc recipients that are not staff,
  // not PRISM's own mailboxes and not the sender. A contact is never made
  // for a staff address.
  const customers = [];
  if (staff && !ticket) {
    // eslint-disable-next-line no-restricted-syntax
    for (const r of [...addressesOf(parsed.to), ...addressesOf(parsed.cc)]) {
      if (own.has(r.address) || r.address === fromAddress || !isEmail(r.address)) continue; // eslint-disable-line no-continue
      if (customers.some((c) => c.address === r.address)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      if ((await findStaffByEmail(r.address)).user) continue; // eslint-disable-line no-continue
      customers.push(r);
    }
  }

  const action = classifyInbound({
    ticketFound: !!ticket, senderKind, verified, staffCanEdit, hasCustomerRecipient: customers.length > 0,
  });
  const systemActorId = await getSystemActorUserId();
  const done = async (result, error) => {
    await logResult(parsed, fromAddress, subject, result, error);
    return result;
  };

  if (action === 'reply_added') {
    const comment = await Comment.create({
      body: textBody, authorId: systemActorId, ticketId: ticket.id, type: 'reply',
    });
    await saveAttachments(parsed.attachments, ticket.id, systemActorId, comment.id);
    // A reply never reopens a closed ticket: a person decides (user
    // decision 2026-10-15). An open or on-hold one moves to User responded.
    const kind = (await getTicketStatusBehaviorMap()).get(ticket.status);
    if (kind === 'closed' || kind === 'archived') {
      if (ticket.assigneeId) {
        await createNotification({
          userId: ticket.assigneeId,
          type: 'comment',
          message: `Customer replied to closed ticket #${String(ticket.id).padStart(5, '0')}: ${ticket.title}`,
          ticketId: ticket.id,
        }).catch(() => {});
      }
    } else {
      await moveToSystemStatus(ticket, 'user_responded', systemActorId);
      if (systemActorId) await notifyComment(ticket, comment, systemActorId).catch(() => {});
    }
    return done({ action, ticketId: ticket.id });
  }

  if (action === 'staff_reply_added') {
    // The recipients already have it: never re-sent. Not a first response
    // either (only the comment endpoint records one).
    const comment = await Comment.create({
      body: textBody, authorId: staff.id, ticketId: ticket.id, type: 'comment_public', viaEmail: true,
    });
    await saveAttachments(parsed.attachments, ticket.id, staff.id, comment.id);
    await notifyComment(ticket, comment, staff.id).catch(() => {});
    return done({ action, ticketId: ticket.id });
  }

  if (action === 'unverified_note') {
    await Comment.create({
      body: unverifiedBody(fromAddress, textBody, parsed.attachments), authorId: systemActorId, ticketId: ticket.id, type: 'comment_private', viaEmail: true,
    });
    return done({ action, ticketId: ticket.id });
  }

  if (action === 'ignored') return done({ action, ticketId: null }, 'No customer on the email');

  if (action === 'staff_ticket_created' || action === 'staff_ticket_unverified') {
    const isVerified = action === 'staff_ticket_created';
    const [first, ...others] = customers;
    const contact = await findOrCreateContact(first.address, first.name);
    // Assigned to the sender only if they can work this company's tickets.
    const assigneeId = isVerified ? await assertCanWorkTicket(staff.id, contact.companyId, 'Sender').catch(() => null) : null;
    const created = await createTicketFromEmail({
      contact, subject, textBody: null, assigneeId,
    });
    const firstComment = await Comment.create(isVerified
      ? { body: textBody, authorId: staff.id, ticketId: created.id, type: 'comment_public', viaEmail: true }
      : { body: unverifiedBody(fromAddress, textBody, parsed.attachments), authorId: systemActorId, ticketId: created.id, type: 'comment_private', viaEmail: true });
    if (isVerified) await addCcs(created.id, others.map((c) => c.address));
    if (isVerified) await saveAttachments(parsed.attachments, created.id, staff.id, firstComment.id);
    return done({ action, ticketId: created.id });
  }

  // ticket_created: a new ticket for the sender (never a staff address —
  // staff without a customer recipient were ignored above).
  const contact = await findOrCreateContact(fromAddress, fromName);
  if (!contact) return done({ action: 'ignored', ticketId: null }, 'No usable From address');
  const created = await createTicketFromEmail({ contact, subject, textBody });
  await addCcs(created.id, addressesOf(parsed.cc).map((c) => c.address).filter((e) => !own.has(e) && e !== fromAddress));
  await saveAttachments(parsed.attachments, created.id, systemActorId);
  setImmediate(() => {
    sendAutoReply(created, contact).catch((err) => {
      console.error('[inbound-email] auto-reply failed for ticket', created.id, err.message);
    });
  });
  return done({ action: 'ticket_created', ticketId: created.id });
}

async function processOneMessage(client, uid, config) {
  const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return;
  const parsed = await simpleParser(msg.source);
  await handleParsedMessage(parsed, config);
  await markProcessed(client, uid);
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
  testImapConnection, pollInbox, buildTicketMessageId, findOrCreateContact,
  createTicketFromEmail, sendAutoReply, handleParsedMessage, // exported for the integration tests
  getSystemActorUserId,
};
