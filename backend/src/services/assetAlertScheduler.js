// Auto-creates reminder tickets for every "expiring item" type in the
// Assets section (hardware warranty/replacement/subscription, software
// licenses, vendor contracts) once its date falls within its own
// Settings-backed alert window (Settings -> Asset Alerts). Modeled on
// csatScheduler.js/workflowScheduler.js — single backend instance, no
// Redis/cron framework, plain setInterval polling.
const { Op } = require('sequelize');
const {
  Ticket, Asset, AssetActivity, AssetTicket, SystemSettings,
  License, LicenseTicket, LicenseActivity,
  Contract, ContractAsset, ContractTicket, ContractActivity,
} = require('../models');
const { getAllSettings } = require('../controllers/settingsController');
const { getSubscriptionRenewals } = require('./assetSubscriptionService');
const { logAssetActivity } = require('./assetActivity');
const { getTicketStatusBuckets } = require('./statusBehavior');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function cutoffStr(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

// ==================== Asset subscription renewals ====================
// A renewal date change (asset renewed, or admin corrected the date) should
// trigger a fresh alert — so the dedup key is (assetId, renewalDate), not
// just assetId. Stored as an AssetActivity row rather than a dedicated
// column since this is a one-off marker, same reasoning as every other
// "did we already do X" check in this app that doesn't warrant a new table.
async function alreadyAlertedByDate(assetId, action, dateStr) {
  const rows = await AssetActivity.findAll({ where: { assetId, action } });
  return rows.some((r) => r.detail?.date === dateStr || r.detail?.renewalDate === dateStr);
}

async function checkSubscriptionRenewals() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['assets.subscriptionAlertDays']) || 30;
  const renewals = await getSubscriptionRenewals({ withinDays: alertDays });

  // eslint-disable-next-line no-restricted-syntax
  for (const r of renewals) {
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyAlertedByDate(r.asset.id, 'subscription_alert_ticket_created', r.renewalDate)) continue; // eslint-disable-line no-continue

    const providerLabel = r.provider || 'subscription';
    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `Subscription renewal due: ${r.asset.name} — ${providerLabel} — Renews ${r.renewalDate}`,
      description: `Automated alert: the subscription for asset ${r.asset.assetTag} (${r.asset.name}) renews on ${r.renewalDate}.`,
      status: 'Open', priority: 'medium', type: 'request', source: 'manual',
      assigneeId: null, departmentId: r.asset.departmentId || null, contactId: null, createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await AssetTicket.create({ assetId: r.asset.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await logAssetActivity(r.asset.id, null, 'subscription_alert_ticket_created', {
      renewalDate: r.renewalDate, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0'),
    });
  }
}

// ==================== Asset warranty expiry ====================
async function checkWarrantyExpiry() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['assets.warrantyAlertDays']) || 90;
  const assets = await Asset.findAll({
    where: { warrantyExpiryDate: { [Op.ne]: null, [Op.gte]: todayStr(), [Op.lte]: cutoffStr(alertDays) } },
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const asset of assets) {
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyAlertedByDate(asset.id, 'warranty_alert_ticket_created', asset.warrantyExpiryDate)) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `Warranty expiring: ${asset.name} (${asset.assetTag}) — Expires ${asset.warrantyExpiryDate}`,
      description: `Automated alert: the warranty for asset ${asset.assetTag} (${asset.name}) expires on ${asset.warrantyExpiryDate}.`,
      status: 'Open', priority: 'medium', type: 'request', source: 'manual',
      assigneeId: null, departmentId: asset.departmentId || null, contactId: null, createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await AssetTicket.create({ assetId: asset.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await logAssetActivity(asset.id, null, 'warranty_alert_ticket_created', {
      date: asset.warrantyExpiryDate, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0'),
    });
  }
}

// ==================== Asset replacement plan ====================
async function checkReplacementDates() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['assets.replacementAlertDays']) || 90;
  const assets = await Asset.findAll({
    where: { replacementPlanDate: { [Op.ne]: null, [Op.gte]: todayStr(), [Op.lte]: cutoffStr(alertDays) } },
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const asset of assets) {
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyAlertedByDate(asset.id, 'replacement_alert_ticket_created', asset.replacementPlanDate)) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `Replacement due: ${asset.name} (${asset.assetTag}) — Planned ${asset.replacementPlanDate}`,
      description: `Automated alert: asset ${asset.assetTag} (${asset.name}) is due for replacement on ${asset.replacementPlanDate}.`,
      status: 'Open', priority: 'medium', type: 'request', source: 'manual',
      assigneeId: null, departmentId: asset.departmentId || null, contactId: null, createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await AssetTicket.create({ assetId: asset.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await logAssetActivity(asset.id, null, 'replacement_alert_ticket_created', {
      date: asset.replacementPlanDate, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0'),
    });
  }
}

// ==================== Licenses & Contracts ====================
// Different dedup rule than the date-marker checks above (per spec): before
// creating a ticket, check whether a previously auto-created ticket for
// this license/contract is still open — if so, skip (no duplicate reminder
// while one's already being worked). Only create a new one once the
// previous alert ticket has been closed (or none exists yet).
async function hasOpenAlertTicket(TicketLinkModel, idField, id, openStatuses) {
  const links = await TicketLinkModel.findAll({ where: { [idField]: id }, include: [{ model: Ticket, as: 'ticket' }] });
  return links.some((l) => l.ticket && openStatuses.includes(l.ticket.status));
}

async function checkLicenseExpiry() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['licenses.expiryAlertDays']) || 30;
  const buckets = await getTicketStatusBuckets();
  const licenses = await License.findAll({
    where: { expiryDate: { [Op.ne]: null, [Op.gte]: todayStr(), [Op.lte]: cutoffStr(alertDays) } },
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const license of licenses) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasOpenAlertTicket(LicenseTicket, 'licenseId', license.id, buckets.open)) continue; // eslint-disable-line no-continue

    const daysLeft = Math.round((new Date(`${license.expiryDate}T00:00:00`).getTime() - new Date(`${todayStr()}T00:00:00`).getTime()) / 86400000);
    const priority = daysLeft < 14 ? 'high' : 'medium';
    const seatsLine = license.totalSeats !== null ? `${license.totalSeats} seats affected.` : 'Unlimited seats.';
    const costLine = license.annualCost !== null ? `$${Number(license.annualCost).toLocaleString()}` : 'not set';

    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `License expiring: ${license.name} — Expires ${license.expiryDate}`,
      description: `The ${license.vendor || 'vendor'} license for ${license.name} expires on ${license.expiryDate}. ${seatsLine} Annual cost: ${costLine}. Auto-renews: ${license.autoRenews ? 'yes' : 'no'}. Action required: renew or purchase replacement.`,
      status: 'Open', priority, type: 'request', source: 'manual',
      assigneeId: null, departmentId: license.departmentId || null, contactId: null, createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await LicenseTicket.create({ licenseId: license.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await LicenseActivity.create({
      licenseId: license.id, userId: null, action: 'expiry_alert_ticket_created',
      detail: { expiryDate: license.expiryDate, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0') },
    });
  }
}

async function checkContractRenewals() {
  const settings = await getAllSettings();
  const alertDays = Number(settings['contracts.renewalAlertDays']) || 60;
  const buckets = await getTicketStatusBuckets();
  const contracts = await Contract.findAll({
    where: {
      [Op.or]: [
        { renewalDate: { [Op.ne]: null, [Op.gte]: todayStr(), [Op.lte]: cutoffStr(alertDays) } },
        { renewalDate: null, endDate: { [Op.ne]: null, [Op.gte]: todayStr(), [Op.lte]: cutoffStr(alertDays) } },
      ],
    },
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const contract of contracts) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasOpenAlertTicket(ContractTicket, 'contractId', contract.id, buckets.open)) continue; // eslint-disable-line no-continue

    const renewsOn = contract.renewalDate || contract.endDate;
    const daysLeft = Math.round((new Date(`${renewsOn}T00:00:00`).getTime() - new Date(`${todayStr()}T00:00:00`).getTime()) / 86400000);
    const priority = daysLeft < 30 ? 'high' : 'medium';
    const costLine = contract.annualCost !== null ? `$${Number(contract.annualCost).toLocaleString()}` : 'not set';
    // eslint-disable-next-line no-await-in-loop
    const assetsCoveredCount = await ContractAsset.count({ where: { contractId: contract.id } });
    const contactLine = [contract.contactPerson, contract.contactEmail, contract.contactPhone].filter(Boolean).join(' / ') || 'not set';

    // eslint-disable-next-line no-await-in-loop
    const ticket = await Ticket.create({
      title: `Contract renewal: ${contract.name} — Renews ${renewsOn}`,
      description: `The ${contract.vendor || 'vendor'} contract "${contract.name}" renews on ${renewsOn}. Vendor contact: ${contactLine}. Annual cost: ${costLine}. Assets covered: ${assetsCoveredCount}. Action required: review and confirm renewal or cancel.`,
      status: 'Open', priority, type: 'request', source: 'manual',
      assigneeId: null, departmentId: contract.departmentId || null, contactId: null, createdBy: null,
    });
    // eslint-disable-next-line no-await-in-loop
    await ContractTicket.create({ contractId: contract.id, ticketId: ticket.id, linkedBy: null });
    // eslint-disable-next-line no-await-in-loop
    await ContractActivity.create({
      contractId: contract.id, userId: null, action: 'renewal_alert_ticket_created',
      detail: { renewalDate: renewsOn, ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0') },
    });
  }
}

async function runChecks() {
  const checks = [
    ['subscription renewal', checkSubscriptionRenewals],
    ['warranty expiry', checkWarrantyExpiry],
    ['replacement plan', checkReplacementDates],
    ['license expiry', checkLicenseExpiry],
    ['contract renewal', checkContractRenewals],
  ];
  // eslint-disable-next-line no-restricted-syntax
  for (const [label, fn] of checks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fn();
    } catch (err) {
      console.error(`[asset-alert-scheduler] ${label} check failed:`, err);
    }
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
