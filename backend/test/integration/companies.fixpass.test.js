const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b final-review findings (F1–F8 in the ledger).

const {
  Company, Contact, Department, Ticket, Asset, AssetCategory, SystemAuditLog,
} = models;

let w;
let acme;
let globex;
let internalId;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const grant = async (user, permissionKey) => expectOk(
  await a().post(`${API}/users/${user.id}/overrides`).send({ permissionKey, granted: true }), 201
);

beforeEach(async () => {
  await resetData();
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
});
afterAll(async () => {
  await AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

describe('F1: merging moves access grants, so it needs companies.manage_access', () => {
  it('a merger without companies.manage_access can\'t move grants; one with it can, and it is audited', async () => {
    const merger = await makeTech('merger', w.deptA.id);
    await grant(merger.user, 'companies.manage');
    const fencedToGlobex = await makeTech('gtech', w.deptA.id);
    await setCompanyAccess(w.admin, fencedToGlobex.user.id, { allCompanies: false, companyIds: [globex.id] });
    expectErr(
      await merger.agent.post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: acme.id }),
      403, 'FORBIDDEN', 'This merge moves company access grants, which needs companies.manage_access'
    );
    await grant(merger.user, 'companies.manage_access');
    expectOk(await merger.agent.post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: acme.id }));
    const audit = await SystemAuditLog.findOne({ where: { action: 'company_access_granted', targetUserId: fencedToGlobex.user.id } });
    expect(audit).not.toBeNull();
  });

  it('a merge that moves no grants needs only companies.manage', async () => {
    const merger = await makeTech('merger2', w.deptA.id);
    await grant(merger.user, 'companies.manage');
    expectOk(await merger.agent.post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: acme.id }));
  });
});

it('F2: merging a client into the internal company doesn\'t make the internal company a client', async () => {
  expectOk(await a().post(`${API}/companies/${globex.id}/merge`).send({ intoCompanyId: internalId }));
  expectOk(await a().post(`${API}/companies/${acme.id}/merge`).send({ intoCompanyId: internalId }));
  expect((await Company.findByPk(internalId)).isClient).toBe(false);
  expect(expectOk(await a().get(`${API}/companies/summary`)).multiCompany).toBe(false);
});

it('F4: a workflow action can\'t assign a ticket to someone who can\'t reach its company', async () => {
  const { executeAction } = require('../../src/services/workflowEngine'); // eslint-disable-line global-require
  const outsider = await makeTech('outsider', w.deptA.id);
  await setCompanyAccess(w.admin, outsider.user.id, { allCompanies: false, companyIds: [internalId] });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const t = await makeTicket(a(), { title: 'acme', contactId: ann.id });
  const ticket = await Ticket.findByPk(t.id);
  for (const actionType of ['assign_to_user', 'escalate_to_user']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(executeAction(ticket, { actionType, actionValue: { userId: outsider.user.id } }, { id: 0 }))
      .rejects.toThrow(/can't see tickets for this company/);
  }
  expect((await Ticket.findByPk(t.id)).assigneeId).toBeNull();
});

it('F5: a ticket from inbound email takes its contact\'s department', async () => {
  const { createTicketFromEmail } = require('../../src/services/inboundEmailService'); // eslint-disable-line global-require
  const hr = await Department.create({ name: 'HR', companyId: acme.id });
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id, departmentId: hr.id, email: 'ann@acme.test' });
  const ticket = await createTicketFromEmail({ contact: ann, subject: 'Help', textBody: 'x' });
  expect([ticket.companyId, ticket.departmentId]).toEqual([acme.id, hr.id]);
});

describe('F6: vendor text and vendor company stay in step', () => {
  it('text alone links to the vendor company of that name, or to none', async () => {
    const dell = await Company.create({ name: 'Dell', isVendor: true });
    const created = expectOk(await a().post(`${API}/licenses`).send({ name: 'L1', vendor: ' dell ' }), 201).license;
    expect(created.vendorCompanyId).toBe(dell.id);
    const changed = expectOk(await a().patch(`${API}/licenses/${created.id}`).send({ vendor: 'HP' })).license;
    expect([changed.vendor, changed.vendorCompanyId]).toEqual(['HP', null]);
  });

  it('text naming a client-vendor the user can\'t reach doesn\'t link to it', async () => {
    await Company.update({ isVendor: true }, { where: { id: acme.id } });
    const t = await makeTech('fencedv', w.deptA.id);
    await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [internalId] });
    await grant(t.user, 'assets.manage_licenses');
    const lic = expectOk(await t.agent.post(`${API}/licenses`).send({ name: 'L2', vendor: 'Acme' }), 201).license;
    expect(lic.vendorCompanyId).toBeNull();
  });
});

describe('F7: watcher lists are de-duplicated and capped', () => {
  it('duplicates count once, and more than 100 watchers are refused', async () => {
    const t = await makeTicket(a(), { title: 'w', contactId: w.contact.id, watcherIds: [w.admin.user.id, w.admin.user.id, String(w.admin.user.id)] });
    const watchers = expectOk(await a().get(`${API}/tickets/${t.id}/watchers`)).watchers;
    expect(watchers).toHaveLength(1);
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    expectErr(
      await a().post(`${API}/tickets`).send({ title: 'x', contactId: w.contact.id, watcherIds: many }),
      400, 'VALIDATION_ERROR', 'A ticket can have at most 100 watchers'
    );
  });
});

it('F8: a vendor that is a client the viewer can\'t reach isn\'t named', async () => {
  await Company.update({ isVendor: true }, { where: { id: acme.id } });
  const category = await AssetCategory.create({ name: 'Laptops' });
  const asset = await Asset.create({ assetTag: 'F8-1', name: 'box', categoryId: category.id, vendorCompanyId: acme.id });
  const fenced = await makeTech('fenced8', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
  expect(expectOk(await fenced.agent.get(`${API}/assets/${asset.id}`)).asset.vendorCompany).toBeNull();
  const listed = expectOk(await fenced.agent.get(`${API}/assets`)).assets.find((x) => x.id === asset.id);
  expect(listed.vendorCompany).toBeNull();
  // The admin, who reaches Acme, still sees it.
  expect(expectOk(await a().get(`${API}/assets/${asset.id}`)).asset.vendorCompany).toEqual({ id: acme.id, name: 'Acme' });
});
