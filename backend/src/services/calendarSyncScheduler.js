// Refreshes every active calendar integration's cached events every 30
// minutes — same plain setInterval approach as workflowScheduler.js /
// adSyncScheduler.js (no cron/job framework in this app).
const { UserCalendarIntegration } = require('../models');
const { syncIntegration } = require('./calendarSync');

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

async function syncAllActiveIntegrations() {
  const integrations = await UserCalendarIntegration.findAll({ where: { isActive: true } });
  // eslint-disable-next-line no-restricted-syntax
  for (const integration of integrations) {
    // eslint-disable-next-line no-await-in-loop
    const result = await syncIntegration(integration);
    if (!result.ok) {
      console.error(`[calendar-sync-scheduler] integration ${integration.id} (${integration.provider}) failed:`, result.reason);
    }
  }
}

async function runChecks() {
  try {
    await syncAllActiveIntegrations();
  } catch (err) {
    console.error('[calendar-sync-scheduler] sync pass failed:', err.message);
  }
}

let started = false;
function startCalendarSyncScheduler() {
  if (started) return;
  started = true;
  setInterval(runChecks, SYNC_INTERVAL_MS);
  console.log('[calendar-sync-scheduler] started (syncing every 30 minutes)');
}

module.exports = { startCalendarSyncScheduler, runChecks, syncAllActiveIntegrations };
