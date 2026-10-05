// Merging company B ("from") into company A ("into"): every reference to B
// moves to A in one transaction, then B is deleted (spec: Merge). Static
// updates skip model hooks on purpose: a ticket's contact moves with it, so
// the "ticket company follows its contact" hook has nothing to do.
const { Op } = require('sequelize');
const {
  CompanyDomain, Site, Department, Contact, Ticket, Project, Asset, License, Contract,
  ProjectMaterial, UserCompanyAccess, RoleCompanyAccess,
} = require('../models');

const OWNED = {
  contacts: Contact, departments: Department, sites: Site, tickets: Ticket,
  projects: Project, assets: Asset, licenses: License, contracts: Contract,
};
const SUPPLIED = {
  vendorAssets: Asset, vendorLicenses: License, vendorContracts: Contract, vendorMaterials: ProjectMaterial,
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

async function mergeCompanies(from, into, transaction) {
  await renameClashes(Department, from, into, 255, transaction);
  await renameClashes(Site, from, into, 150, transaction);
  for (const Model of Object.values(OWNED)) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ companyId: into.id }, { where: { companyId: from.id }, transaction, hooks: false });
  }
  for (const Model of new Set(Object.values(SUPPLIED))) {
    // eslint-disable-next-line no-await-in-loop
    await Model.update({ vendorCompanyId: into.id }, { where: { vendorCompanyId: from.id }, transaction, hooks: false });
  }
  await moveGrants(UserCompanyAccess, 'userId', from.id, into.id, transaction);
  await moveGrants(RoleCompanyAccess, 'roleId', from.id, into.id, transaction);
  await CompanyDomain.update({ companyId: into.id }, { where: { companyId: from.id }, transaction });
  await into.update({ isClient: into.isClient || from.isClient, isVendor: into.isVendor || from.isVendor }, { transaction });
  await from.destroy({ transaction });
}

module.exports = { mergeCounts, mergeCompanies };
