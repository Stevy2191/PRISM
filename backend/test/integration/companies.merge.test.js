const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 5: merging company B into company A.

const {
  Company, CompanyDomain, Contact, Department, Site, Ticket, Asset, AssetCategory, UserCompanyAccess,
  RoleCompanyAccess, Role, AuditLog,
} = models;

let w;
let acme;
let globex;
let internalId;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const merge = (from, into, agent = a(), preview = false) => agent
  .post(`${API}/companies/${from.id}/merge${preview ? '?preview=true' : ''}`).send({ intoCompanyId: into.id });

let category;
beforeEach(async () => {
  await resetData();
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex', isVendor: true });
  category = await AssetCategory.create({ name: 'Laptops' });
});
afterAll(async () => {
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

// Globex owns one of everything; returns the ids.
async function stockGlobex() {
  const dept = await Department.create({ name: 'Ops', companyId: globex.id });
  const site = await Site.create({ name: 'Plant', companyId: globex.id });
  const gus = await Contact.create({ firstName: 'Gus', displayName: 'Gus', companyId: globex.id, departmentId: dept.id, siteId: site.id });
  const ticket = await makeTicket(a(), { title: 'Globex ticket', contactId: gus.id });
  const asset = await Asset.create({ assetTag: 'G-1', name: 'g', categoryId: category.id, companyId: globex.id, vendorCompanyId: globex.id });
  await CompanyDomain.create({ companyId: globex.id, domain: 'globex.test' });
  return { dept, site, gus, ticket, asset };
}

it('preview counts what would move and changes nothing', async () => {
  await stockGlobex();
  const { preview, counts } = expectOk(await merge(globex, acme, a(), true));
  expect(preview).toBe(true);
  expect(counts).toEqual(expect.objectContaining({
    contacts: 1, departments: 1, sites: 1, tickets: 1, assets: 1, vendorAssets: 1, domains: 1,
  }));
  expect(await Company.findByPk(globex.id)).not.toBeNull();
});

it('moves every reference to A, unions the flags, and deletes B', async () => {
  const { gus, ticket, asset } = await stockGlobex();
  const { company, counts } = expectOk(await merge(globex, acme));
  expect([company.id, company.isClient, company.isVendor]).toEqual([acme.id, true, true]);
  expect(counts.tickets).toBe(1);
  expect(await Company.findByPk(globex.id)).toBeNull();
  expect((await Contact.findByPk(gus.id)).companyId).toBe(acme.id);
  expect((await Ticket.findByPk(ticket.id)).companyId).toBe(acme.id);
  const movedAsset = await Asset.findByPk(asset.id);
  expect([movedAsset.companyId, movedAsset.vendorCompanyId]).toEqual([acme.id, acme.id]);
  expect((await CompanyDomain.findOne({ where: { domain: 'globex.test' } })).companyId).toBe(acme.id);
  // Nothing anywhere still points at B.
  for (const table of ['Contacts', 'Departments', 'Sites', 'Tickets', 'Projects', 'Assets', 'Licenses', 'Contracts', 'CompanyDomains', 'UserCompanyAccess', 'RoleCompanyAccess']) {
    // eslint-disable-next-line no-await-in-loop
    const [[{ n }]] = await models.sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE companyId = ${globex.id}`);
    expect([table, Number(n)]).toEqual([table, 0]);
  }
  for (const table of ['Assets', 'Licenses', 'Contracts', 'ProjectMaterials']) {
    // eslint-disable-next-line no-await-in-loop
    const [[{ n }]] = await models.sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE vendorCompanyId = ${globex.id}`);
    expect([table, Number(n)]).toEqual([table, 0]);
  }
});

it('keeps same-named departments and sites side by side', async () => {
  await Department.create({ name: 'Ops', companyId: acme.id });
  await Site.create({ name: 'Plant', companyId: acme.id });
  await stockGlobex();
  expectOk(await merge(globex, acme));
  const depts = (await Department.findAll({ where: { companyId: acme.id }, order: [['name', 'ASC']] })).map((d) => d.name);
  expect(depts).toEqual(['Ops', 'Ops (Globex)']);
  const sites = (await Site.findAll({ where: { companyId: acme.id }, order: [['name', 'ASC']] })).map((s) => s.name);
  expect(sites).toEqual(['Plant', 'Plant (Globex)']);
});

it('moves access grants, dropping duplicates', async () => {
  const both = await makeTech('both', w.deptA.id);
  const onlyB = await makeTech('onlyb', w.deptA.id);
  await setCompanyAccess(w.admin, both.user.id, { allCompanies: false, companyIds: [acme.id, globex.id] });
  await setCompanyAccess(w.admin, onlyB.user.id, { allCompanies: false, companyIds: [globex.id] });
  const role = await Role.findOne({ where: { name: 'Department Staff' } });
  await RoleCompanyAccess.bulkCreate([{ roleId: role.id, companyId: acme.id }, { roleId: role.id, companyId: globex.id }]);
  expectOk(await merge(globex, acme));
  const grants = async (userId) => (await UserCompanyAccess.findAll({ where: { userId } })).map((r) => r.companyId);
  expect(await grants(both.user.id)).toEqual([acme.id]);
  expect(await grants(onlyB.user.id)).toEqual([acme.id]);
  expect((await RoleCompanyAccess.findAll({ where: { roleId: role.id } })).map((r) => r.companyId)).toEqual([acme.id]);
  // The permission cache was invalidated: onlyB now reaches A's records.
  expect(expectOk(await onlyB.agent.get(`${API}/companies/${acme.id}`)).company.id).toBe(acme.id);
});

it('refuses impossible merges with one answer per kind', async () => {
  const internal = await Company.findByPk(internalId);
  expectErr(await merge(internal, acme), 400, 'VALIDATION_ERROR', 'The internal company cannot be merged into another');
  expectErr(await merge(acme, acme), 400, 'VALIDATION_ERROR', 'A company cannot be merged into itself');
  expectErr(await a().post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: 99999 }), 400, 'VALIDATION_ERROR', 'Unknown company');
  await Company.update({ status: 'inactive' }, { where: { id: acme.id } });
  expectErr(await merge(globex, acme), 400, 'VALIDATION_ERROR', 'Merge into an active company');
});

it('needs companies.manage and access to both companies', async () => {
  const tech = await makeTech('tech', w.deptA.id);
  expect((await merge(globex, acme, tech.agent)).status).toBe(403);
  expectOk(await a().post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'companies.manage', granted: true }), 201);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [globex.id] });
  // Can reach B but not A: A answers like a missing company.
  expectErr(await merge(globex, acme, tech.agent), 400, 'VALIDATION_ERROR', 'Unknown company');
});

it('writes an audit row with the counts', async () => {
  await stockGlobex();
  expectOk(await merge(globex, acme));
  const row = await AuditLog.findOne({ where: { action: 'company.merge' } });
  expect(row.entityId).toBe(acme.id);
  const meta = typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta;
  expect(meta).toEqual(expect.objectContaining({ fromCompanyId: globex.id, fromName: 'Globex' }));
  expect(meta.counts.contacts).toBe(1);
});
