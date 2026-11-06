// Asset activity log — one row per meaningful event (created, fields
// updated, status changed, assignment changed, ticket linked/unlinked).
// `detail` is a JSON blob rather than separate from/to columns (unlike
// TicketActivity) since a single "updated" entry can bundle several
// changed fields at once — see ticketActivity.js for the from/to-column
// sibling pattern this deliberately diverges from.
const { AssetActivity } = require('../models');

// opts.transaction: write inside the caller's transaction (it may hold a lock
// on the asset, which this row's foreign key would otherwise wait on).
async function logAssetActivity(assetId, userId, action, detail = null, { transaction } = {}) {
  return AssetActivity.create({
    assetId, userId: userId || null, action, detail,
  }, { transaction });
}

module.exports = { logAssetActivity };
