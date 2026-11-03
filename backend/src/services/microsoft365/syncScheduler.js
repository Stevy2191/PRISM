// Nightly Microsoft 365 sync (client portal 7b): every linked company is
// synced once a day after 02:00 in the organization's time zone. Same plain
// setInterval approach as adSyncScheduler.js, and like it, nothing runs on
// startup: a check every 15 minutes picks up a missed night instead.
const { getPortalMicrosoftApp } = require('../../controllers/settingsController');
const { orgTimeZone, todayInZone, zoneDayStart } = require('../../utils/orgTime');
const { syncCompany, syncableCompanies, isRunning } = require('./sync');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const RUN_HOUR = 2;

// Today's 02:00 in the organization's time zone.
async function tonightsRunAt(now = new Date()) {
  const tz = await orgTimeZone();
  return new Date(zoneDayStart(todayInZone(tz, now), tz).getTime() + RUN_HOUR * 3600000);
}

// Syncs, one at a time, every company not yet synced since today's 02:00.
async function runChecks(now = new Date()) {
  try {
    const { clientId, clientSecret } = await getPortalMicrosoftApp();
    if (!clientId || !clientSecret) return [];
    const runAt = await tonightsRunAt(now);
    if (now < runAt) return [];
    const due = (await syncableCompanies()).filter((c) => {
      const last = c.msLastSync && c.msLastSync.at ? new Date(c.msLastSync.at) : null;
      return (!last || last < runAt) && !isRunning(c.id);
    });
    const done = [];
    for (const company of due) {
      try {
        await syncCompany(company.id); // eslint-disable-line no-await-in-loop
        done.push(company.id);
      } catch (err) {
        console.error(`[m365-sync] company ${company.id} failed:`, err.message);
      }
    }
    return done;
  } catch (err) {
    console.error('[m365-sync] scheduler check failed:', err.message);
    return [];
  }
}

let started = false;
function startMicrosoftSyncScheduler() {
  if (started) return;
  started = true;
  setInterval(runChecks, CHECK_INTERVAL_MS);
  console.log('[m365-sync] started (nightly after 02:00, checking every 15 minutes)');
}

module.exports = { startMicrosoftSyncScheduler, runChecks, tonightsRunAt };
