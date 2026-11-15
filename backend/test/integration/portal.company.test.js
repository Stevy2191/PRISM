// Mail is recorded, not sent.
jest.mock('../../src/services/emailSender', () => ({
  ...jest.requireActual('../../src/services/emailSender'),
  sendMail: jest.fn(async () => ({})),
}));

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { resetData, closeDb, models, getApp } = require('./helpers');
const {
  API, makeWorld, makeCompany, makeContact, makeTicket, makeTech, expectOk, waitFor, slugAgent, openPortal, internalCompany,
} = require('./fixtures');
const { sendMail } = require('../../src/services/emailSender');

// Each company has its own portal (CS part 3): /portal/<slug>. Its contacts
// sign in there and nowhere else; a session is one company's; what a portal
// shows is that company's; an inactive company or a portal switched off is
// closed; every link PRISM sends is the contact's own company's.

const PASSWORD = 'Harbour-Lights-2026';
const mailsTo = (addr) => sendMail.mock.calls.map(([m]) => m).filter((m) => [].concat(m.to).includes(addr));
const at = (company) => `${API}/portal/c/${company.portalSlug}`;

let w; let acme; let globex; let ann; let gus; let hash;

async function signIn(contact, company) {
  const agent = slugAgent(company.portalSlug);
  expectOk(await agent.post(`${at(company)}/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}

beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });
beforeEach(async () => {
  await resetData();
  sendMail.mockClear();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'smtp.host', value: 'smtp.example' });
  await models.SystemSettings.upsert({ key: 'smtp.fromEmail', value: 'noreply@prism.example' });
  acme = await makeCompany(w.admin, { name: 'Acme Manufacturing' });
  globex = await makeCompany(w.admin, { name: 'Globex' });
  await openPortal(acme.id, globex.id);
  ann = await makeContact(w.admin, { firstName: 'Ann', companyId: acme.id });
  gus = await makeContact(w.admin, { firstName: 'Gus', companyId: globex.id });
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: [ann.id, gus.id] } });
});
afterAll(closeDb);

describe('links', () => {
  it('each company gets its own link from its name; a clash gets a number', async () => {
    expect(acme.portalSlug).toBe('acme-manufacturing');
    const second = await makeCompany(w.admin, { name: 'Acme  Manufacturing!' });
    expect(second.portalSlug).toBe('acme-manufacturing-2');
    expect(second.portalEnabled).toBe(false);
  });

  it('config names the company only while its portal is open; unknown and closed look the same', async () => {
    const open = expectOk(await request(getApp()).get(`${at(acme)}/config`));
    expect(open).toMatchObject({ enabled: true, company: { name: 'Acme Manufacturing', slug: 'acme-manufacturing' } });
    await models.Company.update({ portalEnabled: false }, { where: { id: acme.id } });
    const closed = expectOk(await request(getApp()).get(`${at(acme)}/config`));
    const unknown = expectOk(await request(getApp()).get(`${API}/portal/c/no-such-company/config`));
    expect(closed).toEqual(unknown);
    expect(closed).toMatchObject({ enabled: false, company: null });
  });

  it('renaming the link keeps the old one working, and nobody else can take it', async () => {
    const res = expectOk(await w.admin.agent.put(`${API}/companies/${acme.id}/portal`).send({ slug: 'acme' }));
    expect(res.portal).toMatchObject({ slug: 'acme', previousSlugs: ['acme-manufacturing'] });
    expect(expectOk(await request(getApp()).get(`${API}/portal/c/acme-manufacturing/config`)).company.slug).toBe('acme');
    // Sign in at the old link: same company.
    const old = slugAgent('acme-manufacturing');
    expectOk(await old.post(`${API}/portal/c/acme-manufacturing/auth/login`).send({ email: ann.email, password: PASSWORD }));
    expectOk(await old.get(`${API}/portal/c/acme/me`));
    // Taken, current or previous; reserved words and bad shapes.
    for (const slug of ['acme', 'acme-manufacturing']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.put(`${API}/companies/${globex.id}/portal`).send({ slug })).status).toBe(409);
    }
    for (const slug of ['tickets', 'c', '-bad', 'Has Space', 'x'.repeat(51)]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await w.admin.agent.put(`${API}/companies/${globex.id}/portal`).send({ slug })).status).toBe(400);
    }
    expect(await models.AuditLog.count({ where: { action: 'company.portal', entityId: acme.id } })).toBe(1);
  });
});

describe('isolation', () => {
  it("another company's contact is told exactly what a wrong password gets", async () => {
    const theirs = await slugAgent(acme.portalSlug).post(`${at(acme)}/auth/login`).send({ email: gus.email, password: PASSWORD });
    const wrong = await slugAgent(acme.portalSlug).post(`${at(acme)}/auth/login`).send({ email: ann.email, password: 'Not-It-At-All-9' });
    expect([theirs.status, theirs.body]).toEqual([wrong.status, wrong.body]);
    expect(theirs.body.code).toBe('INVALID_CREDENTIALS');
  });

  it("a session is one company's: signed in at Acme, nothing at Globex answers", async () => {
    const agent = await signIn(ann, acme);
    const gusTicket = await makeTicket(w.admin.agent, { title: 'Globex printer', contactId: gus.id });
    expectOk(await agent.get(`${at(acme)}/me`));
    for (const path of ['/me', '/meta', '/tickets', `/tickets/${gusTicket.id}`, '/kb/articles', '/kb/categories']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await agent.get(`${at(globex)}${path}`);
      expect([path, res.status]).toEqual([path, 401]);
    }
    // And through Acme's own address, Globex's ticket is not found.
    expect((await agent.get(`${at(acme)}/tickets/${gusTicket.id}`)).status).toBe(404);
    expect((await agent.post(`${at(acme)}/tickets/${gusTicket.id}/replies`).send({ body: 'hi' })).status).toBe(404);
    // Signed in at Acme still.
    expectOk(await agent.get(`${at(acme)}/me`));
  });

  it("invite and reset links work only at the contact's own company's portal", async () => {
    expectOk(await w.admin.agent.post(`${API}/contacts/${ann.id}/portal-invite`));
    await waitFor(() => mailsTo(ann.email).length === 1);
    const [mail] = mailsTo(ann.email);
    expect(mail.html).toContain(`/portal/${acme.portalSlug}/welcome?token=`);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.html)[1];
    const elsewhere = await request(getApp()).post(`${at(globex)}/auth/invite/check`).send({ token });
    expect([elsewhere.status, elsewhere.body.code]).toEqual([400, 'TOKEN_INVALID']);
    expectOk(await request(getApp()).post(`${at(acme)}/auth/invite/check`).send({ token }));

    sendMail.mockClear();
    await request(getApp()).post(`${at(globex)}/auth/forgot`).send({ email: ann.email });
    await new Promise((r) => { setTimeout(r, 200); });
    expect(mailsTo(ann.email)).toHaveLength(0);
    await request(getApp()).post(`${at(acme)}/auth/forgot`).send({ email: ann.email });
    await waitFor(() => mailsTo(ann.email).length === 1);
    expect(mailsTo(ann.email)[0].html).toContain(`/portal/${acme.portalSlug}/reset?token=`);
  });
});

describe('closing a portal', () => {
  it('switching it off, or making the company inactive, ends its sessions and refuses sign-in', async () => {
    for (const close of [{ portalEnabled: false }, { status: 'inactive' }]) {
      // eslint-disable-next-line no-await-in-loop
      const agent = await signIn(ann, acme);
      const other = await signIn(gus, globex); // eslint-disable-line no-await-in-loop
      const company = await models.Company.findByPk(acme.id); // eslint-disable-line no-await-in-loop
      await company.update(close); // eslint-disable-line no-await-in-loop
      const res = await agent.get(`${at(acme)}/me`); // eslint-disable-line no-await-in-loop
      expect([res.status, res.body.code]).toEqual([404, 'PORTAL_CLOSED']);
      const login = await slugAgent(acme.portalSlug).post(`${at(acme)}/auth/login`).send({ email: ann.email, password: PASSWORD }); // eslint-disable-line no-await-in-loop
      expect(login.status).toBe(404);
      // Globex is untouched.
      expectOk(await other.get(`${at(globex)}/me`)); // eslint-disable-line no-await-in-loop
      await company.update({ portalEnabled: true, status: 'active' }); // eslint-disable-line no-await-in-loop
      // The session itself was ended, not just refused while closed.
      expect((await agent.get(`${at(acme)}/me`)).status).toBe(401); // eslint-disable-line no-await-in-loop
    }
  });

  it("a contact moved to another company is signed out of the old one's portal", async () => {
    const agent = await signIn(ann, acme);
    await models.Contact.update({ companyId: globex.id }, { where: { id: ann.id } });
    expect((await agent.get(`${at(acme)}/me`)).status).toBe(401);
  });
});

describe('the plain /portal address', () => {
  it("with customers it names no company; with only your own it is your company's portal, once open", async () => {
    expect(expectOk(await request(getApp()).get(`${API}/portal/home`)).slug).toBeNull();
    await models.Company.destroy({ where: { id: [acme.id, globex.id] } });
    expect(expectOk(await request(getApp()).get(`${API}/portal/home`)).slug).toBeNull(); // yours is off
    await openPortal((await internalCompany()).id);
    expect(expectOk(await request(getApp()).get(`${API}/portal/home`)).slug).toBe((await internalCompany()).portalSlug);
  });

  it('"email me my link" answers the same for anyone, and mails only a contact who can sign in', async () => {
    const known = await request(getApp()).post(`${API}/portal/link`).send({ email: ann.email });
    const unknown = await request(getApp()).post(`${API}/portal/link`).send({ email: 'nobody@example.com' });
    expect([known.status, known.body]).toEqual([unknown.status, unknown.body]);
    expect(known.status).toBe(202);
    await waitFor(() => mailsTo(ann.email).length === 1);
    expect(mailsTo(ann.email)[0].html).toContain(`/portal/${acme.portalSlug}`);
    // Portal off: nothing sent.
    await models.Company.update({ portalEnabled: false }, { where: { id: globex.id } });
    sendMail.mockClear();
    await request(getApp()).post(`${API}/portal/link`).send({ email: gus.email });
    await new Promise((r) => { setTimeout(r, 200); });
    expect(mailsTo(gus.email)).toHaveLength(0);
  });
});

describe("the company's Portal part", () => {
  it('lists who can sign in, and invites everyone without access', async () => {
    const cal = await makeContact(w.admin, { firstName: 'Cal', companyId: acme.id });
    await makeContact(w.admin, { firstName: 'Nomail', companyId: acme.id, email: null });
    const before = expectOk(await w.admin.agent.get(`${API}/companies/${acme.id}/portal`));
    expect(before.portal).toMatchObject({ enabled: true, open: true, slug: acme.portalSlug, url: expect.stringContaining(`/portal/${acme.portalSlug}`) });
    expect(before.contacts.map((c) => [c.name, c.portalAccess, c.signInMethod])).toEqual(expect.arrayContaining([
      [expect.stringContaining('Ann'), true, 'password'], [expect.stringContaining('Cal'), false, null],
    ]));
    const res = expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/portal/invite-all`));
    expect([res.invited, res.failed]).toEqual([1, []]);
    await waitFor(() => mailsTo(cal.email).length === 1);
    expect((await models.Contact.findByPk(cal.id)).portalAccess).toBe(true);
    expect(res.contacts.find((c) => c.id === cal.id).invitedAt).not.toBeNull();
  });

  it('needs Manage portal access to change; an invite to a closed portal is refused', async () => {
    const tech = await makeTech('tess', w.deptA.id);
    expectOk(await tech.agent.get(`${API}/companies/${acme.id}/portal`));
    expect((await tech.agent.put(`${API}/companies/${acme.id}/portal`).send({ enabled: false })).status).toBe(403);
    expect((await tech.agent.post(`${API}/companies/${acme.id}/portal/invite-all`)).status).toBe(403);
    expect((await tech.agent.put(`${API}/companies/${acme.id}/surveys`).send({ enabled: false })).status).toBe(403);
    expectOk(await w.admin.agent.put(`${API}/companies/${acme.id}/portal`).send({ enabled: false }));
    const invite = await w.admin.agent.post(`${API}/contacts/${ann.id}/portal-invite`);
    expect([invite.status, invite.body.code]).toEqual([409, 'PORTAL_CLOSED']);
    expect((await w.admin.agent.post(`${API}/companies/${acme.id}/portal/invite-all`)).status).toBe(409);
  });
});

describe('surveys', () => {
  it("follow each company's own switch", async () => {
    const tech = await makeTech('tara', w.deptA.id);
    const close = async (contact) => {
      const t = await makeTicket(w.admin.agent, { title: `For ${contact.firstName}`, contactId: contact.id, assigneeId: tech.user.id });
      expectOk(await w.admin.agent.patch(`${API}/tickets/${t.id}`).send({ status: 'Closed' }));
      return models.CsatSurvey.findOne({ where: { ticketId: t.id } });
    };
    // New companies start with surveys on.
    expect(await close(ann)).not.toBeNull();
    const res = expectOk(await w.admin.agent.put(`${API}/companies/${acme.id}/surveys`).send({ enabled: false }));
    expect(res.portal.surveys).toBe(false);
    expect(res.surveyScores).toMatchObject({ days: 90 });
    expect(await close(ann)).toBeNull();
    expect(await close(gus)).not.toBeNull();
  });
});
