// Auto-creates a reminder ticket when an asset's subscription renewal date
// falls within the configured alert window (Settings-backed
// `assets.subscriptionAlertDays`, default 30). Modeled on
// csatScheduler.js/workflowScheduler.js — single backend instance, no
// Redis/cron framework, plain setInterval polling.
const { Ticket, AssetActivity, AssetTicket, SystemSettings } = require('../models');
const { getAllSettings } = require('../controllers/settingsController');
const { getSubscriptionRenewals } = require('./assetSubscriptionService');
const { logAssetActivity } = require('./assetActivity');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

// A renewal date change (asset renewed, or admin corrected the date) should
// trigger a fresh alert — so the dedup key is (assetId, renewalDate), not
// just assetId. Stored as an AssetActivity row rather than a dedicated
// column since this is a one-off marker, same reasoning as every other
// "did we already do X" check in this app that doesn't warrant a new table.
async function alreadyAlerted(assetId, renewalDate) {
  const rows = await AssetActivity.findAll({ where: { assetId, action: 'subscription_alert_ticket_created' } });
  return rows.some((r) => r.detail?.renewalDate === renewalDate);
}

async function checkSubscriptionRenewals() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['assets.subscriptionAlertDays']) || 30;
  const renewals = await getSubscriptionRenewals({ withinDays: alertDays });

  // eslint-disable-next-line no-restricted-syntax
  for (const r of renewals) {
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyAlerted(r.asset.id, r.renewalDate)) continue; // eslint-disable-line no-continue

    const providerLabel = r.provider || 'subscription';
    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `Subscription renewal due: ${r.asset.name} — ${providerLabel} — Renews ${r.renewalDate}`,
      description: `Automated alert: the subscription for asset ${r.asset.assetTag} (${r.asset.name}) renews on ${r.renewalDate}.`,
      status: 'Open',
      priority: 'medium',
      type: 'request',
      source: 'manual',
      assigneeId: null,
      departmentId: r.asset.departmentId || null,
      contactId: null,
      createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await AssetTicket.create({ assetId: r.asset.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await logAssetActivity(r.asset.id, null, 'subscription_alert_ticket_created', {
      renewalDate: r.renewalDate, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0'),
    });
  }
}

async function runChecks() {
  try {
    await checkSubscriptionRenewals();
  } catch (err) {
    console.error('[asset-alert-scheduler] subscription renewal check failed:', err);
  }
  try {
    await SystemSettings.upsert({ key: 'scheduler.assetAlertLastRun', value: new Date().toISOString() });
  } catch (err) {
    console.error('[asset-alert-scheduler] failed to record last-run timestamp:', err);
  }
}

let started = false;
function startAssetAlertScheduler() {
  if (started) return;
  started = true;
  runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
  console.log('[asset-alert-scheduler] started (checking every 15 minutes)');
}

module.exports = { startAssetAlertScheduler, runChecks };
