const {
  resetData, closeDb, models,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeTech, setCompanyAccess,
} = require('./fixtures');

// Sub-project 9, task 3: each company's software list, and the programs the
// agent found on its computers to pick from.

let w;
let alpha;
let beta;
const a = () => w.admin.agent;
const base = (c) => `${API}/companies/${c.id}/catalog`;
const add = async (c, body) => expectOk(await a().post(base(c)).send({ kind: 'software', ...body }), 201).item;
const listOf = async (c, query = {}) => expectOk(await a().get(base(c)).query({ kind: 'software', ...query })).items;

const computers = () => models.AssetCategory.findOne({ where: { name: 'Computers' } });
let tagSeq = 0;
async function computerWith(company, programs) {
  tagSeq += 1;
  const asset = await models.Asset.create({
    assetTag: `CAT-${tagSeq}`, name: `PC ${tagSeq}`, categoryId: (await computers()).id, companyId: company.id,
  });
  await models.AssetSoftware.bulkCreate(programs.map(([name, version, publisher]) => ({
    assetId: asset.id, name, version: version || null, publisher: publisher || null,
  })));
  return asset;
}

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  alpha = await makeCompany(w.admin, { name: 'Alpha Dental' });
  beta = await makeCompany(w.admin, { name: 'Beta Law' });
});
afterAll(closeDb);

it('adds, lists, edits and removes a company\'s apps', async () => {
  const dentrix = await add(alpha, { name: '  Dentrix ', publisher: 'Henry Schein', notes: 'Front desk and ops' });
  expect(dentrix).toMatchObject({
    name: 'Dentrix', publisher: 'Henry Schein', notes: 'Front desk and ops', active: true, kind: 'software', companyId: alpha.id,
  });
  await add(alpha, { name: 'Adobe Acrobat' });
  expect((await listOf(alpha)).map((i) => i.name)).toEqual(['Adobe Acrobat', 'Dentrix']);

  const edited = expectOk(await a().patch(`${base(alpha)}/${dentrix.id}`).send({ name: 'Dentrix G7', active: false })).item;
  expect(edited).toMatchObject({ name: 'Dentrix G7', active: false });
  // Pickers ask for active ones only; the list shows all.
  expect((await listOf(alpha, { active: 'true' })).map((i) => i.name)).toEqual(['Adobe Acrobat']);
  expect(await listOf(alpha)).toHaveLength(2);

  expectOk(await a().delete(`${base(alpha)}/${dentrix.id}`));
  expect((await listOf(alpha)).map((i) => i.name)).toEqual(['Adobe Acrobat']);
});

it('names are unique per company (any case), and validated', async () => {
  await add(alpha, { name: 'Dentrix' });
  expect((await a().post(base(alpha)).send({ kind: 'software', name: 'dentrix' })).status).toBe(409);
  // Another company may have the same app.
  await add(beta, { name: 'Dentrix' });
  expect((await a().post(base(alpha)).send({ kind: 'software', name: '   ' })).status).toBe(400);
  expect((await a().post(base(alpha)).send({ kind: 'software', name: 'x'.repeat(256) })).status).toBe(400);
  expect((await a().post(base(alpha)).send({ kind: 'printer', name: 'HP' })).status).toBe(400);
  const acro = await add(alpha, { name: 'Acrobat' });
  expect((await a().patch(`${base(alpha)}/${acro.id}`).send({ name: 'DENTRIX' })).status).toBe(409);
});

it('fences each list to its company', async () => {
  const theirs = await add(beta, { name: 'Clio' });
  // Another company's item can't be reached through this company's address.
  expect((await a().patch(`${base(alpha)}/${theirs.id}`).send({ name: 'Mine now' })).status).toBe(404);
  expect((await a().delete(`${base(alpha)}/${theirs.id}`)).status).toBe(404);
  expect(await listOf(alpha)).toEqual([]);

  // A technician who reaches only Alpha can read Alpha's list, not Beta's,
  // and can't change either without the category permission.
  const tech = await makeTech('tess', w.deptA.id);
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [alpha.id] });
  expect((await tech.agent.get(base(alpha)).query({ kind: 'software' })).status).toBe(200);
  expect((await tech.agent.get(base(beta)).query({ kind: 'software' })).status).toBe(403);
  expect((await tech.agent.post(base(alpha)).send({ kind: 'software', name: 'Zoom' })).status).toBe(403);
  expect((await tech.agent.get(`${base(beta)}/found-software`)).status).toBe(403);
});

it('found software: the agent\'s programs on this company\'s computers, grouped, counted, not yet listed', async () => {
  await computerWith(alpha, [['Dentrix', '7.1', 'Henry Schein'], ['Google Chrome', '131.0']]);
  await computerWith(alpha, [['Dentrix', '7.2', 'Henry Schein'], ['Google Chrome', '131.0'], ['Zoom Workplace', '6.2']]);
  await computerWith(beta, [['Clio for Outlook', '3.0']]);
  await add(alpha, { name: 'google chrome' }); // already listed (any case)

  const found = expectOk(await a().get(`${base(alpha)}/found-software`)).software;
  expect(found).toEqual([
    { name: 'Dentrix', publisher: 'Henry Schein', versions: ['7.1', '7.2'], computers: 2 },
    { name: 'Zoom Workplace', publisher: null, versions: ['6.2'], computers: 1 },
  ]);
  const searched = expectOk(await a().get(`${base(alpha)}/found-software`).query({ search: 'zoo' })).software;
  expect(searched.map((s) => s.name)).toEqual(['Zoom Workplace']);
  // Beta's computers never show on Alpha.
  expect(found.some((s) => s.name.startsWith('Clio'))).toBe(false);
});
