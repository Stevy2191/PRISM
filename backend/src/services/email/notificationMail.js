// Technician email notifications (spec 5a). Some in-app notification types
// also email the person they're for: on/off per user per event, else the
// admin default (notifications.emailDefaults). createNotification has
// already applied the system-wide switch and the "can reach the ticket"
// check before anything gets here.
const { User, Ticket } = require('../../models');
const { getAllSettings } = require('../../controllers/settingsController');
const { resolveSmtpConfig, isSmtpConfigured } = require('../emailSender');
const { sendTicketEmail } = require('./ticketMail');

// Notification type → staff template. Other types never email.
const EMAIL_EVENTS = Object.freeze({
  assigned: 'staff_assigned',
  comment: 'staff_reply',
  watcher_update: 'staff_watcher_update',
  new_in_queue: 'staff_new_in_queue',
  sla_warning: 'staff_sla_warning',
  sla_breached: 'staff_sla_breached',
});

const DEFAULT_EMAIL_PREFS = Object.freeze({
  assigned: true, comment: true, new_in_queue: true, sla_warning: true, sla_breached: true, watcher_update: false,
});

// { type: bool } with known types only, or null. Anything else → null.
function validEmailPrefs(value) {
  if (value === null) return { ok: true, value: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const entries = Object.entries(value);
  if (!entries.every(([k, v]) => Object.hasOwn(EMAIL_EVENTS, k) && typeof v === 'boolean')) return { ok: false };
  return { ok: true, value: Object.fromEntries(entries) };
}

function effectiveEmailPref(user, type, defaults) {
  if (!Object.hasOwn(EMAIL_EVENTS, type)) return false;
  const own = user && user.notificationEmailPrefs;
  if (own && typeof own[type] === 'boolean') return own[type];
  if (defaults && typeof defaults[type] === 'boolean') return defaults[type];
  return DEFAULT_EMAIL_PREFS[type];
}

function parseDefaults(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function sendNotificationEmail(notification) {
  const key = EMAIL_EVENTS[notification.type];
  if (!key || !notification.ticketId) return;
  const user = await User.findByPk(notification.userId, { attributes: ['id', 'email', 'isActive', 'notificationEmailPrefs'] });
  if (!user || !user.isActive || !user.email) return;
  const settings = await getAllSettings();
  if (!effectiveEmailPref(user, notification.type, parseDefaults(settings['notifications.emailDefaults']))) return;
  if (!isSmtpConfigured(await resolveSmtpConfig())) return;
  const ticket = await Ticket.findByPk(notification.ticketId);
  if (!ticket) return;
  await sendTicketEmail(key, {
    ticket, to: [user.email], extra: { notification: { message: notification.message } },
  });
}

// Runs after the request: a mail failure is only logged.
function queueNotificationEmail(notification) {
  if (!Object.hasOwn(EMAIL_EVENTS, notification.type)) return;
  setImmediate(() => {
    sendNotificationEmail(notification).catch((err) => {
      console.error(`[email] ${notification.type} notification email failed for user ${notification.userId}:`, err.message);
    });
  });
}

module.exports = {
  EMAIL_EVENTS, DEFAULT_EMAIL_PREFS, effectiveEmailPref, validEmailPrefs, queueNotificationEmail,
};
