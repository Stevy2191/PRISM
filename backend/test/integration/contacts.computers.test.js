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

it('lists everything assigned to the contact, with the agent\'s state and an open checkout', async () => {
  const body = expectOk(await w.admin.agent.get(`${API}/contacts/${amy.id}`));
  expect(body.assets).toHaveLength(1);
  expect(body.assets[0]).toMatchObject({
    name: 'ALPHA-FD-01', operatingSystem: 'Windows 11', agent: { online: true }, checkout: null,
  });
  expect(body.assets[0].category).toBeTruthy();
  expect(body.computers).toEqual(body.assets);
});

it('an asset checked out to the contact joins the list, and leaves it when checked in or unassigned', async () => {
  const a = w.admin.agent;
  const spare = (await models.Asset.findOne({ where: { name: 'Somebody else\'s' } }));
  const out = expectOk(await a.post(`${API}/assets/${spare.id}/checkouts`).send({ contactId: amy.id }), 201).checkout;
  let { assets } = expectOk(await a.get(`${API}/contacts/${amy.id}`));
  expect(assets.map((x) => x.name).sort()).toEqual(['ALPHA-FD-01', 'Somebody else\'s']);
  expect(assets.find((x) => x.id === spare.id).checkout).toMatchObject({ id: out.id });
  // Checked in: it leaves.
  expectOk(await a.post(`${API}/assets/${spare.id}/checkouts/${out.id}/check-in`).send({}));
  // Assigned by hand (no checkout): unassigning takes it off too.
  const laptop = assets.find((x) => x.name === 'ALPHA-FD-01');
  expectOk(await a.patch(`${API}/assets/${laptop.id}`).send({ assignedToContactId: null }));
  ({ assets } = expectOk(await a.get(`${API}/contacts/${amy.id}`)));
  expect(assets).toEqual([]);
});

it('is empty for staff without Assets', async () => {
  const staff = await makeStaff('staff-nc', w.deptA.id);
  const res = await staff.agent.get(`${API}/contacts/${amy.id}`);
  if (res.status === 200) expect(res.body.assets).toEqual([]);
  else expect([403, 404]).toContain(res.status);
});
