jest.mock('../../src/services/emailSender');
const bcrypt = require('bcryptjs');
const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, portalAgent,
} = require('./fixtures');
const stripe = require('../../src/services/money/stripe');
const { makeFakeStripe } = require('./fakeStripe');

// Phase 3, step 3, task 6: customers see and pay their invoices in the
// portal. Company portal admins see all of their company's; other contacts
// the ones billed to them. Drafts never show; another company's never.

const P = `${API}/portal`;
const PASSWORD = 'Harbour-Lights-2026';
let hash;
let w;
let alpha;
let boss;
let dana;
let otto;
let forBoss;
let forDana;
let fake;

async function portalAs(contact) {
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: contact.id } });
  const agent = await portalAgent(contact.companyId);
  expectOk(await agent.post(`${P}/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}
const invoiceFor = async (company, contact, price, send = true) => {
  const draft = expectOk(await w.admin.agent.post(`${API}/money/invoices`).send({
    companyId: company.id, billToContactId: contact.id, lines: [{ kind: 'fee', description: 'Support', quantity: '1', unitPrice: price }],
  }), 201).invoice;
  if (!send) return draft;
  return expectOk(await w.admin.agent.post(`${API}/money/invoices/${draft.id}/send`).send({ issuedOn: '2027-01-01' })).invoice;
};

beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'true' });
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  const beta = await makeCompany(w.admin, { name: 'Beta' });
  boss = await makeContact(w.admin, { firstName: 'Bo', companyId: alpha.id });
  dana = await makeContact(w.admin, { firstName: 'Dana', companyId: alpha.id });
  otto = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id });
  await models.CompanyPortalAdmin.create({ companyId: alpha.id, contactId: boss.id });
  forBoss = await invoiceFor(alpha, boss, '100');
  forDana = await invoiceFor(alpha, dana, '50');
  await invoiceFor(alpha, boss, '75', false); // a draft
  await invoiceFor(beta, otto, '20');
  fake = makeFakeStripe();
  stripe.setClientForTests(fake);
});
afterAll(async () => { stripe.setClientForTests(null); await closeDb(); });

const numbers = async (agent) => expectOk(await agent.get(`${P}/invoices`)).invoices.map((x) => x.number).sort();

it('a company admin sees all the company\'s sent invoices; a contact only theirs', async () => {
  expect(await numbers(await portalAs(boss))).toEqual([forBoss.number, forDana.number].sort());
  expect(await numbers(await portalAs(dana))).toEqual([forDana.number]);
  const one = expectOk(await (await portalAs(dana)).get(`${P}/invoices/${forDana.id}`)).invoice;
  expect(one).toMatchObject({ number: forDana.number, total: '50.00', balance: '50.00' });
  expect(one.lines).toEqual([expect.objectContaining({ description: 'Support', amount: '50.00' })]);
});

it('someone else\'s invoice is not found', async () => {
  const danaAgent = await portalAs(dana);
  expect((await danaAgent.get(`${P}/invoices/${forBoss.id}`)).status).toBe(404);
  const ottoAgent = await portalAs(otto);
  expect((await ottoAgent.get(`${P}/invoices/${forDana.id}`)).status).toBe(404);
  expect((await ottoAgent.get(`${P}/invoices/${forDana.id}/pdf`)).status).toBe(404);
  expect((await ottoAgent.post(`${P}/invoices/${forDana.id}/pay`).send({})).status).toBe(404);
});

it('the PDF, and paying online', async () => {
  const agent = await portalAs(dana);
  const pdf = await agent.get(`${P}/invoices/${forDana.id}/pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
  await models.SystemSettings.upsert({ key: 'money.stripeSecretKey', value: 'x' });
  const { url } = expectOk(await agent.post(`${P}/invoices/${forDana.id}/pay`).send({ amount: '1' }));
  expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  expect(fake.sessions[0].line_items[0].price_data.unit_amount).toBe(5000);
});

it('with Customer billing off, there are no invoices in the portal', async () => {
  await models.SystemSettings.upsert({ key: 'money.customerBilling', value: 'false' });
  expect((await (await portalAs(boss)).get(`${P}/invoices`)).status).toBe(404);
});
