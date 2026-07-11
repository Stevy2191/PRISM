// Asset activity log — one row per meaningful event (created, fields
// updated, status changed, assignment changed, ticket linked/unlinked).
// `detail` is a JSON blob rather than separate from/to columns (unlike
// TicketActivity) since a single "updated" entry can bundle several
// changed fields at once — see ticketActivity.js for the from/to-column
// sibling pattern this deliberately diverges from.
const { AssetActivity } = require('../models');

async function logAssetActivity(assetId, userId, action, detail = null) {
  return AssetActivity.create({ assetId, userId: userId || null, action, detail });
}

module.exports = { logAssetActivity };
