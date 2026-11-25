// Products and services (Phase 3, step 1): what one usage unit costs and
// what it sells for.
const { D, unit } = require('./money');

// Cost of one usage unit: the purchase cost ÷ usage units per purchase
// (a $180 box of 1,000 ft → $0.1800 per ft). null when there's no cost.
function usageCost(product) {
  if (product.cost === null || product.cost === undefined) return null;
  return unit(D(product.cost).div(D(product.usagePerPurchase || 1)));
}

// Price of one usage unit: its own price; else cost plus markup (its own, or
// the default — 0 % unless set); else 0.
function unitPrice(product, cfg) {
  if (product.price !== null && product.price !== undefined) return unit(product.price);
  const cost = usageCost(product);
  if (cost === null) return unit(0);
  const markup = product.markupPercent !== null && product.markupPercent !== undefined ? product.markupPercent : cfg.defaultMarkupPercent;
  return unit(D(cost).times(D(100).plus(D(markup))).div(100));
}

module.exports = { usageCost, unitPrice };
