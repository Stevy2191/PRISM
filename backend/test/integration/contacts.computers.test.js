const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeStaff, makeCompany, makeContact,
} = require('./fixtures');

// A contact's page lists the computers assigned to them, for staff who see assets.

let w;
let amy;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  const company = await makeCompany(w.admin, { name: 'Alpha Dental' });
  amy = await makeContact(w.admin, { companyId: company.id, firstName: 'Amy', lastName: 'Ng' });
  const category = await models.AssetCategory.findOne();
  const laptop = expectOk(await w.admin.agent.post(`${API}/assets`).send({
    name: 'ALPHA-FD-01', categoryId: category.id, companyId: company.id, assignedToContactId: amy.id, operatingSystem: 'Windows 11',
  }), 201).asset;
  expectOk(await w.admin.agent.post(`${API}/assets`).send({ name: 'Somebody else\'s', categoryId: category.id, companyId: company.id }), 201);
  await models.Device.create({
    assetId: laptop.id, companyId: company.id, publicKey: 'k'.repeat(44), platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'ALPHA-FD-01', lastSeenAt: new Date(),
  });
});
afterAll(closeDb);

it('lists the contact\'s own computers with the agent\'s state', async () => {
  const { computers } = expectOk(await w.admin.agent.get(`${API}/contacts/${amy.id}`));
  expect(computers).toHaveLength(1);
  expect(computers[0]).toMatchObject({ name: 'ALPHA-FD-01', operatingSystem: 'Windows 11', agent: { online: true } });
});

it('is empty for staff without Assets', async () => {
  const staff = await makeStaff('staff-nc', w.deptA.id);
  const res = await staff.agent.get(`${API}/contacts/${amy.id}`);
  if (res.status === 200) expect(res.body.computers).toEqual([]);
  else expect([403, 404]).toContain(res.status);
});
