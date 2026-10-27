const { resetData, closeDb, models } = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTicket, expectOk,
} = require('./fixtures');
const {
  portalTicketWhere, canSeeTicket, forContacts, portalArticleWhere,
} = require('../../src/services/portal/scope');

// Sub-project 7a, task 3: one scoping service for everything a contact sees.

const API = '/api/v1';
let w;
let alpha; let beta; let billing; let reception; let betaDept;
let plain; let deptAdmin; let companyAdmin; let watcher; let receptionist; let inactive; let outsider;
let tPlain; let tRaised; let tWatched; let tReception; let tBeta; let tBilling2;

const ids = async (contact, scope) => (await models.Ticket.findAll({ where: await portalTicketWhere(contact, scope), attributes: ['id'], order: [['id', 'ASC']] })).map((t) => t.id);
const contactRow = (c) => models.Contact.findByPk(c.id);

beforeAll(async () => {
  await resetData();
  w = await makeWorld();
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  beta = await makeCompany(w.admin, { name: 'Beta' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  reception = expectOk(await a.post(`${API}/departments`).send({ name: 'Reception', companyId: alpha.id }), 201).department;
  betaDept = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: beta.id }), 201).department;
  const inAlpha = (firstName, departmentId) => makeContact(w.admin, { firstName, companyId: alpha.id, departmentId });
  plain = await inAlpha('Pat', billing.id);
  deptAdmin = await inAlpha('Dana', billing.id);
  companyAdmin = await inAlpha('Cora', reception.id);
  watcher = await inAlpha('Wes', reception.id);
  receptionist = await inAlpha('Rita', reception.id);
  inactive = await inAlpha('Ivy', billing.id);
  await models.Contact.update({ status: 'inactive' }, { where: { id: inactive.id } });
  outsider = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id, departmentId: betaDept.id });

  tPlain = await makeTicket(a, { title: 'Pat printer', contactId: plain.id });
  tRaised = await makeTicket(a, { title: 'Raised by Pat for Rita', contactId: receptionist.id });
  await models.Ticket.update({ portalCreatedByContactId: plain.id }, { where: { id: tRaised.id } });
  tWatched = await makeTicket(a, { title: 'Rita, watched by Wes', contactId: receptionist.id });
  await models.TicketWatcher.create({ ticketId: tWatched.id, contactId: watcher.id });
  tReception = await makeTicket(a, { title: 'Rita alone', contactId: receptionist.id });
  tBilling2 = await makeTicket(a, { title: 'Dana billing', contactId: deptAdmin.id });
  tBeta = await makeTicket(a, { title: 'Beta business', contactId: outsider.id });

  await models.DepartmentPortalAdmin.create({ departmentId: billing.id, contactId: deptAdmin.id });
  await models.CompanyPortalAdmin.create({ companyId: alpha.id, contactId: companyAdmin.id });
});
afterAll(closeDb);

it('a plain contact sees their own tickets and the ones they raised for someone', async () => {
  const me = await contactRow(plain);
  expect(await ids(me, 'all')).toEqual([tPlain.id, tRaised.id]);
  expect(await ids(me, 'mine')).toEqual([tPlain.id, tRaised.id]);
  expect(await ids(me, 'company')).toEqual([]);
  expect(await ids(me, 'department')).toEqual([]);
});

it('a watcher also sees the watched ticket, under "watching"', async () => {
  const me = await contactRow(watcher);
  expect(await ids(me, 'all')).toEqual([tWatched.id]);
  expect(await ids(me, 'watching')).toEqual([tWatched.id]);
  expect(await ids(me, 'mine')).toEqual([]);
});

it('a department admin sees their department, not the other one', async () => {
  const me = await contactRow(deptAdmin);
  expect(await ids(me, 'department')).toEqual([tPlain.id, tBilling2.id]);
  expect(await ids(me, 'all')).toEqual([tPlain.id, tBilling2.id]);
  expect(await ids(me, 'company')).toEqual([]);
});

it('a company admin sees every ticket of their company and none of another', async () => {
  const me = await contactRow(companyAdmin);
  expect(await ids(me, 'company')).toEqual([tPlain.id, tRaised.id, tWatched.id, tReception.id, tBilling2.id]);
  expect(await ids(me, 'all')).not.toContain(tBeta.id);
});

it('canSeeTicket refuses every other-company ticket id, and junk ids', async () => {
  for (const c of [plain, deptAdmin, companyAdmin, watcher]) {
    // eslint-disable-next-line no-await-in-loop
    expect(await canSeeTicket(await contactRow(c), tBeta.id)).toBe(false);
  }
  expect(await canSeeTicket(await contactRow(outsider), tBeta.id)).toBe(true);
  expect(await canSeeTicket(await contactRow(outsider), tPlain.id)).toBe(false);
  expect(await canSeeTicket(await contactRow(plain), tPlain.id)).toBe(true);
  expect(await canSeeTicket(await contactRow(plain), tReception.id)).toBe(false);
  for (const junk of [`${tPlain.id}abc`, '1 OR 1=1', null, -1, 0]) {
    // eslint-disable-next-line no-await-in-loop
    expect(await canSeeTicket(await contactRow(plain), junk)).toBe(false);
  }
});

it('admin and watcher rows never reach across companies', async () => {
  // Rows pointing at another company (stale after a move, or bad data).
  const rogueDept = await models.DepartmentPortalAdmin.create({ departmentId: betaDept.id, contactId: plain.id });
  const rogueCo = await models.CompanyPortalAdmin.create({ companyId: beta.id, contactId: plain.id });
  const rogueWatch = await models.TicketWatcher.create({ ticketId: tBeta.id, contactId: plain.id });
  try {
    const me = await contactRow(plain);
    expect(await ids(me, 'all')).toEqual([tPlain.id, tRaised.id]);
    expect(await canSeeTicket(me, tBeta.id)).toBe(false);
    expect((await forContacts(me)).map((c) => c.id)).toEqual([plain.id]);
  } finally {
    await Promise.all([rogueDept.destroy(), rogueCo.destroy(), rogueWatch.destroy()]);
  }
});

it('forContacts: self; department admins their department; company admins the company; never inactive or other companies', async () => {
  const idsOf = async (c) => (await forContacts(await contactRow(c))).map((x) => x.id).sort((x, y) => x - y);
  expect(await idsOf(plain)).toEqual([plain.id]);
  expect(await idsOf(deptAdmin)).toEqual([plain.id, deptAdmin.id].sort((x, y) => x - y));
  expect(await idsOf(companyAdmin)).toEqual([plain.id, deptAdmin.id, companyAdmin.id, watcher.id, receptionist.id].sort((x, y) => x - y));
  expect(await idsOf(companyAdmin)).not.toContain(inactive.id);
  const fields = (await forContacts(await contactRow(companyAdmin)))[0].toJSON();
  expect(fields).not.toHaveProperty('passwordHash');
  expect(fields).not.toHaveProperty('notes');
});

it('articles: all for everyone, companies and departments only for their audience, drafts and internal never', async () => {
  const slug = (s) => `${s}-${Date.now()}`;
  const mk = (title, extra) => models.KbArticle.create({ title, slug: slug(title.toLowerCase().replace(/\s/g, '-')), status: 'published', visibility: 'portal', ...extra });
  const everyone = await mk('Everyone', {});
  const alphaOnly = await mk('Alpha only', { portalScope: 'companies' });
  await models.KbArticleAudience.create({ articleId: alphaOnly.id, companyId: alpha.id });
  const receptionOnly = await mk('Reception only', { portalScope: 'departments' });
  await models.KbArticleAudience.create({ articleId: receptionOnly.id, departmentId: reception.id });
  const draft = await mk('Draft', { status: 'draft' });
  const internal = await mk('Internal', { visibility: 'internal' });
  const nobody = await mk('Chosen nobody', { portalScope: 'companies' });
  try {
    const titles = async (c) => (await models.KbArticle.findAll({ where: portalArticleWhere(await contactRow(c)), order: [['id', 'ASC']] })).map((x) => x.title);
    expect(await titles(plain)).toEqual(['Everyone', 'Alpha only']);
    expect(await titles(receptionist)).toEqual(['Everyone', 'Alpha only', 'Reception only']);
    expect(await titles(outsider)).toEqual(['Everyone']);
  } finally {
    await models.KbArticle.destroy({ where: { id: [everyone.id, alphaOnly.id, receptionOnly.id, draft.id, internal.id, nobody.id] } });
  }
});
