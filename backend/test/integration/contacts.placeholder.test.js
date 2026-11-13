const Sequelize = require('sequelize');
const {
  resetData, closeDb, models, sequelize,
} = require('./helpers');
const { API, expectOk, makeWorld, makeCompany } = require('./fixtures');
const { placeholderFor, PLACEHOLDER_NAME } = require('../../src/services/agent/trayTickets');
const migration = require('../../migrations/20260101000089-placeholder-contact-repair');

// The company's "Unknown tray user" can't be made into a person; ones that
// were (before this) become real contacts.

let w;
let company;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
});
afterAll(closeDb);

it('the stand-in refuses a name, an email, portal access and a move; notes still save', async () => {
  const ph = await placeholderFor(company.id);
  const patch = (body) => w.admin.agent.patch(`${API}/contacts/${ph.id}`).send(body);
  for (const body of [{ displayName: 'Sean Stevens' }, { firstName: 'Sean' }, { email: 'sean@riverside.test' }, { portalAccess: true }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await patch(body);
    expect([res.status, res.body.code]).toEqual([409, 'PLACEHOLDER_CONTACT']);
  }
  expectOk(await patch({ notes: 'Checked weekly' }));
  expectOk(await patch({ displayName: PLACEHOLDER_NAME }));
  const fresh = await models.Contact.findByPk(ph.id);
  expect(fresh).toMatchObject({ displayName: PLACEHOLDER_NAME, email: null, isPlaceholder: true, portalAccess: false });
  expect(expectOk(await w.admin.agent.get(`${API}/contacts/${ph.id}`)).contact.isPlaceholder).toBe(true);
});

it('migration 089: a stand-in that was given a person\'s details becomes a contact; an untouched one stays', async () => {
  const edited = await placeholderFor(company.id);
  const other = await makeCompany(w.admin, { name: 'Lakeside' });
  const untouched = await placeholderFor(other.id);
  await sequelize.query("UPDATE Contacts SET displayName = 'Sean Stevens', firstName = 'Sean', lastName = 'Stevens', email = 'sean@riverside.test' WHERE id = ?", { replacements: [edited.id] });
  const qi = sequelize.getQueryInterface();
  await migration.up(qi, Sequelize);
  await migration.up(qi, Sequelize); // again: nothing more to do
  const a = await models.Contact.findByPk(edited.id);
  expect(a).toMatchObject({ isPlaceholder: false, displayName: 'Sean Stevens', notes: null });
  expect((await models.Contact.findByPk(untouched.id)).isPlaceholder).toBe(true);
  // The company gets a new stand-in when it next needs one.
  const next = await placeholderFor(company.id);
  expect(next.id).not.toBe(edited.id);
  expect(next).toMatchObject({ displayName: PLACEHOLDER_NAME, isPlaceholder: true });
  await migration.down(qi, Sequelize);
});
