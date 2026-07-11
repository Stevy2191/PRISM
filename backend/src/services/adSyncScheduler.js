// Scheduled AD contact sync — mirrors workflowScheduler.js's plain
// setInterval approach (no cron/job framework in this app: single backend
// instance, no Redis). Deliberately does NOT run a sync immediately on
// startup (unlike workflowScheduler's lightweight checks): an AD sync does
// a full LDAP directory query plus per-user upserts, which is heavy enough
// that firing it on every backend restart/deploy would be surprising.
const { SystemSettings, AdSyncLog } = require('../models');
const { runAdContactSync } = require('./adContactSync');
const { isConfigured } = require('../config/ldap');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function getSetting(key, fallback) {
  const row = await SystemSettings.findOne({ where: { key } });
  return row ? row.value : fallback;
}

async function maybeRunScheduledSync() {
  const [enabledRaw, intervalRaw] = await Promise.all([
    getSetting('adsync.enabled', 'false'),
    getSetting('adsync.intervalHours', '24'),
  ]);
  if (enabledRaw !== 'true' || !(await isConfigured())) return;

  const intervalHours = Number(intervalRaw);
  if (!intervalHours || intervalHours <= 0) return; // 0 = manual only

  const lastLog = await AdSyncLog.findOne({ order: [['startedAt', 'DESC']] });
  const dueAt = lastLog ? new Date(lastLog.startedAt).getTime() + intervalHours * 3600000 : 0;
  if (Date.now() < dueAt) return;

  await runAdContactSync('scheduled');
}

async function runChecks() {
  try {
    await maybeRunScheduledSync();
  } catch (err) {
    console.error('[ad-sync-scheduler] sync failed:', err.message);
  }
}

let started = false;
function startAdSyncScheduler() {
  if (started) return;
  started = true;
  setInterval(runChecks, CHECK_INTERVAL_MS);
  console.log('[ad-sync-scheduler] started (checking every 15 minutes)');
}

module.exports = { startAdSyncScheduler, runChecks };
