const Sequelize = require('sequelize');
const { resetData, closeDb, sequelize } = require('./helpers');
const { makeWorld, makeCompany, API, expectOk } = require('./fixtures');
const migration = require('../../migrations/20260101000094-phone-digits');

// Migration 094: stored numbers typed as (979) 277-6200 become 9792776200;
// anything that isn't a 10-digit number is left as it was.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('puts 10-digit numbers into digits and leaves the rest', async () => {
  const acme = await makeCompany(w.admin, { name: 'Acme' });
  const odd = await makeCompany(w.admin, { name: 'Odd' });
  const site = expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/sites`).send({ name: 'HQ' }), 201).site;
  await sequelize.query("UPDATE Companies SET phone = '(979) 277-6200' WHERE id = ?", { replacements: [acme.id] });
  await sequelize.query("UPDATE Companies SET phone = '+44 20 7946 0958' WHERE id = ?", { replacements: [odd.id] });
  await sequelize.query("UPDATE Sites SET phone = '+1 (979) 555-0100' WHERE id = ?", { replacements: [site.id] });
  await migration.up(sequelize.getQueryInterface(), Sequelize);
  const one = async (sql, id) => (await sequelize.query(sql, { replacements: [id], type: Sequelize.QueryTypes.SELECT }))[0].phone;
  expect(await one('SELECT phone FROM Companies WHERE id = ?', acme.id)).toBe('9792776200');
  expect(await one('SELECT phone FROM Companies WHERE id = ?', odd.id)).toBe('+44 20 7946 0958');
  expect(await one('SELECT phone FROM Sites WHERE id = ?', site.id)).toBe('9795550100');
});

it('sites and contracts store 10 digits too', async () => {
  const acme = await makeCompany(w.admin, { name: 'Acme', phone: '(979) 277-6200' });
  expect(acme.phone).toBe('9792776200');
  const site = expectOk(await w.admin.agent.post(`${API}/companies/${acme.id}/sites`).send({ name: 'HQ', phone: '979-555-0100' }), 201).site;
  expect(site.phone).toBe('9795550100');
  expect((await w.admin.agent.post(`${API}/companies/${acme.id}/sites`).send({ name: 'Annex', phone: '0100' })).status).toBe(400);
});
