const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  makeWorld, makeContact, makeCompany, makeTech, setCompanyAccess, expectOk,
} = require('./fixtures');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');

// Sub-project 7a, task 6: the knowledge base lives in the portal, by
// audience, and the anonymous /kb is gone.

const API = '/api/v1';
const K = `${API}/portal/kb`;
const PASSWORD = 'Harbour-Lights-2026';
let seq = 0;

let w; let alpha; let beta; let reception; let pat; let rita; let otto;
let hash;

async function portalAs(contact) {
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: contact.id } });
  const agent = request.agent(getApp());
  expectOk(await agent.post(`${API}/portal/auth/login`).send({ email: contact.email, password: PASSWORD }));
  return agent;
}
const article = async (title, extra = {}) => {
  seq += 1;
  return expectOk(await w.admin.agent.post(`${API}/knowledge/articles`).send({
    title: `${title} ${seq}`, body: `<p>${title} body</p>`, status: 'published', visibility: 'portal', ...extra,
  }), 201).article;
};

beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });
beforeEach(async () => {
  await resetData();
  await models.KbArticle.destroy({ where: {} });
  await models.KbCategory.destroy({ where: {} });
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Alpha' });
  beta = await makeCompany(w.admin, { name: 'Beta' });
  const billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  reception = expectOk(await a.post(`${API}/departments`).send({ name: 'Reception', companyId: alpha.id }), 201).department;
  pat = await makeContact(w.admin, { firstName: 'Pat', companyId: alpha.id, departmentId: billing.id });
  rita = await makeContact(w.admin, { firstName: 'Rita', companyId: alpha.id, departmentId: reception.id });
  otto = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id });
});
afterAll(async () => {
  await models.KbArticle.destroy({ where: {} });
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await closeDb();
});

it('the anonymous /kb is gone; the portal KB needs a contact session', async () => {
  await article('Everyone');
  for (const url of [`${API}/kb/articles`, `${API}/kb/categories`]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(getApp()).get(url);
    expect(res.status).not.toBe(200);
  }
  expect((await request(getApp()).get(`${K}/articles`)).status).toBe(401);
  expect((await w.admin.agent.get(`${K}/articles`)).status).toBe(401);
});

it('lists, reads and downloads only what my audience covers', async () => {
  const cat = expectOk(await w.admin.agent.post(`${API}/knowledge/categories`).send({ name: 'Email' }), 201).category;
  const everyone = await article('Everyone', { categoryId: cat.id });
  const alphaOnly = await article('Alpha only', { portalScope: 'companies', audience: { companyIds: [alpha.id] }, categoryId: cat.id });
  const receptionOnly = await article('Reception only', { portalScope: 'departments', audience: { departmentIds: [reception.id] }, categoryId: cat.id });
  await article('Draft', { status: 'draft', categoryId: cat.id });
  await article('Internal', { visibility: 'internal', categoryId: cat.id });

  const titles = async (agent, qs = '') => expectOk(await agent.get(`${K}/articles${qs}`)).articles.map((x) => x.title).sort();
  const p = await portalAs(pat);
  const r = await portalAs(rita);
  const o = await portalAs(otto);
  expect(await titles(p)).toEqual([alphaOnly.title, everyone.title].sort());
  expect(await titles(r)).toEqual([alphaOnly.title, everyone.title, receptionOnly.title].sort());
  expect(await titles(o)).toEqual([everyone.title]);
  expect(await titles(r, '?q=Reception')).toEqual([receptionOnly.title]);
  expect(await titles(r, '?q=%25')).toEqual([]);
  expect(await titles(r, `?category=${cat.slug}`)).toHaveLength(3);

  // Category counts count only what I can read.
  const cats = expectOk(await o.get(`${K}/categories`)).categories;
  expect(cats).toEqual([expect.objectContaining({ id: cat.id, articleCount: 1 })]);
  expect(expectOk(await r.get(`${K}/categories`)).categories[0].articleCount).toBe(3);

  // Out of my audience: 404, attachments too.
  expectOk(await o.get(`${K}/articles/${everyone.slug}`));
  expect((await o.get(`${K}/articles/${alphaOnly.slug}`)).status).toBe(404);
  const dir = path.join(UPLOAD_ROOT, 'knowledge', String(alphaOnly.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'guide.txt'), 'guide');
  const file = await models.KbAttachment.create({ articleId: alphaOnly.id, filename: 'guide.txt', originalName: 'guide.txt', size: 5 });
  expect((await o.get(`${K}/articles/${alphaOnly.slug}/attachments/${file.id}/download`)).status).toBe(404);
  expect((await o.get(`${K}/articles/${everyone.slug}/attachments/${file.id}/download`)).status).toBe(404);
  const dl = await p.get(`${K}/articles/${alphaOnly.slug}/attachments/${file.id}/download`);
  expect(dl.status).toBe(200);
  const read = expectOk(await p.get(`${K}/articles/${alphaOnly.slug}`)).article;
  expect(read.attachments.map((x) => x.originalName)).toEqual(['guide.txt']);
  expect(read).not.toHaveProperty('authorId');
  expect(read).not.toHaveProperty('portalScope');
});

it('staff save and read back the audience; unknown or unreachable ids are refused', async () => {
  const a = w.admin.agent;
  const art = await article('Scoped', { portalScope: 'companies', audience: { companyIds: [alpha.id, beta.id] } });
  let read = expectOk(await a.get(`${API}/knowledge/articles/${art.id}`)).article;
  expect(read.portalScope).toBe('companies');
  expect(read.audience).toEqual({ companyIds: [alpha.id, beta.id].sort((x, y) => x - y), departmentIds: [] });

  expectOk(await a.patch(`${API}/knowledge/articles/${art.id}`).send({ portalScope: 'departments', audience: { departmentIds: [reception.id] } }));
  read = expectOk(await a.get(`${API}/knowledge/articles/${art.id}`)).article;
  expect(read.audience).toEqual({ companyIds: [], departmentIds: [reception.id] });
  expectOk(await a.patch(`${API}/knowledge/articles/${art.id}`).send({ portalScope: 'all' }));
  expect(await models.KbArticleAudience.count({ where: { articleId: art.id } })).toBe(0);

  expect((await a.post(`${API}/knowledge/articles`).send({ title: 'x', portalScope: 'companies', audience: { companyIds: [999999] } })).status).toBe(400);
  expect((await a.post(`${API}/knowledge/articles`).send({ title: 'x', portalScope: 'nonsense' })).status).toBe(400);
  expect((await a.post(`${API}/knowledge/articles`).send({ title: 'x', portalScope: 'companies', audience: { companyIds: ['12abc'] } })).status).toBe(400);

  // A KB manager fenced to Beta can't aim an article at Alpha.
  const tech = await makeTech('kim', w.deptA.id);
  expectOk(await a.post(`${API}/users/${tech.user.id}/overrides`).send({ permissionKey: 'kb.manage', granted: true }), 201);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [beta.id] });
  expect((await tech.agent.post(`${API}/knowledge/articles`).send({ title: 'y', portalScope: 'companies', audience: { companyIds: [alpha.id] } })).status).toBe(400);
});
