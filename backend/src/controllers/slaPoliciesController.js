const { Op } = require('sequelize');
const {
  SlaPolicy, SlaTarget, BusinessHours, Company, TicketSla, sequelize,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const slaCalendar = require('../services/sla/calendar');
const { recalcTicketSla } = require('../services/sla/ticketSla');

// SLA policies (sub-project 4): a name, a business-hours schedule (null =
// 24x7), a warning point and per-priority targets for the assign, response
// and resolution clocks. One policy is the default; companies are put on a
// policy here, not on the company form, so it takes system settings
// permission (see routes/slaPolicies.js).

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const TICKET_TYPES = ['incident', 'request', 'problem', 'change', 'task'];
const CLOCKS = ['assign', 'response', 'resolution'];
const UNITS = ['minutes', 'business_days'];
const MAX = { minutes: 365 * 24 * 60, business_days: 365 };
const keyOf = (type, priority) => `${type}:${priority}`;
const NAME_MAX = 100;

const include = [
  { model: SlaTarget, as: 'targets' },
  { model: BusinessHours, as: 'businessHours', attributes: ['id', 'name'] },
  { model: Company, as: 'companies', attributes: ['id', 'name'] },
];

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

function present(policy) {
  const json = policy.toJSON();
  const byKey = new Map((json.targets || []).map((t) => [keyOf(t.ticketType, t.priority), t]));
  json.targets = TICKET_TYPES.flatMap((type) => PRIORITIES.map((p) => byKey.get(keyOf(type, p)))).filter(Boolean);
  json.companies = (json.companies || []).sort((a, b) => a.name.localeCompare(b.name));
  return json;
}

async function load(id, options = {}) {
  const policyId = parseRecordId(id);
  const policy = policyId && await SlaPolicy.findByPk(policyId, { include, ...options });
  if (!policy) throw new ApiError(404, 'SLA policy not found', 'NOT_FOUND');
  return policy;
}

function readAmount(value, unit) {
  if (value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX[unit]) {
    throw bad(unit === 'business_days'
      ? `Each target in days must be a whole number between 1 and ${MAX.business_days}`
      : `Each target must be a whole number of minutes between 1 and ${MAX.minutes}`);
  }
  return value;
}

// Body → { fields, targets: Map<priority, changes>, companyIds|undefined }.
async function readBody(body, existing) {
  const fields = {};
  if (body.name !== undefined || !existing) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw bad('Policy name is required');
    if (name.length > NAME_MAX) throw bad(`Policy name must be ${NAME_MAX} characters or fewer`);
    const clash = await SlaPolicy.findOne({ where: { name, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
    if (clash) throw new ApiError(409, 'Another SLA policy already has this name', 'DUPLICATE_NAME');
    fields.name = name;
  }
  if (body.warnAtPercent !== undefined) {
    if (!Number.isInteger(body.warnAtPercent) || body.warnAtPercent < 1 || body.warnAtPercent > 99) {
      throw bad('Warning point must be a whole percentage between 1 and 99');
    }
    fields.warnAtPercent = body.warnAtPercent;
  }
  if (body.businessHoursId !== undefined) {
    if (body.businessHoursId === null || body.businessHoursId === '') {
      fields.businessHoursId = null;
    } else {
      const id = parseRecordId(body.businessHoursId);
      if (!id || !(await BusinessHours.findByPk(id))) throw bad('Business hours schedule not found');
      fields.businessHoursId = id;
    }
  }

  // Map<'type:priority', changes>
  const targets = new Map();
  if (body.targets !== undefined) {
    if (!Array.isArray(body.targets)) throw bad('Targets must be a list');
    body.targets.forEach((t) => {
      if (!t || !TICKET_TYPES.includes(t.ticketType)) throw bad('Each target needs a ticket type of incident, request, problem, change or task');
      if (!PRIORITIES.includes(t.priority)) throw bad('Each target needs a priority of critical, high, medium or low');
      const key = keyOf(t.ticketType, t.priority);
      if (targets.has(key)) throw bad('Each ticket type and priority may appear once');
      const changes = {};
      CLOCKS.forEach((c) => {
        const unitKey = `${c}Unit`;
        if (t[unitKey] !== undefined) {
          if (!UNITS.includes(t[unitKey])) throw bad('A target unit must be minutes or business_days');
          changes[unitKey] = t[unitKey];
        }
        const amountKey = `${c}Minutes`;
        if (t[amountKey] !== undefined) changes[amountKey] = readAmount(t[amountKey], changes[unitKey] || t[unitKey] || 'minutes');
      });
      if (t.useBusinessHours !== undefined) changes.useBusinessHours = !!t.useBusinessHours;
      targets.set(key, { ticketType: t.ticketType, priority: t.priority, changes });
    });
  }

  let companyIds;
  if (body.companyIds !== undefined) {
    if (!Array.isArray(body.companyIds)) throw bad('Companies must be a list');
    companyIds = [...new Set(body.companyIds.map((v) => {
      const id = parseRecordId(v);
      if (!id) throw bad('Company not found');
      return id;
    }))];
    if (companyIds.length && (await Company.count({ where: { id: companyIds } })) !== companyIds.length) {
      throw bad('Company not found');
    }
  }
  return { fields, targets, companyIds };
}

// A new policy gets all 20 type × priority rows (untracked unless given);
// an edit changes only the rows named.
async function saveTargets(policyId, targets, isNew, transaction) {
  // eslint-disable-next-line no-restricted-syntax
  for (const ticketType of TICKET_TYPES) {
    // eslint-disable-next-line no-restricted-syntax
    for (const priority of PRIORITIES) {
      const entry = targets.get(keyOf(ticketType, priority));
      if (isNew) {
        // eslint-disable-next-line no-await-in-loop
        await SlaTarget.create({
          slaPolicyId: policyId, ticketType, priority, assignMinutes: null, responseMinutes: null, resolutionMinutes: null, useBusinessHours: true, ...(entry ? entry.changes : {}),
        }, { transaction });
      } else if (entry) {
        // eslint-disable-next-line no-await-in-loop
        const row = await SlaTarget.findOne({ where: { slaPolicyId: policyId, ticketType, priority }, transaction });
        // A unit or an amount sent alone must still fit the other, stored half.
        CLOCKS.forEach((c) => {
          const unit = entry.changes[`${c}Unit`] || (row && row[`${c}Unit`]) || 'minutes';
          const amount = entry.changes[`${c}Minutes`] !== undefined ? entry.changes[`${c}Minutes`] : row && row[`${c}Minutes`];
          if (amount !== null && amount !== undefined) readAmount(amount, unit);
        });
        // eslint-disable-next-line no-await-in-loop
        await SlaTarget.update(entry.changes, { where: { slaPolicyId: policyId, ticketType, priority }, transaction });
      }
    }
  }
}

// One policy per company: listing a company here takes it off any other.
async function saveCompanies(policyId, companyIds, transaction) {
  if (companyIds === undefined) return;
  await Company.update({ slaPolicyId: null }, {
    where: { slaPolicyId: policyId, ...(companyIds.length ? { id: { [Op.notIn]: companyIds } } : {}) },
    transaction,
  });
  if (companyIds.length) await Company.update({ slaPolicyId: policyId }, { where: { id: companyIds }, transaction });
}

const list = asyncHandler(async (req, res) => {
  const policies = await SlaPolicy.findAll({ include, order: [['isDefault', 'DESC'], ['name', 'ASC']] });
  res.json({ policies: policies.map(present) });
});

const get = asyncHandler(async (req, res) => {
  res.json({ policy: present(await load(req.params.id)) });
});

const create = asyncHandler(async (req, res) => {
  const { fields, targets, companyIds } = await readBody(req.body || {}, null);
  const policy = await sequelize.transaction(async (transaction) => {
    const p = await SlaPolicy.create({ ...fields, isDefault: false }, { transaction });
    await saveTargets(p.id, targets, true, transaction);
    await saveCompanies(p.id, companyIds, transaction);
    return p;
  });
  slaCalendar.invalidate();
  await writeAudit(req, 'slaPolicy.create', 'SlaPolicy', policy.id, { name: policy.name, companyIds });
  res.status(201).json({ policy: present(await load(policy.id)) });
});

const update = asyncHandler(async (req, res) => {
  const policy = await load(req.params.id);
  const { fields, targets, companyIds } = await readBody(req.body || {}, policy);
  await sequelize.transaction(async (transaction) => {
    await policy.update(fields, { transaction });
    await saveTargets(policy.id, targets, false, transaction);
    await saveCompanies(policy.id, companyIds, transaction);
  });
  slaCalendar.invalidate();
  await writeAudit(req, 'slaPolicy.update', 'SlaPolicy', policy.id, {
    ...fields, targets: Object.fromEntries([...targets].map(([k, v]) => [k, v.changes])), companyIds,
  });
  res.json({ policy: present(await load(policy.id)) });
});

const setDefault = asyncHandler(async (req, res) => {
  const policy = await load(req.params.id);
  await sequelize.transaction(async (transaction) => {
    await SlaPolicy.update({ isDefault: false }, { where: { isDefault: true }, transaction });
    await policy.update({ isDefault: true }, { transaction });
  });
  slaCalendar.invalidate();
  await writeAudit(req, 'slaPolicy.setDefault', 'SlaPolicy', policy.id, { name: policy.name });
  res.json({ policy: present(await load(policy.id)) });
});

// Its companies fall back to the default; tickets on it move to the default
// and are re-timed against the default's targets.
const remove = asyncHandler(async (req, res) => {
  const policy = await load(req.params.id);
  if (policy.isDefault) throw new ApiError(409, 'The default SLA policy cannot be deleted. Make another policy the default first.', 'DEFAULT_POLICY');
  const fallback = await SlaPolicy.findOne({ where: { isDefault: true } });
  const ticketIds = (await TicketSla.findAll({ where: { slaPolicyId: policy.id }, attributes: ['ticketId'] })).map((r) => r.ticketId);
  await sequelize.transaction(async (transaction) => {
    await Company.update({ slaPolicyId: null }, { where: { slaPolicyId: policy.id }, transaction });
    await TicketSla.update({ slaPolicyId: fallback.id }, { where: { slaPolicyId: policy.id }, transaction, hooks: false });
    await policy.destroy({ transaction });
  });
  slaCalendar.invalidate();
  // eslint-disable-next-line no-restricted-syntax
  for (const ticketId of ticketIds) await recalcTicketSla(ticketId, { policyId: fallback.id }); // eslint-disable-line no-await-in-loop
  await writeAudit(req, 'slaPolicy.delete', 'SlaPolicy', policy.id, { name: policy.name, movedTickets: ticketIds.length });
  res.json({ ok: true });
});

module.exports = {
  list, get, create, update, setDefault, remove,
};
