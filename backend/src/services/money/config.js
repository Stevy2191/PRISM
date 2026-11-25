// Money settings (Phase 3): SystemSettings rows, defaults here (the
// oauth/config.js pattern). Written only through /money/settings and
// /money/rates, which check what each needs.
const { SystemSettings } = require('../../models');
const { cents, unit } = require('./money');

// Microsoft 365 frontline licenses (F3, F1, Office 365 F3) by skuId: a
// contact holding one defaults to the Light support tier. Verify against
// Microsoft's "Product names and service plan identifiers for licensing".
const FRONTLINE_SKU_IDS = [
  '66b55226-6b4f-492c-910c-a3b7a3c9d993',
  '50f60901-3181-4b75-8a2c-4c8e4c1d5a72',
  '4b585984-651b-448a-9e53-3b10f069cf7f',
];

const DEFAULTS = {
  'money.customerBilling': 'false',
  'money.currency': 'USD',
  'money.hourlyRate': '0',
  'money.afterHoursRate': '0',
  'money.tripCharge': '0',
  'money.eventMinimumMinutes': '60',
  'money.stepMinutes': '30',
  'money.defaultMarkupPercent': '0',
  'money.defaultTermsDays': '30',
  'money.frontlineSkuIds': FRONTLINE_SKU_IDS.join(','),
};

async function rawValues() {
  const rows = await SystemSettings.findAll({ where: { key: Object.keys(DEFAULTS) } });
  const values = { ...DEFAULTS };
  rows.forEach((r) => { values[r.key] = r.value; });
  return values;
}

async function moneyConfig() {
  const v = await rawValues();
  return {
    customerBilling: v['money.customerBilling'] === 'true',
    currency: v['money.currency'],
    hourlyRate: cents(v['money.hourlyRate']),
    afterHoursRate: cents(v['money.afterHoursRate']),
    tripCharge: cents(v['money.tripCharge']),
    eventMinimumMinutes: Number(v['money.eventMinimumMinutes']),
    stepMinutes: Number(v['money.stepMinutes']),
    defaultMarkupPercent: unit(v['money.defaultMarkupPercent']),
    defaultTermsDays: Number(v['money.defaultTermsDays']),
    frontlineSkuIds: String(v['money.frontlineSkuIds']).split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

async function saveValues(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown money setting ${key}`);
    // eslint-disable-next-line no-await-in-loop
    await SystemSettings.upsert({ key, value: String(value) });
  }
}

module.exports = {
  DEFAULTS, FRONTLINE_SKU_IDS, moneyConfig, saveValues,
};
