// What applies to a company (CS part 4), on its page under Setup:
//   GET /companies/:id/applies                    the lists below
//   PUT /companies/:id/bundles/:playbookId        { offered }  (Checklists permission)
//
// Checklist bundles are turned on or off for the company here. Workflow
// rules, recurring tickets and custom fields are built in Settings, because
// one can serve many companies; this shows which reach the company, each
// with where it is edited.
const {
  Playbook, WorkflowRule, WorkflowCondition, RecurringTicket, CustomField, Contact, Department,
} = require('../models');
const { asyncHandler, ApiError } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { hasPermission } = require('../services/permissionService');
const { loadAccessibleCompany } = require('./companiesController');
const { offeredFor } = require('../services/playbooks/resolve');
const { loadTree } = require('../services/tickets/categories');
const { pathOf } = require('../services/tickets/categoryTree');

const ids = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
const DEPARTMENT_FIELDS = ['department', 'contact_department'];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function scheduleText(r) {
  const every = (unit) => (r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`);
  if (r.frequency === 'daily') return `${every('day')} at ${r.timeOfDay}`;
  if (r.frequency === 'weekly') {
    const days = ids(r.weekdays).map((d) => DAYS[d % 7]).filter(Boolean).join(', ');
    return `${every('week')}${days ? ` on ${days}` : ''} at ${r.timeOfDay}`;
  }
  if (r.frequency === 'monthly') return `${every('month')}${r.dayOfMonth ? ` on day ${r.dayOfMonth}` : ''} at ${r.timeOfDay}`;
  return `${every('year')} at ${r.timeOfDay}`;
}

async function bundles(company, tree) {
  const all = await Playbook.findAll({ where: { isActive: true }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const mine = new Set([...tree.values()].filter((n) => n.companyId === company.id).map((n) => n.id));
  return all.map((p) => ({
    id: p.id,
    name: p.name,
    offered: offeredFor(p, company.id),
    // Offered to chosen companies, and this is not one of them.
    forOthers: Array.isArray(p.companyIds) && !ids(p.companyIds).includes(company.id),
    suggestedOn: ids(p.suggestCategoryIds).filter((cid) => mine.has(cid)).map((cid) => pathOf(tree, cid).map((n) => n.name).join(' › ')),
  }));
}

async function rules(company) {
  const departments = await Department.findAll({ attributes: ['id', 'name', 'companyId'] });
  const byId = new Map(departments.map((d) => [d.id, d]));
  const all = await WorkflowRule.findAll({
    include: [{ model: WorkflowCondition, as: 'conditions', required: false }],
    order: [['position', 'ASC'], ['id', 'ASC']],
  });
  const named = [];
  let forAll = 0;
  for (const rule of all) {
    const deptConditions = (rule.conditions || []).filter((c) => DEPARTMENT_FIELDS.includes(c.field));
    if (!deptConditions.length) { forAll += 1; continue; } // eslint-disable-line no-continue
    // A department condition names one by id (older ones by name).
    const hits = deptConditions.map((c) => {
      const v = String(c.value ?? '').trim();
      if (/^\d+$/.test(v)) return byId.get(Number(v));
      return departments.find((d) => d.name.toLowerCase() === v.toLowerCase() && d.companyId === company.id);
    }).filter((d) => d && d.companyId === company.id);
    if (hits.length) named.push({ id: rule.id, name: rule.name, isActive: rule.isActive, departments: [...new Set(hits.map((d) => d.name))] });
  }
  return { named, forAll };
}

async function recurring(company) {
  const [contacts, departments] = await Promise.all([
    Contact.findAll({ where: { companyId: company.id }, attributes: ['id'] }),
    Department.findAll({ where: { companyId: company.id }, attributes: ['id'] }),
  ]);
  const contactIds = new Set(contacts.map((c) => c.id));
  const deptIds = new Set(departments.map((d) => d.id));
  const all = await RecurringTicket.findAll({ order: [['title', 'ASC'], ['id', 'ASC']] });
  return all.filter((r) => contactIds.has(r.contactId) || (!r.contactId && deptIds.has(r.departmentId)))
    .map((r) => ({ id: r.id, title: r.title, schedule: scheduleText(r), active: r.active }));
}

async function fields(company, tree) {
  const all = await CustomField.findAll({ where: { isActive: true }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const named = [];
  let forAll = 0;
  for (const f of all) {
    const cats = ids(f.categoryIds);
    if (!cats.length) { forAll += 1; continue; } // eslint-disable-line no-continue
    const mine = cats.filter((cid) => tree.get(cid) && tree.get(cid).companyId === company.id);
    if (mine.length) named.push({ id: f.id, label: f.label, categories: mine.map((cid) => pathOf(tree, cid).map((n) => n.name).join(' › ')) });
  }
  return { named, forAll };
}

const get = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const tree = await loadTree();
  const [b, r, rec, f, can] = await Promise.all([
    bundles(company, tree), rules(company), recurring(company), fields(company, tree),
    Promise.all(['settings.manage_playbooks', 'settings.manage_system', 'tickets.recurring.manage'].map((k) => hasPermission(req.user.id, k))),
  ]);
  res.json({
    bundles: b,
    rules: r.named,
    rulesForAll: r.forAll,
    recurring: rec,
    fields: f.named,
    fieldsForAll: f.forAll,
    can: { bundles: can[0], rules: can[1], fields: can[1], recurring: can[2] },
  });
});

// PUT { offered }. Off: the company joins the bundle's exceptions. On: it
// leaves them, and joins its chosen companies if it has some.
const setBundle = asyncHandler(async (req, res) => {
  if (!(await hasPermission(req.user.id, 'settings.manage_playbooks'))) {
    throw new ApiError(403, 'Changing which bundles a company has needs the Checklists permission', 'FORBIDDEN');
  }
  const company = await loadAccessibleCompany(req);
  const { offered } = req.body || {};
  if (typeof offered !== 'boolean') throw new ApiError(400, 'offered must be true or false', 'VALIDATION_ERROR');
  const playbook = await Playbook.findByPk(Number(req.params.playbookId) || 0);
  if (!playbook) throw new ApiError(404, 'Bundle not found', 'NOT_FOUND');
  const except = ids(playbook.exceptCompanyIds).filter((id) => id !== company.id);
  const changes = { exceptCompanyIds: offered ? (except.length ? except : null) : [...except, company.id] };
  if (offered && Array.isArray(playbook.companyIds) && !ids(playbook.companyIds).includes(company.id)) {
    changes.companyIds = [...ids(playbook.companyIds), company.id];
  }
  await playbook.update(changes);
  await writeAudit(req, 'company.bundle', 'Company', company.id, { playbookId: playbook.id, offered });
  const tree = await loadTree();
  res.json({ bundles: await bundles(company, tree) });
});

module.exports = { get, setBundle, scheduleText };
