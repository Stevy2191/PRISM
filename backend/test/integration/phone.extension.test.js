const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeContact, makeTech,
} = require('./fixtures');

// A person's phone extension (contacts and staff): up to 4 digits beside the
// phone number.

let w;
beforeEach(async () => { await resetData(); w = await makeWorld(); });
afterAll(closeDb);

it('a contact keeps an extension, set when made and changed later', async () => {
  const c = await makeContact(w.admin, { firstName: 'Ann', phone: '(979) 277-6200', phoneExt: '1234' });
  expect([c.phone, c.phoneExt]).toEqual(['9792776200', '1234']);
  expectOk(await w.admin.agent.patch(`${API}/contacts/${c.id}`).send({ phoneExt: '42' }));
  expect((await models.Contact.findByPk(c.id)).phoneExt).toBe('42');
  expect((await w.admin.agent.patch(`${API}/contacts/${c.id}`).send({ phoneExt: '12345' })).status).toBe(400);
  expectOk(await w.admin.agent.patch(`${API}/contacts/${c.id}`).send({ phoneExt: '' }));
  expect((await models.Contact.findByPk(c.id)).phoneExt).toBeNull();
});

it("a ticket shows its contact's extension", async () => {
  const c = await makeContact(w.admin, { firstName: 'Ann', phone: '9792776200', phoneExt: '77', departmentId: w.deptA.id });
  const t = expectOk(await w.admin.agent.post(`${API}/tickets`).send({ title: 'Printer', contactId: c.id }), 201).ticket;
  const { ticket } = expectOk(await w.admin.agent.get(`${API}/tickets/${t.id}`));
  expect([ticket.contact.phone, ticket.contact.phoneExt]).toEqual(['9792776200', '77']);
});

it('a staff profile keeps an extension', async () => {
  const tina = await makeTech('tina', w.deptA.id);
  expectOk(await w.admin.agent.patch(`${API}/users/${tina.user.id}`).send({ phone: '9792776200', phoneExt: '5' }));
  expect((await models.User.findByPk(tina.user.id)).phoneExt).toBe('5');
  expect((await w.admin.agent.patch(`${API}/users/${tina.user.id}`).send({ phoneExt: 'abcde12345' })).status).toBe(400);
});
