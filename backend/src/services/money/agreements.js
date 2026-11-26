// Agreements (Phase 3, step 3): what a recurring customer pays each month.
// Each line counts something this month — people by support tier, devices by
// asset category, licenses from the customer's Microsoft 365 tenant (or a
// typed count) — times its price. Flat fees and prepaid hour blocks count 1.
const { Op } = require('sequelize');
const {
  Agreement, AgreementLine, Asset, AssetCategory, CatalogProduct, Company, SlaPolicy, TaxCategory, sequelize,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { parseRecordId } = require('../permissionService');
const { D, cents, unit } = require('./money');
const { tierCounts } = require('./tiers');
const graph = require('../microsoft365/graph');

const KINDS = ['flat', 'per_user', 'per_device', 'license', 'prepaid_hours'];
// Devices in service: what's retired, lost, or on the shelf isn't billed.
const IN_SERVICE = ['active', 'in_repair', 'on_hold'];
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const notFound = () => new ApiError(404, 'Agreement not found', 'NOT_FOUND');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function text(raw, label, max, required = false) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s || null;
}
// A non-negative amount with up to `places` decimals, as a string.
function money(raw, label, places, { positive = false } = {}) {
  const s = String(raw ?? '').trim();
  const re = places === 4 ? /^\d{1,8}(\.\d{1,4})?$/ : /^\d{1,9}(\.\d{1,2})?$/;
  if (!re.test(s) || (positive && D(s).isZero())) throw bad(`${label} must be ${positive ? 'over 0' : '0 or more'}, like 95 or 12.50`);
  return places === 4 ? unit(s) : cents(s);
}
async function exists(Model, raw, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = parseRecordId(raw);
  if (!id || !(await Model.count({ where: { id } }))) throw bad(`${label} not found`);
  return id;
}

async function readLines(rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('An agreement needs at least one line');
  if (rawLines.length > 100) throw bad('An agreement can have at most 100 lines');
  const out = [];
  for (const [i, l] of rawLines.entries()) {
    const n = `Line ${i + 1}`;
    if (!KINDS.includes(l.kind)) throw bad(`${n}: choose flat, per user, per device, license or prepaid hours`);
    const line = {
      kind: l.kind,
      description: text(l.description, `${n}'s description`, 500, true),
      unitPrice: money(l.unitPrice, `${n}'s price`, 4),
      tier: null,
      assetCategoryId: null,
      skuId: null,
      countSource: null,
      manualCount: null,
      hours: null,
      rollover: false,
      overageRate: null,
      /* eslint-disable no-await-in-loop */
      catalogProductId: await exists(CatalogProduct, l.catalogProductId, `${n}'s product`),
      taxCategoryId: await exists(TaxCategory, l.taxCategoryId, `${n}'s tax category`),
      sortOrder: i,
    };
    if (l.kind === 'per_user') {
      if (!['full', 'light'].includes(l.tier)) throw bad(`${n}: choose Full or Light users`);
      line.tier = l.tier;
    }
    if (l.kind === 'per_device') {
      line.assetCategoryId = await exists(AssetCategory, l.assetCategoryId, `${n}'s device type`);
      if (!line.assetCategoryId) throw bad(`${n}: choose a device type`);
    }
    /* eslint-enable no-await-in-loop */
    if (l.kind === 'license') {
      line.countSource = l.countSource === 'm365' ? 'm365' : 'manual';
      line.skuId = text(l.skuId, `${n}'s license`, 64);
      if (line.skuId) line.skuId = line.skuId.toLowerCase();
      if (line.countSource === 'm365' && !line.skuId) throw bad(`${n}: choose the Microsoft 365 license to count`);
      const typed = l.manualCount === undefined || l.manualCount === null || l.manualCount === '' ? null : l.manualCount;
      if (line.countSource === 'manual' && typed === null) throw bad(`${n}: enter how many licenses`);
      line.manualCount = typed === null ? null : money(typed, `${n}'s count`, 4);
    }
    if (l.kind === 'prepaid_hours') {
      if (l.hours === undefined || l.hours === null || l.hours === '') throw bad(`${n}: enter the hours in the block`);
      line.hours = money(l.hours, `${n}'s hours`, 2, { positive: true });
      line.rollover = l.rollover === true;
      line.overageRate = l.overageRate === undefined || l.overageRate === null || l.overageRate === '' ? null : money(l.overageRate, `${n}'s overage rate`, 2);
    }
    out.push(line);
  }
  return out;
}

async function readHeader(body, current = null) {
  const h = {};
  if (!current || body.name !== undefined) h.name = text(body.name, 'Name', 200, true);
  if (!current || body.startsOn !== undefined) {
    if (!isDate(body.startsOn)) throw bad('Choose the start date');
    h.startsOn = body.startsOn;
  }
  if (body.endsOn !== undefined) {
    if (body.endsOn !== null && body.endsOn !== '' && !isDate(body.endsOn)) throw bad('The end date is not a date');
    h.endsOn = body.endsOn || null;
  }
  const startsOn = h.startsOn || (current && current.startsOn);
  if (h.endsOn && h.endsOn < startsOn) throw bad('The end date is before the start');
  if (body.slaPolicyId !== undefined) h.slaPolicyId = await exists(SlaPolicy, body.slaPolicyId, 'SLA');
  if (body.termsDays !== undefined) {
    if (body.termsDays === null || body.termsDays === '') h.termsDays = null;
    else if (!Number.isInteger(body.termsDays) || body.termsDays < 0 || body.termsDays > 365) throw bad('Terms must be 0 to 365 days');
    else h.termsDays = body.termsDays;
  }
  if (body.notes !== undefined) h.notes = text(body.notes, 'Notes', 5000);
  return h;
}

async function load(id, options = {}) {
  return Agreement.findByPk(id, {
    include: [{ model: AgreementLine, as: 'lines' }],
    order: [[{ model: AgreementLine, as: 'lines' }, 'sortOrder', 'ASC'], [{ model: AgreementLine, as: 'lines' }, 'id', 'ASC']],
    ...options,
  });
}

// One active agreement per company: the company row is locked while checking.
async function assertNoOtherActive(companyId, transaction, exceptId = null) {
  await Company.findByPk(companyId, { transaction, lock: transaction.LOCK.UPDATE });
  const where = { companyId, status: 'active', ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) };
  if (await Agreement.count({ where, transaction })) {
    throw new ApiError(409, 'This customer already has an active agreement. Change it, or cancel it first.', 'AGREEMENT_EXISTS');
  }
}

async function createAgreement(company, body, user) {
  if (!company.isClient && !company.isInternal) throw bad('Agreements are for customers');
  const header = await readHeader(body);
  const lines = await readLines(body.lines);
  const id = await sequelize.transaction(async (transaction) => {
    await assertNoOtherActive(company.id, transaction);
    const agreement = await Agreement.create({ ...header, companyId: company.id, createdBy: user ? user.id : null }, { transaction });
    await AgreementLine.bulkCreate(lines.map((l) => ({ ...l, agreementId: agreement.id })), { transaction });
    return agreement.id;
  });
  return load(id);
}

async function updateAgreement(agreement, body) {
  if (agreement.status !== 'active') throw new ApiError(409, 'A cancelled agreement can\'t be changed', 'AGREEMENT_CANCELLED');
  const header = await readHeader(body, agreement);
  const lines = body.lines !== undefined ? await readLines(body.lines) : null;
  await sequelize.transaction(async (transaction) => {
    await agreement.update(header, { transaction });
    if (lines) {
      // Lines replaced whole; a line kept by id keeps what was billed so far.
      const old = new Map((await AgreementLine.findAll({ where: { agreementId: agreement.id }, transaction })).map((l) => [l.id, l]));
      const keep = new Set();
      for (const [i, l] of lines.entries()) {
        const prior = old.get(parseRecordId(body.lines[i].id));
        if (prior && prior.kind === l.kind) {
          keep.add(prior.id);
          await prior.update(l, { transaction }); // eslint-disable-line no-await-in-loop
        } else {
          await AgreementLine.create({ ...l, agreementId: agreement.id }, { transaction }); // eslint-disable-line no-await-in-loop
        }
      }
      const gone = [...old.keys()].filter((id) => !keep.has(id));
      if (gone.length) await AgreementLine.destroy({ where: { id: gone }, transaction });
    }
  });
  return load(agreement.id);
}

async function cancelAgreement(agreement, { cancelledOn }) {
  if (!isDate(cancelledOn)) throw bad('Choose the last day of the agreement');
  if (cancelledOn < agreement.startsOn) throw bad('The last day is before the start');
  const [n] = await Agreement.update(
    { status: 'cancelled', cancelledOn, endsOn: cancelledOn },
    { where: { id: agreement.id, status: 'active' } },
  );
  if (!n) throw new ApiError(409, 'This agreement is already cancelled', 'AGREEMENT_CANCELLED');
  return load(agreement.id);
}

// The company's agreement in force on a date, or null.
async function activeAgreement(companyId, onDate) {
  const rows = await Agreement.findAll({
    where: { companyId, startsOn: { [Op.lte]: onDate } },
    include: [{ model: AgreementLine, as: 'lines' }],
    order: [['startsOn', 'DESC'], ['id', 'DESC']],
  });
  return rows.find((a) => !a.endsOn || a.endsOn >= onDate) || null;
}

// ctx memoizes per-company lookups across lines: { tiers, skus }.
async function m365Count(line, company, ctx) {
  if (!company.msTenantId || !company.msConsentAt) return null;
  if (!('skus' in ctx)) {
    try {
      ctx.skus = await graph.subscribedSkus(company.msTenantId);
    } catch {
      ctx.skus = null;
    }
  }
  if (!ctx.skus) return null;
  const sku = ctx.skus.find((s) => s.skuId === line.skuId);
  return sku ? String(sku.consumedUnits) : '0';
}

// → { quantity: '12.0000', source: 'tiers'|'assets'|'m365'|'manual'|'fixed' }
async function quantityFor(line, agreement, ctx = {}) {
  const { companyId } = agreement;
  if (line.kind === 'per_user') {
    if (!ctx.tiers) ctx.tiers = await tierCounts(companyId);
    return { quantity: unit(ctx.tiers[line.tier] || 0), source: 'tiers' };
  }
  if (line.kind === 'per_device') {
    const n = await Asset.count({ where: { companyId, categoryId: line.assetCategoryId, status: IN_SERVICE } });
    return { quantity: unit(n), source: 'assets' };
  }
  if (line.kind === 'license') {
    if (line.countSource === 'm365') {
      if (!ctx.company) ctx.company = await Company.findByPk(companyId, { attributes: ['id', 'msTenantId', 'msConsentAt'] });
      const n = await m365Count(line, ctx.company, ctx);
      if (n !== null) return { quantity: unit(n), source: 'm365' };
    }
    return { quantity: unit(line.manualCount || 0), source: 'manual' };
  }
  return { quantity: unit(1), source: 'fixed' };
}

async function preview(agreement) {
  const ctx = {};
  const lines = [];
  for (const line of agreement.lines) {
    const { quantity, source } = await quantityFor(line, agreement, ctx); // eslint-disable-line no-await-in-loop
    lines.push({
      id: line.id, kind: line.kind, description: line.description, quantity, source, unitPrice: unit(line.unitPrice), amount: cents(D(quantity).times(line.unitPrice)),
    });
  }
  return { lines, total: cents(lines.reduce((s, l) => s.plus(l.amount), D(0))) };
}

const opt = (v, fn) => (v === null || v === undefined ? null : fn(v));
function lineJson(l) {
  return {
    id: l.id,
    kind: l.kind,
    description: l.description,
    unitPrice: unit(l.unitPrice),
    tier: l.tier,
    assetCategoryId: l.assetCategoryId,
    catalogProductId: l.catalogProductId,
    skuId: l.skuId,
    countSource: l.countSource,
    manualCount: opt(l.manualCount, unit),
    hours: opt(l.hours, cents),
    rollover: l.rollover,
    overageRate: opt(l.overageRate, cents),
    hoursBalanceMinutes: l.hoursBalanceMinutes,
    lastBilledQuantity: opt(l.lastBilledQuantity, unit),
    taxCategoryId: l.taxCategoryId,
  };
}
function agreementJson(a) {
  return {
    id: a.id,
    companyId: a.companyId,
    name: a.name,
    slaPolicyId: a.slaPolicyId,
    startsOn: a.startsOn,
    endsOn: a.endsOn,
    status: a.status,
    cancelledOn: a.cancelledOn,
    termsDays: a.termsDays,
    notes: a.notes,
    lines: (a.lines || []).map(lineJson),
    createdAt: a.createdAt,
  };
}

module.exports = {
  KINDS, load, createAgreement, updateAgreement, cancelAgreement, activeAgreement, quantityFor, preview, agreementJson,
};
