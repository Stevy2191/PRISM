// Polls the inbound email inbox on an admin-configurable interval (Settings
// -> General Settings -> Inbound Email -> Poll interval: 1/2/5/10 minutes).
// Every other scheduler in this app (workflowScheduler, adSyncScheduler,
// calendarSyncScheduler) uses a fixed setInterval since their intervals are
// hardcoded — this one can't, because the interval itself is a live setting
// that can change at any time, so it self-reschedules with setTimeout,
// re-reading the current interval before each wait.
const { pollInbox, resolveInboundEmailConfig } = require('./inboundEmailService');

let running = false;

async function runOnce() {
  if (running) return; // don't overlap a poll with itself if one run ever takes longer than the interval
  running = true;
  try {
    await pollInbox();
  } catch (err) {
    console.error('[inbound-email-scheduler] poll failed:', err.message);
  } finally {
    running = false;
  }
}

async function scheduleNext() {
  let intervalMinutes = 5;
  try {
    const config = await resolveInboundEmailConfig();
    intervalMinutes = config.pollInterval || 5;
  } catch (err) {
    console.error('[inbound-email-scheduler] failed to read poll interval, defaulting to 5 minutes:', err.message);
  }
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, intervalMs);
}

let started = false;
function startInboundEmailScheduler() {
  if (started) return;
  started = true;
  scheduleNext();
  console.log('[inbound-email-scheduler] started (poll interval is admin-configurable, default 5 minutes)');
}

module.exports = { startInboundEmailScheduler, runOnce };
