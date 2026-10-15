// Outbound email is recorded, not sent (see tickets.comments.test.js).
jest.mock('../../src/services/emailSender');
jest.mock('../../src/services/calendarPush');

const { resetData, closeDb, models, createUserAndLogin, ROLE } = require('./helpers');
const { sendMail } = require('../../src/services/emailSender');
const {
  API, expectOk, makeWorld, makeTech, makeTicket, makeCompany, makeContact, setCompanyAccess, waitFor,
} = require('./fixtures');

// A ticket's CC list gets every public reply; a reply can add one-off CC and
// BCC. Anyone who can edit the ticket manages the list; viewers see it.

let w;
let tech;
let ticket;
const settle = () => new Promise((r) => { setTimeout(r, 200); });
const ccUrl = (t = ticket) => `${API}/tickets/${t.id}/ccs`;
const commentsUrl = () => `${API}/tickets/${ticket.id}/comments`;
const addCc = (agent, email) => agent.post(ccUrl()).send({ email });

beforeEach(async () => {
  await resetData();
  sendMail.mockReset();
  w = await makeWorld();
  tech = await makeTech('tina', w.deptA.id);
  ticket = await makeTicket(w.admin.agent, {
    title: 'Printer offline', contactId: w.contact.id, departmentId: w.deptA.id, assigneeId: tech.user.id,
  });
  await models.SystemSettings.upsert({ key: 'inboundEmail.address', value: 'Help@Prism.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
});
afterAll(closeDb);

it('a public reply goes to contact + ticket CCs + one-off CC, BCC only in bcc', async () => {
  expectOk(await addCc(tech.agent, 'Boss@Acme.com'), 201);
  expectOk(await addCc(tech.agent, 'help@prism.example'), 201); // stored, but never mailed
  const c = expectOk(await tech.agent.post(commentsUrl()).send({
    body: 'Fixed', emailCc: ['carl@acme.com', w.contact.email], emailBcc: 'dee@acme.com, boss@acme.com',
  }), 201).comment;
  await waitFor(() => sendMail.mock.calls.length === 1);
  const mail = sendMail.mock.calls[0][0];
  expect(mail.to).toEqual([w.contact.email]);
  expect(mail.cc).toEqual(['boss@acme.com', 'carl@acme.com']);
  expect(mail.bcc).toEqual(['dee@acme.com']);
  expect(JSON.stringify([mail.to, mail.cc])).not.toContain('dee@');
  const stored = await models.Comment.findByPk(c.id);
  expect([stored.emailCc, stored.emailBcc]).toEqual([['carl@acme.com'], ['dee@acme.com']]);
});

it('a bad one-off address is a 400 and nothing is saved', async () => {
  const res = await tech.agent.post(commentsUrl()).send({ body: 'x', emailCc: ['not an email'] });
  expect(res.status).toBe(400);
  expect(await models.Comment.count()).toBe(0);
});

it('private notes are never emailed and reject emailCc', async () => {
  expectOk(await addCc(tech.agent, 'boss@acme.com'), 201);
  expectOk(await tech.agent.post(commentsUrl()).send({ body: 'internal', type: 'comment_private' }), 201);
  for (const extra of [{ emailCc: ['x@acme.com'] }, { emailBcc: ['x@acme.com'] }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await tech.agent.post(commentsUrl()).send({ body: 'internal', type: 'comment_private', ...extra });
    expect(res.status).toBe(400);
  }
  await settle();
  expect(sendMail).not.toHaveBeenCalled();
});

it('view-only users list CCs but cannot add or remove', async () => {
  const cc = expectOk(await addCc(tech.agent, 'boss@acme.com'), 201).cc;
  const viewer = await createUserAndLogin({ username: 'val', roleName: ROLE.READ_ONLY, departmentId: w.deptA.id });
  expect(expectOk(await viewer.agent.get(ccUrl())).ccs.map((c) => c.email)).toEqual(['boss@acme.com']);
  expect((await addCc(viewer.agent, 'x@acme.com')).status).toBe(403);
  expect((await viewer.agent.delete(`${ccUrl()}/${cc.id}`)).status).toBe(403);
  expect(await models.TicketCc.count()).toBe(1);
});

it('a ticket the user cannot see looks missing', async () => {
  const acme = await makeCompany(w.admin);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [] });
  const contact = await makeContact(w.admin, { companyId: acme.id });
  const hidden = await makeTicket(w.admin.agent, { title: 'Hidden', contactId: contact.id });
  for (const res of [await tech.agent.get(ccUrl(hidden)), await tech.agent.post(ccUrl(hidden)).send({ email: 'a@b.com' }), await tech.agent.get(`${API}/tickets/abc/ccs`)]) {
    expect(res.status).toBe(404);
  }
});

it('CC list cap and duplicate', async () => {
  expectOk(await addCc(tech.agent, 'dup@acme.com'), 201);
  expect((await addCc(tech.agent, 'DUP@acme.com')).status).toBe(409);
  expect((await addCc(tech.agent, 'bad')).status).toBe(400);
  for (let i = 1; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(await addCc(tech.agent, `p${i}@acme.com`), 201);
  }
  expect((await addCc(tech.agent, 'p21@acme.com')).status).toBe(400);
  const one = await models.TicketCc.findOne({ where: { email: 'p1@acme.com' } });
  expectOk(await tech.agent.delete(`${ccUrl()}/${one.id}`));
  expect(await models.TicketCc.count()).toBe(19);
  expect(await models.AuditLog.count({ where: { action: 'ticketCc.add' } })).toBe(20);
  expect(await models.AuditLog.count({ where: { action: 'ticketCc.remove' } })).toBe(1);
  // A CC id from another ticket isn't found through this one.
  const other = await makeTicket(w.admin.agent, { title: 'Other', contactId: w.contact.id, departmentId: w.deptA.id });
  const theirs = expectOk(await w.admin.agent.post(ccUrl(other)).send({ email: 'z@acme.com' }), 201).cc;
  expect((await tech.agent.delete(`${ccUrl()}/${theirs.id}`)).status).toBe(404);
});

it('an inaccessible contact with that email is not linked', async () => {
  const acme = await makeCompany(w.admin);
  const hidden = await makeContact(w.admin, { companyId: acme.id, email: 'secret@acme.com' });
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [ticket.companyId] });
  const cc = expectOk(await addCc(tech.agent, 'secret@acme.com'), 201).cc;
  expect(cc.contact).toBeNull();
  expect((await models.TicketCc.findByPk(cc.id)).contactId).toBeNull();
  // Someone who can see it gets the link.
  const visible = expectOk(await w.admin.agent.post(ccUrl()).send({ email: w.contact.email }), 201).cc;
  expect(visible.contact).toEqual({ id: w.contact.id, name: expect.any(String) });
  expect(hidden.id).not.toBe(w.contact.id);
});

it('SMTP not configured: the reply still saves (201)', async () => {
  sendMail.mockImplementation(async () => {
    const e = new Error('Outgoing email is not set up yet'); e.code = 'SMTP_NOT_CONFIGURED'; throw e;
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expectOk(await tech.agent.post(commentsUrl()).send({ body: 'still saved' }), 201);
    await waitFor(() => sendMail.mock.calls.length === 1);
    await settle();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('contact_tech_reply'), expect.stringContaining('not set up'));
  } finally {
    spy.mockRestore();
  }
  expect(await models.Comment.count()).toBe(1);
});
