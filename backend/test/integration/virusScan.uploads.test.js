const fs = require('fs');
const path = require('path');
const { resetData, closeDb, models } = require('./helpers');
const { API, makeWorld, makeTicket, makeProject } = require('./fixtures');
const { startFakeClamd } = require('../helpers/fakeClamd');
const { _resetThrottleForTest } = require('../../src/services/virusScan');
const { UPLOAD_ROOT } = require('../../src/middleware/upload');

const PDF = Buffer.from('%PDF-1.4\n%fake\n');
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.from('0000000d', 'hex')]);
const ICO = Buffer.concat([Buffer.from('00000100', 'hex'), Buffer.alloc(16)]);
const TXT = Buffer.from('hello');

let w;
let fake;
let seq = 0;
const uniq = (p) => `${p}${Date.now().toString(36)}${(seq += 1)}`;

const listFiles = (dir = UPLOAD_ROOT) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
};

// Each route: how to make the parent record, post one file, and count rows.
const ROUTES = [
  {
    name: 'ticket attachments', entity: 'Ticket', file: ['notes.txt', TXT], model: 'Attachment',
    make: async () => (await makeTicket(w.admin.agent, { title: 'T', contactId: w.contact.id, departmentId: w.deptA.id })).id,
    url: (id) => `${API}/tickets/${id}/attachments`,
  },
  {
    name: 'project files', entity: 'Project', file: ['notes.txt', TXT], model: 'ProjectFile',
    make: async () => (await makeProject(w.admin.agent, { name: 'P', ownerDepartmentId: w.deptA.id })).id,
    url: (id) => `${API}/projects/${id}/files`,
  },
  {
    name: 'asset attachments', entity: 'Asset', file: ['doc.pdf', PDF], model: 'AssetAttachment',
    make: async () => {
      const cat = await models.AssetCategory.create({ name: uniq('Cat'), prefix: uniq('C').slice(0, 5).toUpperCase() });
      return (await models.Asset.create({ assetTag: uniq('A'), name: 'a', categoryId: cat.id })).id;
    },
    url: (id) => `${API}/assets/${id}/attachments`,
  },
  {
    name: 'license attachments', entity: 'License', file: ['doc.pdf', PDF], model: 'LicenseAttachment',
    make: async () => (await models.License.create({ name: 'L' })).id,
    url: (id) => `${API}/licenses/${id}/attachments`,
  },
  {
    name: 'contract attachments', entity: 'Contract', file: ['doc.pdf', PDF], model: 'ContractAttachment',
    make: async () => (await models.Contract.create({ name: 'C', vendor: 'V' })).id,
    url: (id) => `${API}/contracts/${id}/attachments`,
  },
  {
    name: 'knowledge attachments', entity: 'KnowledgeArticle', file: ['doc.pdf', PDF], model: 'KbAttachment',
    make: async () => (await models.KbArticle.create({ title: uniq('K'), slug: uniq('k'), body: '<p>x</p>' })).id,
    url: (id) => `${API}/knowledge/articles/${id}/attachments`,
  },
  {
    name: 'logo', entity: 'Branding', file: ['logo.png', PNG, 'image/png'], model: null,
    make: async () => null, url: () => `${API}/settings/logo`,
  },
  {
    name: 'favicon', entity: 'Branding', file: ['fav.ico', ICO, 'image/x-icon'], model: null,
    make: async () => null, url: () => `${API}/settings/favicon`,
  },
];

const post = (r, id, file = r.file) => {
  const [name, buf, contentType] = file;
  return w.admin.agent.post(r.url(id)).attach('file', buf, { filename: name, ...(contentType ? { contentType } : {}) });
};
const rowCount = (r) => (r.model ? models[r.model].count() : Promise.resolve(0));

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
beforeEach(async () => {
  await resetData();
  _resetThrottleForTest();
  // resetData doesn't clear these module tables; leftovers would skew row counts.
  await Promise.all(['AssetAttachment', 'LicenseAttachment', 'ContractAttachment', 'KbAttachment', 'ProjectFile'].map((m) => models[m].destroy({ where: {} })));
  w = await makeWorld();
  fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  delete process.env.CLAMAV_ENABLED;
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
});
afterAll(async () => { jest.restoreAllMocks(); await closeDb(); });

async function scannerOn(opts) {
  fake = await startFakeClamd(opts);
  process.env.CLAMAV_ENABLED = 'true';
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(fake.port);
}

describe.each(ROUTES)('$name', (r) => {
  it('clean upload is stored', async () => {
    await scannerOn({ mode: 'ok' });
    const id = await r.make();
    const res = await post(r, id);
    expect([200, 201]).toContain(res.status);
    expect(listFiles()).toHaveLength(1);
    if (r.model) expect(await rowCount(r)).toBe(1);
    expect(fake.received.length).toBeGreaterThan(0);
  });

  it('infected → 422 VIRUS_FOUND, nothing stored, audited and admins notified', async () => {
    await scannerOn({ mode: 'found', signature: 'Win.Test.EICAR_HDB-1' });
    const id = await r.make();
    const before = listFiles();
    const res = await post(r, id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VIRUS_FOUND');
    expect(res.body.message).toBe('Upload blocked: a virus was detected (Win.Test.EICAR_HDB-1)');
    expect(listFiles()).toEqual(before);
    expect(await rowCount(r)).toBe(0);
    const audit = await models.AuditLog.findOne({ where: { action: 'upload.virus_blocked' } });
    expect(audit).toBeTruthy();
    expect(audit.entityType).toBe(r.entity);
    expect(audit.entityId).toBe(id);
    expect(audit.meta).toMatchObject({ filename: r.file[0], signature: 'Win.Test.EICAR_HDB-1' });
    expect(audit.meta.route).toContain(r.url(id));
    expect(audit.userId).toBe(w.admin.user.id);
    const n = await models.Notification.findOne({ where: { type: 'virus_blocked', userId: w.admin.user.id } });
    expect(n.message).toContain(`"${r.file[0]}"`);
  });

  it('scanner down → 503 SCANNER_UNAVAILABLE, nothing stored', async () => {
    await scannerOn({ mode: 'error' });
    const id = await r.make();
    const before = listFiles();
    const res = await post(r, id);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SCANNER_UNAVAILABLE');
    expect(res.body.message).toMatch(/virus scanner isn't reachable/);
    expect(listFiles()).toEqual(before);
    expect(await rowCount(r)).toBe(0);
    expect(await models.Notification.count({ where: { type: 'scanner_unavailable' } })).toBe(1);
  });

  it('CLAMAV_ENABLED=false → stored without contacting the scanner', async () => {
    await scannerOn({ mode: 'found' });
    process.env.CLAMAV_ENABLED = 'false';
    const id = await r.make();
    const res = await post(r, id);
    expect([200, 201]).toContain(res.status);
    expect(fake.received).toHaveLength(0);
  });
});

describe('rejected before the scan', () => {
  it('a bad extension never reaches the scanner', async () => {
    await scannerOn({ mode: 'ok' });
    const r = ROUTES[0];
    const id = await r.make();
    const res = await post(r, id, ['run.exe', Buffer.from('hi')]);
    expect(res.status).toBe(400);
    expect(fake.received).toHaveLength(0);
  });

  it('a signature mismatch never reaches the scanner', async () => {
    await scannerOn({ mode: 'ok' });
    const r = ROUTES[2];
    const id = await r.make();
    const res = await post(r, id, ['fake.pdf', Buffer.from('MZ not a pdf')]);
    expect(res.status).toBe(400);
    expect(fake.received).toHaveLength(0);
  });
});
