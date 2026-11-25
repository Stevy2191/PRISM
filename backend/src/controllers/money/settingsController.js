// Money settings (Phase 3, step 1). GET /money/config tells any staff member
// whether customer billing is on and the currency; everything else needs
// money.settings (and the switch itself an Owner) or money.rates.manage.
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { assertOwner } = require('../../services/ownership');
const { moneyConfig, saveValues } = require('../../services/money/config');

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

// A money amount: a non-negative number with at most 2 decimals.
function amount(raw, label) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be an amount like 100 or 99.50`);
  return s;
}
function wholeMinutes(raw, label, min, max) {
  if (!Number.isInteger(raw) || raw < min || raw > max) throw bad(`${label} must be a whole number of minutes from ${min} to ${max}`);
  return raw;
}

// GET /money/config
const config = asyncHandler(async (req, res) => {
  const cfg = await moneyConfig();
  res.json({ customerBilling: cfg.customerBilling, currency: cfg.currency });
});

// GET /money/settings
const get = asyncHandler(async (req, res) => {
  res.json({ settings: await moneyConfig() });
});

// PUT /money/settings { customerBilling?, currency?, defaultMarkupPercent?, defaultTermsDays?, frontlineSkuIds? }
const update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const values = {};
  if (body.customerBilling !== undefined) {
    if (typeof body.customerBilling !== 'boolean') throw bad('Customer billing must be true or false');
    await assertOwner(req.user, 'Turning customer billing on or off');
    values['money.customerBilling'] = String(body.customerBilling);
  }
  if (body.currency !== undefined) {
    const currency = String(body.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw bad('Currency must be a three-letter code like USD');
    values['money.currency'] = currency;
  }
  if (body.defaultMarkupPercent !== undefined) {
    const s = String(body.defaultMarkupPercent).trim();
    if (!/^\d{1,4}(\.\d{1,4})?$/.test(s)) throw bad('Default markup must be a percentage of 0 or more');
    values['money.defaultMarkupPercent'] = s;
  }
  if (body.defaultTermsDays !== undefined) {
    if (!Number.isInteger(body.defaultTermsDays) || body.defaultTermsDays < 0 || body.defaultTermsDays > 365) throw bad('Payment terms must be 0 to 365 days');
    values['money.defaultTermsDays'] = String(body.defaultTermsDays);
  }
  if (body.frontlineSkuIds !== undefined) {
    const ids = (Array.isArray(body.frontlineSkuIds) ? body.frontlineSkuIds : String(body.frontlineSkuIds).split(/[\s,]+/))
      .map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    if (ids.length > 50 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) {
      throw bad('Frontline licenses must be Microsoft license (SKU) IDs');
    }
    values['money.frontlineSkuIds'] = ids.join(',');
  }
  await saveValues(values);
  await writeAudit(req, 'money.settings', 'SystemSettings', null, values);
  res.json({ settings: await moneyConfig() });
});

// GET /money/rates
const getRates = asyncHandler(async (req, res) => {
  const cfg = await moneyConfig();
  res.json({
    rates: {
      hourlyRate: cfg.hourlyRate, afterHoursRate: cfg.afterHoursRate, tripCharge: cfg.tripCharge, eventMinimumMinutes: cfg.eventMinimumMinutes, stepMinutes: cfg.stepMinutes,
    },
  });
});

// PUT /money/rates { hourlyRate?, afterHoursRate?, tripCharge?, eventMinimumMinutes?, stepMinutes? }
const rates = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const values = {};
  if (body.hourlyRate !== undefined) values['money.hourlyRate'] = amount(body.hourlyRate, 'The hourly rate');
  if (body.afterHoursRate !== undefined) values['money.afterHoursRate'] = amount(body.afterHoursRate, 'The after-hours rate');
  if (body.tripCharge !== undefined) values['money.tripCharge'] = amount(body.tripCharge, 'The trip charge');
  if (body.eventMinimumMinutes !== undefined) values['money.eventMinimumMinutes'] = String(wholeMinutes(body.eventMinimumMinutes, 'The minimum', 0, 480));
  if (body.stepMinutes !== undefined) values['money.stepMinutes'] = String(wholeMinutes(body.stepMinutes, 'The step', 1, 240));
  await saveValues(values);
  await writeAudit(req, 'money.rates', 'SystemSettings', null, values);
  const cfg = await moneyConfig();
  res.json({
    rates: {
      hourlyRate: cfg.hourlyRate, afterHoursRate: cfg.afterHoursRate, tripCharge: cfg.tripCharge, eventMinimumMinutes: cfg.eventMinimumMinutes, stepMinutes: cfg.stepMinutes,
    },
  });
});

module.exports = {
  config, get, update, rates, getRates,
};
