const bcrypt = require('bcryptjs');
const { resetData, closeDb, models } = require('../integration/helpers');
const {
  API, expectOk, makeWorld, makeTicket, makeCompany, makeContact,
} = require('../integration/fixtures');
const { startSmoke } = require('./harness');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { issuePortalToken } = require('../../src/services/portal/tokens');

// Sub-project 7a: the client portal screens, signed in as contacts.

const PHONE = { viewport: { width: 375, height: 812 } };
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const PASSWORD = 'Harbour-Lights-2026';
const KB_PREFIX = 'Portal smoke';

let smoke;
let w; let alpha; let beta; let billing;
let pat; let dana; let invited; let otto;
let patTicket;
const seeded = {};

async function clearOwn() {
  await models.KbArticle.destroy({ where: { title: { [require('sequelize').Op.like]: `${KB_PREFIX}%` } } });
}

beforeAll(async () => {
  smoke = await startSmoke();
  await resetData();
  await clearOwn();
  w = await makeWorld();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'true' });
  const a = w.admin.agent;
  alpha = await makeCompany(w.admin, { name: 'Riverside Family Clinic and Associated Practices of the Greater Valley' });
  beta = await makeCompany(w.admin, { name: 'Beta Builders' });
  billing = expectOk(await a.post(`${API}/departments`).send({ name: 'Billing', companyId: alpha.id }), 201).department;
  pat = await makeContact(w.admin, { firstName: 'Pat', lastName: 'Plain', companyId: alpha.id, departmentId: billing.id });
  dana = await makeContact(w.admin, { firstName: 'Dana', lastName: 'Admin', companyId: alpha.id, departmentId: billing.id });
  invited = await makeContact(w.admin, { firstName: 'Ivan', lastName: 'Invited', companyId: alpha.id });
  otto = await makeContact(w.admin, { firstName: 'Otto', companyId: beta.id });
  const hash = await bcrypt.hash(PASSWORD, 4);
  await models.Contact.scope('withPassword').update({ portalAccess: true, passwordHash: hash }, { where: { id: [pat.id, dana.id, otto.id] } });
  await models.Contact.update({ portalAccess: true }, { where: { id: invited.id } });
  await models.DepartmentPortalAdmin.create({ departmentId: billing.id, contactId: dana.id });
  patTicket = await makeTicket(a, { title: 'Pat laptop will not start', contactId: pat.id });
  expectOk(await a.post(`${API}/tickets/${patTicket.id}/comments`).send({ body: 'Have you tried the power cable?', type: 'comment_public' }), 201);
  expectOk(await a.post(`${API}/tickets/${patTicket.id}/comments`).send({ body: 'Internal: order a new PSU', type: 'comment_private' }), 201);
  const art = async (title, extra = {}) => expectOk(await a.post(`${API}/knowledge/articles`).send({
    title: `${KB_PREFIX} ${title}`, body: `<p>${title} ${'word '.repeat(60)}</p>`, status: 'published', visibility: 'portal', ...extra,
  }), 201).article;
  seeded.everyone = await art('Everyone');
  seeded.alphaOnly = await art('Riverside only', { portalScope: 'companies', audience: { companyIds: [alpha.id] } });
  seeded.betaOnly = await art('Beta only', { portalScope: 'companies', audience: { companyIds: [beta.id] } });
});
afterAll(async () => {
  await clearOwn();
  await models.SystemSettings.upsert({ key: 'portal.enabled', value: 'false' });
  await smoke.stop();
  await closeDb();
});
beforeEach(resetRateLimits);

async function contactPage(contact, options = DESKTOP) {
  const context = await smoke.browser.newContext({ baseURL: smoke.base, ...options });
  if (contact) {
    const res = await context.request.post('/api/v1/portal/auth/login', { data: { email: contact.email, password: PASSWORD } });
    if (!res.ok()) throw new Error(`portal login failed for ${contact.email}: ${res.status()}`);
  }
  return context.newPage();
}

describe.each([['desktop', DESKTOP], ['phone', PHONE]])('%s', (_name, size) => {
  it('sign in, see own tickets, raise one, reply, sign out', async () => {
    const page = await contactPage(null, size);
    await page.goto('/portal');
    await page.waitForURL(/\/portal\/sign-in/);
    await page.getByLabel('Email').fill(pat.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await page.getByRole('heading', { name: 'Tickets', exact: true }).waitFor();
    await page.getByRole('link', { name: /Pat laptop will not start/ }).first().waitFor();

    await page.getByRole('link', { name: /New/ }).first().click();
    await page.getByLabel(/^Title/).fill(`Monitor flickers (${_name})`);
    await page.getByLabel(/^Description/).fill('Since this morning the screen flickers.');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await page.getByRole('heading', { name: `Monitor flickers (${_name})` }).waitFor();

    const collapsed = page.getByRole('button', { name: /^Reply/ });
    if (await collapsed.count()) await collapsed.first().click();
    await page.getByLabel('Reply', { exact: true }).fill('Still flickering after a restart');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await page.getByText('Still flickering after a restart').waitFor();

    const menu = page.getByRole('button', { name: 'Menu' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/portal\/sign-in/);
    await page.context().close();
  });
});

it('a ticket shows public replies, never private comments', async () => {
  const page = await contactPage(pat);
  await page.goto(`/portal/tickets/${patTicket.id}`);
  await page.getByText('Have you tried the power cable?').waitFor();
  expect(await page.getByText('Internal: order a new PSU').count()).toBe(0);
  await page.context().close();
});

it('a department admin sees the Billing department pill and can raise a ticket For a Billing contact', async () => {
  const page = await contactPage(dana);
  await page.goto('/portal/tickets');
  await page.getByRole('button', { name: 'Billing department' }).click();
  await page.getByRole('link', { name: /Pat laptop will not start/ }).first().waitFor();
  await page.goto('/portal/tickets/new');
  await page.getByLabel(/^For/).selectOption({ label: 'Pat Plain' });
  await page.getByLabel(/^Title/).fill('Raised by Dana for Pat');
  await page.getByLabel(/^Description/).fill('Pat asked me to log this.');
  await page.getByRole('button', { name: 'Create ticket' }).click();
  await page.getByRole('heading', { name: 'Raised by Dana for Pat' }).waitFor();
  const t = await models.Ticket.findOne({ where: { title: 'Raised by Dana for Pat' } });
  expect([t.contactId, t.portalCreatedByContactId, t.source]).toEqual([pat.id, dana.id, 'portal']);
  await page.context().close();
});

it('the reply box is one line on a phone and opens on tap', async () => {
  const page = await contactPage(pat, PHONE);
  await page.goto(`/portal/tickets/${patTicket.id}`);
  const collapsed = page.getByRole('button', { name: /^Reply/ });
  await collapsed.waitFor();
  expect(await collapsed.getAttribute('aria-expanded')).toBe('false');
  expect((await collapsed.boundingBox()).height).toBeLessThanOrEqual(64);
  await collapsed.click();
  await page.getByLabel('Reply', { exact: true }).waitFor();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
  await page.context().close();
});

it('forgot password shows the same message for any email', async () => {
  const messages = [];
  for (const email of [pat.email, 'nobody@nowhere.example']) {
    // eslint-disable-next-line no-await-in-loop
    const page = await contactPage(null, PHONE);
    await page.goto('/portal/sign-in'); // eslint-disable-line no-await-in-loop
    await page.getByRole('link', { name: 'Forgot password?' }).click(); // eslint-disable-line no-await-in-loop
    await page.getByLabel('Email').fill(email); // eslint-disable-line no-await-in-loop
    await page.getByRole('button', { name: 'Send link' }).click(); // eslint-disable-line no-await-in-loop
    const status = page.getByRole('status'); // eslint-disable-line no-await-in-loop
    await status.waitFor(); // eslint-disable-line no-await-in-loop
    messages.push(await status.textContent()); // eslint-disable-line no-await-in-loop
    await page.context().close(); // eslint-disable-line no-await-in-loop
  }
  expect(messages[0]).toBe(messages[1]);
  expect(messages[0]).toMatch(/Check your email/);
});

it('the invite page sets a password and signs in', async () => {
  const { token } = await issuePortalToken(invited.id, 'invite');
  const page = await contactPage(null, PHONE);
  await page.goto(`/portal/welcome?token=${token}`);
  // The page asks who the link is for before showing it.
  await page.waitForFunction((email) => document.getElementById('sp-email')?.value === email, invited.email);
  await page.getByText(/help desk invited you/).waitFor();
  await page.getByLabel('Password', { exact: true }).fill('Lantern-Quay-Bridge-9');
  await page.getByLabel('Confirm password').fill('Lantern-Quay-Bridge-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Tickets', exact: true }).waitFor();
  await page.context().close();
});

it('/kb redirects to the portal sign-in when signed out', async () => {
  const page = await contactPage(null);
  await page.goto('/kb');
  await page.waitForURL(/\/portal\/sign-in/);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.goto(`/kb/a/${seeded.everyone.slug}`);
  await page.waitForURL(/\/portal\/sign-in/);
  await page.context().close();
});

it('knowledge base lists only articles for my company', async () => {
  const page = await contactPage(pat);
  await page.goto('/portal/kb');
  await page.getByRole('heading', { name: 'How can we help?' }).waitFor();
  await page.getByRole('link', { name: new RegExp(`${KB_PREFIX} Riverside only`) }).waitFor();
  await page.getByRole('link', { name: new RegExp(`${KB_PREFIX} Everyone`) }).waitFor();
  expect(await page.getByText(`${KB_PREFIX} Beta only`).count()).toBe(0);
  await page.getByRole('link', { name: new RegExp(`${KB_PREFIX} Riverside only`) }).click();
  await page.getByRole('heading', { name: `${KB_PREFIX} Riverside only` }).waitFor();
  await page.context().close();
});

const PHONE_ROUTES = [
  { name: 'sign in', path: '/portal/sign-in', as: null },
  { name: 'forgot password', path: '/portal/forgot', as: null },
  { name: 'tickets', path: '/portal/tickets' },
  { name: 'new ticket', path: '/portal/tickets/new', as: () => dana },
  { name: 'a ticket', path: () => `/portal/tickets/${patTicket.id}` },
  { name: 'knowledge base', path: '/portal/kb' },
  { name: 'an article', path: () => `/portal/kb/a/${seeded.alphaOnly.slug}` },
];

it.each(PHONE_ROUTES.map((r) => [r.name, r]))('no horizontal scroll at 375 px: %s', async (_n, route) => {
  const who = route.as === undefined ? pat : (typeof route.as === 'function' ? route.as() : route.as);
  const page = await contactPage(who, PHONE);
  await page.goto(typeof route.path === 'function' ? route.path() : route.path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  const poking = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    return [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > vw + 1 && !inScroller(el);
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}"`);
  });
  expect(poking).toEqual([]);
  await page.context().close();
});
