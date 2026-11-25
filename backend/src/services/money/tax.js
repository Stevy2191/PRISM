// Tax (Phase 3, step 1): each line's tax is its amount × its category's
// taxable share × the customer's rate, rounded to cents per line, then
// summed. An exempt customer (while the certificate is current) or one whose
// tax is switched off pays none.
const { CompanyBilling, TaxRate } = require('../../models');
const { moneyConfig } = require('./config');
const {
  D, cents, unit, sum, percent,
} = require('./money');

async function defaultRate() {
  return TaxRate.findOne({ where: { isDefault: true, active: true } });
}

// A customer's billing settings with every default filled in.
async function customerBilling(companyId) {
  const [row, cfg] = await Promise.all([
    CompanyBilling.findByPk(companyId, { include: [{ model: TaxRate, as: 'taxRate' }] }),
    moneyConfig(),
  ]);
  const rate = row && row.taxRate && row.taxRate.active ? row.taxRate : await defaultRate();
  const pick = (value, fallback) => (value === null || value === undefined ? fallback : value);
  return {
    companyId,
    chargeTax: row ? row.chargeTax : true,
    taxExempt: row ? row.taxExempt : false,
    exemptExpiresOn: row ? row.exemptExpiresOn : null,
    exemptCertificateName: row ? row.exemptCertificateName : null,
    taxRateId: row ? row.taxRateId : null,
    taxRateName: rate ? rate.name : null,
    taxRatePercent: unit(rate ? rate.ratePercent : '0'),
    termsDays: pick(row && row.termsDays, cfg.defaultTermsDays),
    invoiceTiming: row ? row.invoiceTiming : 'monthly',
    hourlyRate: cents(pick(row && row.hourlyRate, cfg.hourlyRate)),
    afterHoursRate: cents(pick(row && row.afterHoursRate, cfg.afterHoursRate)),
    tripCharge: cents(pick(row && row.tripCharge, cfg.tripCharge)),
    // Which values are the customer's own (the rest are defaults).
    overrides: {
      taxRate: !!(row && row.taxRateId),
      termsDays: !!(row && row.termsDays !== null),
      hourlyRate: !!(row && row.hourlyRate !== null),
      afterHoursRate: !!(row && row.afterHoursRate !== null),
      tripCharge: !!(row && row.tripCharge !== null),
    },
  };
}

// Exempt on `date` (YYYY-MM-DD): exempt, and no expiry or not yet past it.
function isExemptOn(billing, date) {
  if (!billing.taxExempt) return false;
  if (!billing.exemptExpiresOn) return true;
  return String(date) <= String(billing.exemptExpiresOn);
}

// lines: [{ amount, taxCategoryId }]; categories: the TaxCategory rows the
// lines use. A line without a tax category, or with one not given, throws:
// a missed lookup must never undercharge tax.
// → { lines: [{ taxable, tax }], taxTotal } (strings, cents).
function taxForLines(lines, billing, { categories = [], onDate = null } = {}) {
  const shareOf = new Map(categories.map((c) => [c.id, c.taxablePercent]));
  const today = onDate || new Date().toISOString().slice(0, 10);
  const none = !billing.chargeTax || isExemptOn(billing, today);
  const out = lines.map((l) => {
    // Never silently untaxed: every line names a tax category the caller loaded.
    if (l.taxCategoryId == null || !shareOf.has(l.taxCategoryId)) {
      throw new Error(`Every charged line needs a known tax category (got ${l.taxCategoryId == null ? 'none' : l.taxCategoryId})`);
    }
    const share = shareOf.get(l.taxCategoryId);
    const taxable = D(cents(percent(l.amount, share)));
    const tax = none ? D(0) : D(cents(percent(taxable, billing.taxRatePercent)));
    return { taxable: cents(none ? 0 : taxable), tax: cents(tax) };
  });
  return { lines: out, taxTotal: cents(sum(out.map((l) => l.tax))) };
}

module.exports = {
  customerBilling, isExemptOn, taxForLines, defaultRate,
};
