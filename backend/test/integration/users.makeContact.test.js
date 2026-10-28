const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeContact,
} = require('./fixtures');

// "Make contact" on a user (2026-10-27): copy a staff user into a contact of
// the internal company, for organisations without Microsoft 365 sync.

let w;
let tina;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  tina = await makeTech('tina', w.deptA.id);
  await models.User.update({
    firstName: 'Tina', lastName: 'Tech', displayName: 'Tina Tech', email: 'tina@acme.example', phone: '5551234567', jobTitle: 'Field tech',
  }, { where: { id: tina.user.id } });
});
afterAll(closeDb);

it('copies the user into a contact of the internal company, in the same department', async () => {
  const res = expectOk(await w.admin.agent.post(`${API}/users/${tina.user.id}/contact`), 201);
  const contact = await models.Contact.findByPk(res.contact.id);
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  expect(contact).toMatchObject({
    firstName: 'Tina', lastName: 'Tech', displayName: 'Tina Tech', email: 'tina@acme.example',
    phone: '5551234567', jobTitle: 'Field tech', companyId: internal.id, departmentId: w.deptA.id,
    createdBy: w.admin.user.id, portalAccess: false,
  });
  const audit = await models.AuditLog.findOne({ where: { action: 'contact.create', entityId: contact.id } });
  expect(audit.meta).toMatchObject({ fromUserId: tina.user.id });
  // The user's page then points at it.
  const { user } = expectOk(await w.admin.agent.get(`${API}/users/${tina.user.id}`));
  expect(user.contact).toEqual({ id: contact.id });
});

it('a contact with that email already: 409 with its id, nothing created', async () => {
  const existing = await makeContact(w.admin, { email: 'TINA@acme.example', departmentId: w.deptA.id });
  const before = await models.Contact.count();
  const res = await w.admin.agent.post(`${API}/users/${tina.user.id}/contact`);
  expect([res.status, res.body.code, res.body.contactId]).toEqual([409, 'CONTACT_EXISTS', existing.id]);
  expect(await models.Contact.count()).toBe(before);
});

it('needs people.edit_users; unknown or junk ids are 404', async () => {
  const res = await tina.agent.post(`${API}/users/${tina.user.id}/contact`);
  expect(res.status).toBe(403);
  expect((await w.admin.agent.post(`${API}/users/999999/contact`)).status).toBe(404);
  expect((await w.admin.agent.post(`${API}/users/${tina.user.id}abc/contact`)).status).toBe(404);
});

it('a user with only a display name and no email still becomes a contact', async () => {
  await models.User.update({
    firstName: null, lastName: null, email: null, displayName: 'Sam Lee',
  }, { where: { id: tina.user.id } });
  const res = expectOk(await w.admin.agent.post(`${API}/users/${tina.user.id}/contact`), 201);
  const contact = await models.Contact.findByPk(res.contact.id);
  expect([contact.firstName, contact.lastName, contact.displayName, contact.email]).toEqual(['Sam', 'Lee', 'Sam Lee', null]);
});
