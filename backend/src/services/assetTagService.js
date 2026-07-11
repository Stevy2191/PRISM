// Asset tag suggestion — "PC-0001" style. Unlike project codes
// (projectCodeService.js), asset tags don't need a persistent atomic
// counter: the admin can freely override the suggestion, so a small gap in
// the sequence (from an overridden or deleted tag) is fine. The suggestion
// is derived fresh each time from the highest existing tag with that
// prefix, same "Pattern B" approach projectCodeService.js uses for
// renumberable task/subtask codes.
const { Op } = require('sequelize');
const { Asset } = require('../models');

// Fixed mapping per the spec — the 6 seeded AssetCategories. Categories
// aren't user-creatable in this build (no POST /assets/categories), so this
// covers every real case; the fallback below only matters if a category is
// ever added directly in the database outside this mapping.
const CATEGORY_PREFIX = {
  Computers: 'PC',
  'Network Equipment': 'NET',
  Servers: 'SRV',
  Printers: 'PRT',
  'Mobile Devices': 'MOB',
  Other: 'AST',
};

function prefixForCategory(category) {
  if (!category) return 'AST';
  return CATEGORY_PREFIX[category.name] || category.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'AST';
}

async function suggestNextAssetTag(category) {
  const prefix = prefixForCategory(category);
  const existing = await Asset.findAll({
    where: { assetTag: { [Op.like]: `${prefix}-%` } },
    attributes: ['assetTag'],
    raw: true,
  });
  let maxSeq = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  existing.forEach((row) => {
    const match = re.exec(row.assetTag);
    if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
  });
  const next = maxSeq + 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

module.exports = { CATEGORY_PREFIX, prefixForCategory, suggestNextAssetTag };
