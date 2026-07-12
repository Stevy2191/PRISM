// Finds assets with subscription info (Network Equipment / Mobile Devices /
// Mobile Routers — any category with a "nextRenewalDate" AssetCategoryField,
// see migration 20260101000041). Shared by /assets/stats, the Calendar's
// subscription events, the dashboard panel, and assetAlertScheduler.js so
// all four agree on the same underlying data.
const { Op } = require('sequelize');
const { Asset, AssetCategory, AssetCategoryField, AssetFieldValue, Department } = require('../models');

// Returns one row per asset that has a nextRenewalDate value, with the
// renewal date and (if present) subscription provider name attached.
// `withinDays`, if given, filters to renewalDate <= today+N (including
// anything already past due — more urgent, not excluded).
async function getSubscriptionRenewals({ withinDays } = {}) {
  const trackedFields = await AssetCategoryField.findAll({
    where: { fieldKey: { [Op.in]: ['nextRenewalDate', 'subscriptionProvider'] } },
    attributes: ['id', 'fieldKey', 'categoryId'],
  });
  const renewalFieldIds = trackedFields.filter((f) => f.fieldKey === 'nextRenewalDate').map((f) => f.id);
  const providerFieldIds = trackedFields.filter((f) => f.fieldKey === 'subscriptionProvider').map((f) => f.id);
  if (!renewalFieldIds.length) return [];

  const renewalValues = await AssetFieldValue.findAll({
    where: { fieldId: { [Op.in]: renewalFieldIds }, value: { [Op.ne]: null } },
    include: [{
      model: Asset,
      as: 'asset',
      include: [
        { model: AssetCategory, as: 'category', attributes: ['id', 'name', 'color'] },
        { model: Department, as: 'department', attributes: ['id', 'name'] },
      ],
    }],
  });

  const assetIds = renewalValues.map((v) => v.assetId);
  const providerValues = providerFieldIds.length && assetIds.length
    ? await AssetFieldValue.findAll({ where: { fieldId: { [Op.in]: providerFieldIds }, assetId: { [Op.in]: assetIds } } })
    : [];
  const providerByAsset = new Map(providerValues.map((v) => [v.assetId, v.value]));

  let results = renewalValues
    .filter((v) => v.asset && v.value)
    .map((v) => ({
      asset: v.asset,
      renewalDate: v.value,
      provider: providerByAsset.get(v.assetId) || null,
    }));

  if (withinDays !== undefined) {
    const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
    results = results.filter((r) => r.renewalDate <= cutoff);
  }

  return results.sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
}

module.exports = { getSubscriptionRenewals };
