// Mail is recorded, not sent.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));

const { resetData, closeDb, models } = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTicket, expectOk, waitFor,
} = require('./fixtures');
const { sendMail } = require('../../src/services/emailSender');

// Sub-project 7a, task 7: ticket emails link to the portal, but only for
// recipients who can see the ticket there.

const API = '/api/v1';
let w; let alpha; let pat; let rita; let wes; let t;

const copies = () => sendMail.mock.calls.map(([m]) => m);
const recipientsOf = (m) => (m.envelopeTo || [...[].concat(m.to || []), ...[].concat(m.cc || []), ...[].concat(m.bcc || [])])
  .map((a) => a.toLowerCase());
const copyFor = (addr) => {
  const found = copies().filter((m) => recipientsOf(m).includes(addr.toLowerCase()));
  expect(found).toHaveLength(1);
  return found[0];
};
const hasLink = (m) => m.html.includes(`/portal/tickets/${t.id}`) && m.text.includes(`/portal/tickets/${t.id}`);
const access = (c, on) => models.Contact.update({ portalAccess: on }, { where: { id: c.id } });

async function reply(extra = {}) {
  sendMail.mockClear();
  expectOk(await w.admin.agent.post(`${API}/tickets/${t.id}/comments`).send({
    body: 'We have ordered the part', type: 'comment_public', emailCc: [rita.email, wes.email, 'boss@outside.example'], ...extra,
  }), 201);
  await waitFor(() => copies().length > 0);
  await new Promise((r) => { setTimeout(r, 150); });
}

beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  pat = await makeContact(w.admin, { firstName: 'Pat', companyId: alpha.id });
  rita = await makeContact(w.admin, { firstName: 'Rita', companyId: alpha.id });
  wes = await makeContact(w.admin, { firstName: 'Wes', companyId: alpha.id });
  t = await makeTicket(w.admin.agent, { title: 'Printer', contactId: pat.id });
  await models.TicketWatcher.create({ ticketId: t.id, contactId: wes.id });
});
afterAll(async () => {
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await closeDb();
});

it('links only for recipients who can see the ticket in the portal; the headers stay the same', async () => {
  await Promise.all([access(pat, true), access(rita, true), access(wes, true)]);
  await reply();
  expect(hasLink(copyFor(pat.email))).toBe(true);
  expect(hasLink(copyFor(wes.email))).toBe(true); // a contact watcher
  expect(hasLink(copyFor(rita.email))).toBe(false); // CC'd, can't see it
  expect(hasLink(copyFor('boss@outside.example'))).toBe(false);
  // Everyone sees the same To and Cc, so reply-all still reaches everyone.
  const headers = copies().map((m) => JSON.stringify([m.to, m.cc]));
  expect(new Set(headers).size).toBe(1);
  expect(copies()).toHaveLength(2);
});

it('no portal access, or the portal switched off: no link at all, one email', async () => {
  await reply();
  expect(copies()).toHaveLength(1);
  expect(hasLink(copies()[0])).toBe(false);

  await Promise.all([access(pat, true), access(wes, true)]);
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await reply();
  expect(copies()).toHaveLength(1);
  expect(hasLink(copies()[0])).toBe(false);
});

it('everyone can see it: one email, with the link', async () => {
  await access(pat, true);
  await reply({ emailCc: [] });
  expect(copies()).toHaveLength(1);
  expect(hasLink(copyFor(pat.email))).toBe(true);
});
