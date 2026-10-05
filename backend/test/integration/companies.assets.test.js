const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Assets, licenses and contracts get record-level company scope for the
// first time (plan 2a task 9).

const { Company, Contact } = models;
const MARK = 'ACME-SECRET';

let w;
let acme;
let hq;
let hr;
let ann;
let category;
let acmeAsset;
let acmeLicense;
let acmeContract;
let acmeTicket;
let internalId;
let fenced;
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: `${MARK} Corp` });
  hq = expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/sites`).send({ name: 'HQ' }), 201).site;
  hr = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201).department;
  ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  category = await models.AssetCategory.create({ name: 'Laptops' });
  acmeAsset = expectOk(await w.admin.agent.post(`${API}/assets`).send({
    name: `${MARK} laptop`, assetTag: `${MARK}-1`, categoryId: category.id, companyId: acme.id,
  }), 201).asset;
  acmeLicense = expectOk(await w.admin.agent.post(`${API}/licenses`).send({ name: `${MARK} licence`, companyId: acme.id, expiryDate: '2099-01-01' }), 201).license;
  acmeContract = expectOk(await w.admin.agent.post(`${API}/contracts`).send({ name: `${MARK} contract`, vendor: 'Dell', companyId: acme.id }), 201).contract;
  acmeTicket = await makeTicket(w.admin.agent, { title: 'Acme ticket', contactId: ann.id });
  fenced = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});

const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
const newAsset = (body, agent = a()) => agent.post(`${API}/assets`).send({ categoryId: category.id, ...body });

it('assets default to the internal company', async () => {
  const asset = expectOk(await newAsset({ name: 'Home laptop', assetTag: 'HOME-1' }), 201).asset;
  expect(asset.companyId).toBe(internalId);
  expect(asset.company).toEqual({ id: internalId, name: expect.any(String) });
});

it('an asset can belong to a client, at one of its sites', async () => {
  const asset = expectOk(await newAsset({ name: 'L2', assetTag: 'A-2', companyId: acme.id, siteId: hq.id, departmentId: hr.id }), 201).asset;
  expect(asset.site).toEqual({ id: hq.id, name: 'HQ' });
  expect(asset.departmentId).toBe(hr.id);
});

it('an asset\'s site and department must be in its company', async () => {
  expectErr(await newAsset({ name: 'x', assetTag: 'X-1', siteId: hq.id }), 400, 'VALIDATION_ERROR', 'Site not found');
  expectErr(await newAsset({ name: 'x', assetTag: 'X-2', departmentId: hr.id }), 400, 'VALIDATION_ERROR', 'Department not found');
});

it('an asset can only be assigned to a visible contact in its own company', async () => {
  expectErr(await newAsset({ name: 'x', assetTag: 'X-3', assignedToContactId: ann.id }), 400, 'VALIDATION_ERROR', 'Contact not found');
  const ok = expectOk(await newAsset({ name: 'y', assetTag: 'X-4', companyId: acme.id, assignedToContactId: ann.id }), 201).asset;
  expect(ok.assignedToContactId).toBe(ann.id);
});

it('a fenced user can\'t touch another company\'s asset, license or contract by id', async () => {
  const f = fenced.agent;
  const checks = [
    ['asset', () => f.get(`${API}/assets/${acmeAsset.id}`)],
    ['asset', () => f.patch(`${API}/assets/${acmeAsset.id}`).send({ notes: 'x' })],
    ['asset', () => f.delete(`${API}/assets/${acmeAsset.id}?force=true`)],
    ['asset', () => f.get(`${API}/assets/${acmeAsset.id}/tickets`)],
    ['asset', () => f.get(`${API}/assets/${acmeAsset.id}/checkouts`)],
    ['asset', () => f.get(`${API}/assets/${acmeAsset.id}/attachments`)],
    ['license', () => f.get(`${API}/licenses/${acmeLicense.id}`)],
    ['license', () => f.patch(`${API}/licenses/${acmeLicense.id}`).send({ notes: 'x' })],
    ['license', () => f.get(`${API}/licenses/${acmeLicense.id}/reveal-key`)],
    ['contract', () => f.get(`${API}/contracts/${acmeContract.id}`)],
    ['contract', () => f.patch(`${API}/contracts/${acmeContract.id}`).send({ notes: 'x' })],
  ];
  for (const [label, request] of checks) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request();
    expect([res.status, res.body]).toEqual([403, { error: true, message: `You do not have access to this ${label}`, code: 'FORBIDDEN' }]);
  }
});

it('lists leave out other companies', async () => {
  for (const path of ['/assets', '/licenses', '/contracts']) {
    // eslint-disable-next-line no-await-in-loop
    const admin = JSON.stringify(expectOk(await a().get(`${API}${path}`)));
    // eslint-disable-next-line no-await-in-loop
    const mine = JSON.stringify(expectOk(await fenced.agent.get(`${API}${path}`)));
    expect(admin).toContain(MARK);
    expect(mine).not.toContain(MARK);
  }
});

it('asset stats and the expiry summary leave out other companies', async () => {
  const stats = async (agent) => expectOk(await agent.get(`${API}/assets/stats`));
  expect((await stats(a())).totalActive).toBe(1);
  expect((await stats(fenced.agent)).totalActive).toBe(0);
  await models.License.update({ expiryDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) }, { where: { id: acmeLicense.id } });
  const summary = async (agent) => expectOk(await agent.get(`${API}/assets/expiry-summary`));
  expect((await summary(a())).licenses.expiringSoon).toBe(1);
  expect((await summary(fenced.agent)).licenses.expiringSoon).toBe(0);
});

it('an asset can only be linked to a ticket in its own company that you can see', async () => {
  const home = await makeTicket(a(), { title: 'Home', contactId: w.contact.id });
  expectErr(await a().post(`${API}/assets/${acmeAsset.id}/tickets`).send({ ticketId: home.id }), 400, 'VALIDATION_ERROR', 'Ticket not found');
  const homeAsset = expectOk(await newAsset({ name: 'h', assetTag: 'H-9' }), 201).asset;
  const fencedLink = await fenced.agent.post(`${API}/assets/${homeAsset.id}/tickets`).send({ ticketId: acmeTicket.id });
  const missing = await fenced.agent.post(`${API}/assets/${homeAsset.id}/tickets`).send({ ticketId: 99999 });
  expect(fencedLink.status).toBe(404);
  expect(fencedLink.body).toEqual(missing.body);
  expect(missing.body.message).toBe('Ticket not found');
});

it('a license can only be linked to an asset in its own company', async () => {
  const homeAsset = expectOk(await newAsset({ name: 'h', assetTag: 'H-1' }), 201).asset;
  expectErr(await a().post(`${API}/licenses/${acmeLicense.id}/assets`).send({ assetId: homeAsset.id }), 400, 'VALIDATION_ERROR', 'Asset not found');
});

it('a license can only be assigned to a contact in its own company', async () => {
  expectErr(await a().post(`${API}/licenses/${acmeLicense.id}/contacts`).send({ contactId: w.contact.id }), 400, 'VALIDATION_ERROR', 'Contact not found');
});

it('a contract can only be linked to an asset in its own company', async () => {
  const homeAsset = expectOk(await newAsset({ name: 'h', assetTag: 'H-2' }), 201).asset;
  expectErr(await a().post(`${API}/contracts/${acmeContract.id}/assets`).send({ assetId: homeAsset.id }), 400, 'VALIDATION_ERROR', 'Asset not found');
});

it('an id with trailing junk can\'t slip past the fence', async () => {
  // MariaDB casts '1abc' to 1, so a fence that skips non-integer ids and a
  // handler that looks them up would hand back record 1.
  for (const [path, label] of [['assets', 'Asset'], ['licenses', 'License'], ['contracts', 'Contract']]) {
    const id = { assets: acmeAsset.id, licenses: acmeLicense.id, contracts: acmeContract.id }[path];
    for (const junk of [`${id}abc`, `${id}.0`, ` ${id}`]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fenced.agent.get(`${API}/${path}/${encodeURIComponent(junk)}`);
      expect([path, junk, res.status, res.body.message]).toEqual([path, junk, 404, `${label} not found`]);
    }
  }
});

it('a missing id still answers 404', async () => {
  const res = await fenced.agent.get(`${API}/assets/99999`);
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('Asset not found');
});

it('calendar renewal events leave out other companies', async () => {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  await models.License.update({ expiryDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) }, { where: { id: acmeLicense.id } });
  await models.Contract.update({ renewalDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) }, { where: { id: acmeContract.id } });
  const path = `/calendar/events?startDate=${start}&endDate=${end}&types=subscriptions,license_expiry,contract_renewal`;
  expect(JSON.stringify(expectOk(await a().get(`${API}${path}`)))).toContain(MARK);
  expect(JSON.stringify(expectOk(await fenced.agent.get(`${API}${path}`)))).not.toContain(MARK);
});

it('the dashboard\'s asset summary leaves out other companies', async () => {
  const admin = expectOk(await a().get(`${API}/dashboard`)).assetsSummary;
  const mine = expectOk(await fenced.agent.get(`${API}/dashboard`)).assetsSummary;
  expect(admin.totalActive).toBe(1);
  expect(mine.totalActive).toBe(0);
});

it('alert tickets land in the record\'s company', async () => {
  const { runChecks } = require('../../src/services/assetAlertScheduler'); // eslint-disable-line global-require
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await models.Asset.update({ warrantyExpiryDate: soon }, { where: { id: acmeAsset.id } });
  await models.License.update({ expiryDate: soon }, { where: { id: acmeLicense.id } });
  await runChecks();
  const alerts = await models.Ticket.findAll({ where: { contactId: null }, raw: true });
  expect(alerts.length).toBeGreaterThanOrEqual(2);
  alerts.forEach((t) => expect(t.companyId).toBe(acme.id));
});

// Beyond the brief (ledgered): the same link rule for checkouts and for
// assets linked when a ticket is created, and link views that never show a
// record from another company (links can cross after a contact or asset
// moves).
it('an asset can only be checked out to a contact in its own company', async () => {
  expectErr(await a().post(`${API}/assets/${acmeAsset.id}/checkouts`).send({ contactId: w.contact.id }), 400, 'VALIDATION_ERROR', 'Contact not found');
  const checkout = expectOk(await a().post(`${API}/assets/${acmeAsset.id}/checkouts`).send({ contactId: ann.id }), 201).checkout;
  expectErr(await a().patch(`${API}/assets/${acmeAsset.id}/checkouts/${checkout.id}`).send({ contactId: w.contact.id }), 400, 'VALIDATION_ERROR', 'Contact not found');
});

it('a new ticket can only link assets in its contact\'s company', async () => {
  const res = await a().post(`${API}/tickets`).send({ title: 'x', contactId: w.contact.id, assetIds: [acmeAsset.id] });
  expectErr(res, 400, 'VALIDATION_ERROR', 'Asset not found');
  const junk = await a().post(`${API}/tickets`).send({ title: 'x', contactId: ann.id, assetIds: [`${acmeAsset.id}abc`] });
  expectErr(junk, 400, 'VALIDATION_ERROR', 'Asset not found');
  const ok = expectOk(await a().post(`${API}/tickets`).send({ title: 'y', contactId: ann.id, assetIds: [acmeAsset.id] }), 201).ticket;
  expect(ok.linkedAssets.map((x) => x.id)).toEqual([acmeAsset.id]);
});

it('link views leave out records from another company', async () => {
  const { AssetTicket, LicenseAsset, LicenseContact, ContractAsset } = models;
  const homeAsset = expectOk(await newAsset({ name: 'home box', assetTag: 'H-5' }), 201).asset;
  // Links made before a move: each pair now sits in two companies.
  await AssetTicket.create({ assetId: homeAsset.id, ticketId: acmeTicket.id, linkedBy: w.admin.user.id });
  await LicenseAsset.create({ licenseId: acmeLicense.id, assetId: homeAsset.id, assignedBy: w.admin.user.id });
  await LicenseContact.create({ licenseId: acmeLicense.id, contactId: w.contact.id, assignedBy: w.admin.user.id });
  await ContractAsset.create({ contractId: acmeContract.id, assetId: homeAsset.id, linkedBy: w.admin.user.id });

  const tickets = expectOk(await a().get(`${API}/assets/${homeAsset.id}/tickets`));
  expect(tickets.tickets).toEqual([]);
  expect(tickets.total).toBe(0);
  expect(expectOk(await a().get(`${API}/tickets/${acmeTicket.id}`)).ticket.linkedAssets).toEqual([]);
  expect(expectOk(await a().get(`${API}/licenses/${acmeLicense.id}/assets`)).links).toEqual([]);
  expect(expectOk(await a().get(`${API}/licenses/${acmeLicense.id}/contacts`)).links).toEqual([]);
  expect(expectOk(await a().get(`${API}/contracts/${acmeContract.id}/assets`)).links).toEqual([]);
});

it('moving an asset to another company clears its site, department and contact', async () => {
  const placed = expectOk(await newAsset({
    name: 'm', assetTag: 'M-1', companyId: acme.id, siteId: hq.id, departmentId: hr.id, assignedToContactId: ann.id,
  }), 201).asset;
  expectErr(await a().patch(`${API}/assets/${placed.id}`).send({ companyId: internalId, siteId: hq.id }), 400, 'VALIDATION_ERROR', 'Site not found');
  const moved = expectOk(await a().patch(`${API}/assets/${placed.id}`).send({ companyId: internalId })).asset;
  expect([moved.companyId, moved.siteId, moved.departmentId, moved.assignedToContactId]).toEqual([internalId, null, null, null]);
  expectErr(await a().patch(`${API}/assets/${placed.id}`).send({ companyId: 99999 }), 400, 'VALIDATION_ERROR', 'Unknown company');
});

it('licenses and contracts choose a company, and their department must be in it', async () => {
  expectErr(await a().post(`${API}/licenses`).send({ name: 'l', departmentId: hr.id }), 400, 'VALIDATION_ERROR', 'Department not found');
  expectErr(await a().post(`${API}/contracts`).send({ name: 'c', vendor: 'v', departmentId: hr.id }), 400, 'VALIDATION_ERROR', 'Department not found');
  expect(acmeLicense.company).toEqual({ id: acme.id, name: acme.name });
  expect(acmeContract.company).toEqual({ id: acme.id, name: acme.name });
  expectErr(await fenced.agent.post(`${API}/licenses`).send({ name: 'l', companyId: acme.id }), 400, 'VALIDATION_ERROR', 'Unknown company');
});
