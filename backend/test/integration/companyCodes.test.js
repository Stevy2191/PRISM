const Sequelize = require('sequelize');
const { resetData, closeDb, models, sequelize } = require('./helpers');
const { API, expectOk, makeWorld, makeCompany } = require('./fixtures');
const migration = require('../../migrations/20260101000096-company-codes');

// A code for every company (CN part 1): suggested from the name, unique, and
// an old code kept so old numbers still find the company.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('a new company gets a code from its name, made unique', async () => {
  const wc = await makeCompany(w.admin, { name: 'Washington County' });
  const wc2 = await makeCompany(w.admin, { name: 'Wharton County' });
  const hlg = await makeCompany(w.admin, { name: 'Harbor Law Group' });
  expect([wc.code, wc2.code, hlg.code]).toEqual(['WC', 'WC2', 'HLG']);
  const own = await models.Company.findOne({ where: { isInternal: true } });
  expect(own.code).toMatch(/^[A-Z0-9]{2,6}$/);
});

it('a code can be chosen and changed; the old one is kept and taken by nobody else', async () => {
  const wc = await makeCompany(w.admin, { name: 'Washington County', code: 'wash' });
  expect(wc.code).toBe('WASH');
  const res = expectOk(await w.admin.agent.patch(`${API}/companies/${wc.id}`).send({ code: 'WC' }));
  expect(res.company.code).toBe('WC');
  expect((await models.Company.findByPk(wc.id)).previousCodes).toEqual(['WASH']);
  const other = await makeCompany(w.admin, { name: 'Westside' });
  for (const code of ['WC', 'WASH']) {
    // eslint-disable-next-line no-await-in-loop
    const taken = await w.admin.agent.patch(`${API}/companies/${other.id}`).send({ code });
    expect([taken.status, taken.body.code]).toEqual([409, 'CODE_TAKEN']);
  }
  for (const code of ['W', 'TOOLONGX', 'W-C']) {
    // eslint-disable-next-line no-await-in-loop
    expect((await w.admin.agent.patch(`${API}/companies/${other.id}`).send({ code })).status).toBe(400);
  }
});

it('migration 096 gives every company and department a code, and rolls back', async () => {
  const qi = sequelize.getQueryInterface();
  await makeCompany(w.admin, { name: 'Washington County' });
  await migration.down(qi, Sequelize);
  let acme;
  try {
    expect((await qi.describeTable('Companies')).code).toBeUndefined();
    [acme] = await sequelize.query("SELECT id FROM Companies WHERE name = 'Washington County'", { type: Sequelize.QueryTypes.SELECT });
    await sequelize.query("INSERT INTO Departments (companyId, name, createdAt) VALUES (?, 'Human Resources', NOW())", { replacements: [acme.id] });
  } finally {
    await migration.up(qi, Sequelize);
  }
  const [row] = await sequelize.query('SELECT code FROM Companies WHERE id = ?', { replacements: [acme.id], type: Sequelize.QueryTypes.SELECT });
  expect(row.code).toBe('WC');
  const [dept] = await sequelize.query("SELECT shortCode FROM Departments WHERE companyId = ? AND name = 'Human Resources'", { replacements: [acme.id], type: Sequelize.QueryTypes.SELECT });
  expect(dept.shortCode).toBe('HR');
  await migration.up(qi, Sequelize); // twice is harmless
});
