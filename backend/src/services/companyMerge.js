// Merging company B ("from") into company A ("into"): every reference to B
// moves to A in one transaction, then B is deleted (spec: Merge). Static
// updates skip model hooks on purpose: a ticket's contact moves with it, so
// the "ticket company follows its contact" hook has nothing to do.
const { Op } = require('sequelize');
const {
  CompanyDomain, Site, Department, Contact, Ticket, Project, Asset, License, Contract,
  ProjectMaterial, UserCompanyAccess, RoleCompanyAccess, TicketCategory, SlaPolicy, TicketSla, CompanyCatalogItem, Bill, PurchaseOrder, Expense, Agreement, Invoice, sequelize,
} = require('../models');
const { renumberMoved } = require('./tickets/numbers');
const { renumberMoved: renumberMovedProjects } = require('./projects/numbers');
const { uniqueCode } = require('./codes');
const { ApiError } = require('../middleware/error');

const OWNED = {
  contacts: Contact, departments: Department, sites: Site, tickets: Ticket,
  projects: Project, assets: Asset, licenses: License, contracts: Contract, invoices: Invoice,
};
const SUPPLIED = {
  vendorAssets: Asset, vendorLicenses: License, vendorContracts: Contract, vendorMaterials: ProjectMaterial,
  vendorPurchaseOrders: PurchaseOrder, vendorExpenses: Expense,
};

async function mergeCounts(fromId, transaction) {
  const counts = {};
  for (const [key, Model] of Object.entries(OWNED)) {
    counts[key] = await Model.count({ where: { companyId: fromId }, transaction }); // eslint-disable-line no-await-in-loop
  }
  for (const [key, Model] of Object.entries(SUPPLIED)) {
    counts[key] = await Model.count({ where: { vendorCompanyId: fromId }, transaction }); // eslint-disable-line no-await-in-loop
  }
  counts.domains = await CompanyDomain.count({ where: { companyId: fromId }, transaction });
  counts.userAccess = await UserCompanyAccess.count({ where: { companyId: fromId }, transaction });
  counts.roleAccess = await RoleCompanyAccess.count({ where: { companyId: fromId }, transaction });
  return counts;
}

// Same-named departments and sites are kept side by side (spec), but names
// are unique per company, so B's clashing rows take a " (B)" suffix.
// CN: department codes are unique within a company: B's that A already uses
// get the next free one (HR → HR2).
async function recodeClashes(from, into, transaction) {
  const taken = new Set((await Department.findAll({ where: { companyId: into.id }, attributes: ['shortCode'], transaction }))
    .map((d) => (d.shortCode || '').toUpperCase()).filter(Boolean));
  const theirs = await Department.findAll({ where: { companyId: from.id }, transaction });
  for (const dept of theirs) {
    const code = (dept.shortCode || '').toUpperCase();
    if (code && !taken.has(code)) { taken.add(code); continue; } // eslint-disable-line no-continue
    const next = uniqueCode(code || 'D', taken, 6);
    taken.add(next);
    await dept.update({ shortCode: next }, { transaction, hooks: false }); // eslint-disable-line no-await-in-loop
  }
}

async function renameClashes(Model, from, into, maxLength, transaction) {
  const taken = new Set((await Model.findAll({ where: { companyId: into.id }, attributes: ['name'], transaction }))
    .map((r) => r.name.toLowerCase()));
  const label = from.name.slice(0, 40);
  const ours = await Model.findAll({ where: { companyId: from.id }, transaction });
  for (const row of ours) {
    if (!taken.has(row.name.toLowerCase())) continue; // eslint-disable-line no-continue
    let name;
    for (let n = 1; !name || taken.has(name.toLowerCase()); n += 1) {
      const suffix = n === 1 ? ` (${label})` : ` (${label} ${n})`;
      name = `${row.name.slice(0, maxLength - suffix.length)}${suffix}`;
    }
    taken.add(name.toLowerCase());
    await row.update({ name }, { transaction, hooks: false }); // eslint-disable-line no-await-in-loop
  }
}

// A user or role granted both companies keeps one grant to A.
async function moveGrants(Model, key, fromId, intoId, transaction) {
  const holders = (await Model.findAll({ where: { companyId: intoId }, attributes: [key], transaction })).map((r) => r[key]);
  if (holders.length) await Model.destroy({ where: { companyId: fromId, [key]: { [Op.in]: holders } }, transaction });
  await Model.update({ companyId: intoId }, { where: { companyId: fromId }, transaction });
}

// Ticket categories (9) move too; only top-level names must differ within a
// company (children keep their own parent), so B's clashing top-level ones
// take the suffix.
async function moveCategories(from, into, transaction) {
  const top = { parentId: null };
  const taken = new Set((await TicketCategory.findAll({ where: { companyId: into.id, ...top }, attributes: ['name'], transaction }))
    .map((r) => r.name.toLowerCase()));
  const label = from.name.slice(0, 40);
  const theirs = await TicketCategory.findAll({ where: { companyId: from.id, ...top }, transaction });
  for (const row of theirs) {
    if (taken.has(row.name.toLowerCase())) {
      let name;
      for (let n = 1; !name || taken.has(name.toLowerCase()); n += 1) {
        const suffix = n === 1 ? ` (${label})` : ` (${label} ${n})`;
        name = `${row.name.slice(0, 100 - suffix.length)}${suffix}`;
      }
      taken.add(name.toLowerCase());
      await row.update({ name }, { transaction, hooks: false }); // eslint-disable-line no-await-in-loop
    }
  }
  await TicketCategory.update({ companyId: into.id }, { where: { companyId: from.id }, transaction, hooks: false });
}

// The software list (9) moves too. An app on both lists is kept once (A's);
// B's tickets that named B's copy now name A's.
async function moveCatalog(from, into, transaction) {
  const ours = new Map((await CompanyCatalogItem.findAll({ where: { companyId: into.id }, transaction }))
    .map((i) => [`${i.kind}\n${i.name.toLowerCase()}`, i]));
  const theirs = await CompanyCatalogItem.findAll({ where: { companyId: from.id }, transaction });
  for (const item of theirs) {
    const kept = ours.get(`${item.kind}\n${item.name.toLowerCase()}`);
    if (kept) {
      /* eslint-disable no-await-in-loop */
      await Ticket.update({ catalogItemId: kept.id }, { where: { catalogItemId: item.id }, transaction, hooks: false });
      await item.destroy({ transaction });
      /* eslint-enable no-await-in-loop */
    }
  }
  await CompanyCatalogItem.update({ companyId: into.id }, { where: { companyId: from.id }, transaction, hooks: false });
}

// CS: the merged-away company's own SLA goes with it; its tickets' clocks
// move onto the company they now belong to (their due dates stay as set).
async function moveSla(from, into, transaction) {
  const [old, kept] = await Promise.all([
    SlaPolicy.findOne({ where: { companyId: from.id }, transaction }),
    SlaPolicy.findOne({ where: { companyId: into.id }, transaction }),
  ]);
  if (!old) return;
  if (kept) await TicketSla.update({ slaPolicyId: kept.id }, { where: { slaPolicyId: old.id }, transaction, hooks: false });
  await Agreement.update({ slaPolicyId: kept ? kept.id : null }, { where: { slaPolicyId: old.id }, transaction });
  await old.destroy({ transaction });
}

// Agreements (Phase 3) follow the company; a company bills from one active
// agreement, so two active ones can't land on the company kept.
async function moveAgreements(from, into, transaction) {
  const active = await Agreement.count({ where: { companyId: [from.id, into.id], status: 'active' }, transaction });
  if (active > 1) {
    throw new ApiError(409, 'Both companies have an active agreement. Cancel one before merging.', 'AGREEMENT_EXISTS');
  }
  await Agreement.update({ companyId: into.id }, { where: { companyId: from.id }, transaction });
  // A billing period is billed once per company: the kept company's run
  // invoice for a month stays the one for that month.
  const keptPeriods = (await Invoice.findAll({ where: { companyId: into.id, periodKey: { [Op.ne]: null } }, attributes: ['periodKey'], transaction })).map((i) => i.periodKey);
  if (keptPeriods.length) await Invoice.update({ periodKey: null }, { where: { companyId: from.id, periodKey: keptPeriods }, transaction });
}

async function mergeCompanies(from, into, transaction) {
  await moveAgreements(from, into, transaction);
  await moveSla(from, into, transaction);
  await moveCategories(from, into, transaction);
  await moveCatalog(from, into, transaction);
  // Ledger entries (Phase 3) are never changed as money; whose company they
  // are filed under follows a merge. Raw SQL: the model refuses updates.
  // Bills (Phase 3) follow their vendor; a bill number the kept vendor
  // already has gets the merged vendor's name after it.
  const keptNumbers = new Set((await Bill.findAll({ where: { vendorCompanyId: into.id }, attributes: ['billNumber'], transaction })).map((b) => b.billNumber));
  for (const bill of await Bill.findAll({ where: { vendorCompanyId: from.id }, transaction })) {
    const billNumber = keptNumbers.has(bill.billNumber) ? `${bill.billNumber} (${from.name})`.slice(0, 100) : bill.billNumber;
    await bill.update({ vendorCompanyId: into.id, billNumber }, { transaction }); // eslint-disable-line no-await-in-loop
  }
  await sequelize.query('UPDATE LedgerEntries SET companyId = :into WHERE companyId = :from', {
    replacements: { into: into.id, from: from.id }, transaction,
  });
  await renameClashes(Department, from, into, 255, transaction);
  await renameClashes(Site, from, into, 150, transaction);
  // CN: B's tickets take the next numbers in A; their B numbers stay findable.
  const movingTickets = (await Ticket.findAll({ where: { companyId: from.id }, attributes: ['id'], transaction })).map((t) => t.id);
  await Ticket.update({ companySeq: null }, { where: { companyId: from.id }, transaction, hooks: false });
  const movingProjects = (await Project.findAll({ where: { companyId: from.id }, attributes: ['id'], transaction })).map((p) => p.id);
  await Project.update({ companySeq: null }, { where: { companyId: from.id }, transaction, hooks: false });
  await recodeClashes(from, into, transaction);
  for (const Model of Object.values(OWNED)) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ companyId: into.id }, { where: { companyId: from.id }, transaction, hooks: false });
  }
  await renumberMoved(movingTickets, transaction);
  await renumberMovedProjects(movingProjects, transaction);
  for (const Model of new Set(Object.values(SUPPLIED))) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ vendorCompanyId: into.id }, { where: { vendorCompanyId: from.id }, transaction, hooks: false });
  }
  await moveGrants(UserCompanyAccess, 'userId', from.id, into.id, transaction);
  await moveGrants(RoleCompanyAccess, 'roleId', from.id, into.id, transaction);
  await CompanyDomain.update({ companyId: into.id }, { where: { companyId: from.id }, transaction });
  // The flags are unioned, except that the internal company never becomes a
  // client: multiCompany means "a client exists", and the internal company
  // can't drop the flag again once it owns records.
  await into.update({
    isClient: !into.isInternal && (into.isClient || from.isClient),
    isVendor: into.isVendor || from.isVendor,
    is1099: into.is1099 || from.is1099,
  }, { transaction });
  await from.destroy({ transaction });
}

module.exports = { mergeCounts, mergeCompanies };
