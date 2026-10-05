const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 6: the CSV import's Company column.

const { Company, Contact, Department } = models;

let w;
let acme;
let internalId;
const a = () => w.admin.agent;
const mapping = { First: 'firstName', Email: 'email', Company: 'company', Dept: 'department' };
const row = (first, company = '', dept = '') => ({ First: first, Email: `${first.toLowerCase()}@x.test`, Company: company, Dept: dept });
const check = async (rows, agent = a()) => expectOk(await agent.post(`${API}/contacts/import/validate`).send({ rows, mapping }));
const commit = async (rows, agent = a()) => expectOk(await agent.post(`${API}/contacts/import`).send({ rows, mapping }));

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  acme = await makeCompany(w.admin, { name: 'Acme' });
  await Department.create({ name: 'HR', companyId: acme.id });
});
afterAll(closeDb);

it('files a row under the named company (ignoring case), with that company\'s department', async () => {
  const result = await commit([row('Ann', 'acme', 'hr')]);
  expect(result.created).toBe(1);
  const ann = await Contact.findOne({ where: { email: 'ann@x.test' }, include: [{ model: Department, as: 'department' }] });
  expect([ann.companyId, ann.department.name]).toEqual([acme.id, 'HR']);
});

it('a blank Company cell means the internal company', async () => {
  await commit([row('Bob')]);
  expect((await Contact.findOne({ where: { email: 'bob@x.test' } })).companyId).toBe(internalId);
});

it('an unknown company is flagged in the preview and not imported', async () => {
  const preview = await check([row('Cat', 'Nope Inc'), row('Dan', 'Acme')]);
  expect(preview.rows[0]).toEqual(expect.objectContaining({ action: 'error' }));
  expect(preview.rows[0].issues).toContainEqual({ type: 'error', message: '"Nope Inc" does not match any company' });
  expect(preview.summary.errors).toBe(1);
  const result = await commit([row('Cat', 'Nope Inc'), row('Dan', 'Acme')]);
  expect([result.created, result.failed]).toEqual([1, 1]);
});

it('a vendor-only company, or one the importer can\'t reach, doesn\'t match', async () => {
  await Company.create({ name: 'Dell', isVendor: true });
  const globex = await makeCompany(w.admin, { name: 'Globex' });
  const t = await makeTech('importer', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [internalId, acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  const preview = await check([row('Eve', 'Dell'), row('Fay', 'Globex')], t.agent);
  expect(preview.rows.map((r) => r.action)).toEqual(['error', 'error']);
  expect(preview.rows[1].issues).toContainEqual({ type: 'error', message: `"${globex.name}" does not match any company` });
});

it('an importer who can\'t reach the internal company must name one', async () => {
  const t = await makeTech('acmeonly', w.deptA.id);
  await setCompanyAccess(w.admin, t.user.id, { allCompanies: false, companyIds: [acme.id] });
  expectOk(await a().post(`${API}/users/${t.user.id}/overrides`).send({ permissionKey: 'people.view_all', granted: true }), 201);
  const preview = await check([row('Gil'), row('Hal', 'Acme')], t.agent);
  expect(preview.rows[0].issues).toContainEqual({ type: 'error', message: 'Choose a company for this contact' });
  expect(preview.rows[1].action).toBe('create');
});
