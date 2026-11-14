// Whether each staff notification event emails by default (Settings ›
// Notifications; each person can choose their own in Preferences). The one
// list: the settings default, the mailer and the screens all read it (CS:
// there were three copies that disagreed).
const DEFAULT_EMAIL_PREFS = Object.freeze({
  assigned: true,
  comment: true,
  new_in_queue: true,
  sla_warning: true,
  sla_breached: true,
  watcher_update: false,
  task_added: true,
  task_unblocked: false,
  budget_warning: true,
  budget_reached: true,
});

// The stored defaults over the built-in ones, so every event has a value.
function completeEmailDefaults(raw) {
  let stored = {};
  try { stored = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {}; } catch { stored = {}; }
  const out = { ...DEFAULT_EMAIL_PREFS };
  for (const key of Object.keys(DEFAULT_EMAIL_PREFS)) if (typeof stored[key] === 'boolean') out[key] = stored[key];
  return out;
}

module.exports = { DEFAULT_EMAIL_PREFS, completeEmailDefaults };
