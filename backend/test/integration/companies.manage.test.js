const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 4.

const { Company, Contact } = models;

let w;
let acme;
let internalId;
const a = () => w.admin.agent;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
});
afterAll(closeDb);

it('the company list counts contacts and open tickets', async () => {
  const ann = await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  await makeTicket(a(), { title: 'open', contactId: ann.id });
  const closed = await makeTicket(a(), { title: 'done', contactId: ann.id });
  expectOk(await a().patch(`${API}/tickets/${closed.id}`).send({ status: 'Closed' }));
  const row = expectOk(await a().get(`${API}/companies`)).companies.find((c) => c.id === acme.id);
  expect([row.contactCount, row.openTicketCount]).toEqual([1, 1]);
});

it('the summary counts only companies the user can reach', async () => {
  const fenced = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
  expect(expectOk(await a().get(`${API}/companies/summary`))).toEqual({ count: 2, multiCompany: true });
  expect(expectOk(await fenced.agent.get(`${API}/companies/summary`))).toEqual({ count: 1, multiCompany: true });
});

it('a company can\'t stop being a client while it owns records', async () => {
  await Contact.create({ firstName: 'Ann', displayName: 'Ann', companyId: acme.id });
  const res = await a().patch(`${API}/companies/${acme.id}`).send({ isClient: false, isVendor: true });
  expect([res.status, res.body.code]).toEqual([409, 'COMPANY_IN_USE']);
  const empty = await makeCompany(w.admin, { name: 'Empty' });
  expect(expectOk(await a().patch(`${API}/companies/${empty.id}`).send({ isClient: false, isVendor: true })).company.isClient).toBe(false);
});

// Pins (expected to pass already): a conflict over a record you can't see
// gets exactly the answer a visible one does — no names, no ids.
it('[pin] conflicts don\'t describe records in companies you can\'t reach', async () => {
  const fenced = await makeTech('fenced2', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
  expectOk(await a().post(`${API}/users/${fenced.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  await Contact.create({ firstName: 'Hidden', displayName: 'Hidden', email: 'hidden@acme.test', companyId: acme.id });
  const hidden = await fenced.agent.post(`${API}/contacts`).send({ firstName: 'X', email: 'hidden@acme.test', companyId: internalId });
  const visible = await a().post(`${API}/contacts`).send({ firstName: 'Y', email: 'hidden@acme.test', companyId: internalId });
  expect(hidden.body).toEqual(visible.body);
  expect(hidden.body).toEqual({ error: true, message: 'A contact with this email already exists', code: 'EMAIL_TAKEN' });
});
