const crypto = require('crypto');
const request = require('supertest');
const {
  resetData, closeDb, models, getApp,
} = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany, makeContact, makeTech,
} = require('./fixtures');
const { resetRateLimits } = require('../../src/middleware/rateLimit');
const { applyInventory } = require('../../src/services/agent/inventory');
const checkouts = require('../../src/services/assets/checkouts');

// Sub-project PB, task 5: one check-out and check-in service for the asset
// page and ticket forms, with revoking the PRISM agent at check-in.

let w;
let company;
let ann;
let bob;
beforeEach(async () => {
  await resetData();
  resetRateLimits();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Riverside' });
  ann = await makeContact(w.admin, { companyId: company.id, firstName: 'Ann', email: 'ann@riverside.example' });
  bob = await makeContact(w.admin, { companyId: company.id, firstName: 'Bob', email: 'bob@riverside.example' });
});
afterAll(closeDb);

const as = (u) => ({ user: u.user, ip: '127.0.0.1', headers: {} });
const contact = (c) => models.Contact.findByPk(c.id);
const reload = (a) => models.Asset.findByPk(a.id);

const publicKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
async function enroll(serial = 'SER-1') {
  const { secret } = expectOk(await w.admin.agent.post(`${API}/companies/${company.id}/agent-keys`).send({ name: 'Rollout' }), 201);
  const res = await request(getApp()).post(`${API}/agent/v1/enroll`).send({
    enrollKey: secret, publicKey: publicKey(), platform: 'windows', arch: 'amd64', agentVersion: '0.5.0', hostname: 'PC-1', serialNumber: serial,
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`enroll: ${res.status} ${JSON.stringify(res.body)}`);
  const device = await models.Device.findOne({ where: { hostname: 'PC-1' }, order: [['id', 'DESC']] });
  return { device, asset: await models.Asset.findByPk(device.assetId) };
}
const inventory = (email) => ({ hostname: 'PC-1', serialNumber: 'SER-1', signedInUser: { account: email.split('@')[0], upn: email } });

it('the asset page checks out and in as before', async () => {
  const category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  const asset = expectOk(await w.admin.agent.post(`${API}/assets`).send({ name: 'Laptop', categoryId: category.id, companyId: company.id }), 201).asset;
  const { checkout } = expectOk(await w.admin.agent.post(`${API}/assets/${asset.id}/checkouts`).send({ contactId: ann.id }), 201);
  expect((await reload(asset)).assignedToContactId).toBe(ann.id);
  const done = expectOk(await w.admin.agent.post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/check-in`).send({}));
  expect(done.checkout.checkedInAt).toBeTruthy();
  expect((await reload(asset)).assignedToContactId).toBeNull();
  expect((await w.admin.agent.post(`${API}/assets/${asset.id}/checkouts/${checkout.id}/check-in`).send({})).status).toBe(400);
  const actions = (await models.AssetActivity.findAll({ where: { assetId: asset.id }, order: [['id', 'ASC']] })).map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(['checked_out', 'checked_in', 'assignment_changed']));
});

it('check-in sets the status and needs a reason for on hold', async () => {
  const { asset } = await enroll();
  await checkouts.checkOut(as(w.admin), asset, await contact(ann));
  await expect(checkouts.checkIn(as(w.admin), await reload(asset), { status: 'on_hold' })).rejects.toMatchObject({ status: 400 });
  await expect(checkouts.checkIn(as(w.admin), await reload(asset), { status: 'lost' })).rejects.toMatchObject({ status: 400 });
  const { checkout } = await checkouts.checkIn(as(w.admin), await reload(asset), { status: 'on_hold', holdReason: 'Activation Locked' });
  expect(checkout.checkedInAt).toBeTruthy();
  expect(await reload(asset)).toMatchObject({ status: 'on_hold', holdReason: 'Activation Locked', assignedToContactId: null });
});

it('checking in a device the agent assigned (no checkout) clears the holder', async () => {
  const { device, asset } = await enroll();
  await applyInventory(device, inventory('ann@riverside.example'));
  const held = await reload(asset);
  expect(held.assignedToContactId).toBe(ann.id);
  expect(await checkouts.assignedByAgent(held)).toBe(true);
  const { checkout } = await checkouts.checkIn(as(w.admin), held, { status: 'ready_to_issue' });
  expect(checkout).toBeNull();
  expect(await reload(asset)).toMatchObject({ assignedToContactId: null, status: 'ready_to_issue' });
});

it("a check-out to the agent's usual user is the holder by hand: a later sign-in doesn't move it", async () => {
  const { device, asset } = await enroll();
  await applyInventory(device, inventory('ann@riverside.example'));
  await checkouts.checkOut(as(w.admin), await reload(asset), await contact(ann));
  expect(await checkouts.assignedByAgent(await reload(asset))).toBe(false);
  await applyInventory(await models.Device.findByPk(device.id), inventory('bob@riverside.example'));
  expect((await reload(asset)).assignedToContactId).toBe(ann.id);
});

it('a form may refuse a device checked out to someone else', async () => {
  const { asset } = await enroll();
  await checkouts.checkOut(as(w.admin), asset, await contact(ann));
  await expect(checkouts.checkOut(as(w.admin), await reload(asset), await contact(bob), { refuseIfOut: true }))
    .rejects.toMatchObject({ status: 409, code: 'ALREADY_CHECKED_OUT' });
  // To the same person again: nothing new.
  const again = await checkouts.checkOut(as(w.admin), await reload(asset), await contact(ann), { refuseIfOut: true });
  expect(again.already).toBe(true);
  expect(await models.AssetCheckout.count({ where: { assetId: asset.id } })).toBe(1);
});

it('revoking needs Manage devices, and without it nothing changes', async () => {
  const { device, asset } = await enroll();
  await checkouts.checkOut(as(w.admin), asset, await contact(ann));
  const tech = await makeTech('tech1', w.deptA.id);
  await expect(checkouts.checkIn(as(tech), await reload(asset), { status: 'ready_to_issue', revokeAgent: true }))
    .rejects.toMatchObject({ status: 403, code: 'AGENT_REVOKE_FORBIDDEN' });
  expect((await reload(asset)).assignedToContactId).toBe(ann.id);
  expect((await models.Device.findByPk(device.id)).revokedAt).toBeNull();
  const { revoked } = await checkouts.checkIn(as(w.admin), await reload(asset), { status: 'ready_to_issue', revokeAgent: true });
  expect(revoked).toBe(true);
  expect((await models.Device.findByPk(device.id)).revokedAt).toBeTruthy();
});

it('after a check-in that revokes the agent, the next install claims the same Asset', async () => {
  const { device, asset } = await enroll('SER-1');
  await device.update({ lastInventoryAt: new Date() }); // it has reported in
  await checkouts.checkOut(as(w.admin), asset, await contact(ann));
  await checkouts.checkIn(as(w.admin), await reload(asset), { status: 'ready_to_issue', revokeAgent: true });
  const again = await enroll('SER-1');
  expect(again.asset.id).toBe(asset.id);
  expect(await models.Asset.count({ where: { serialNumber: 'SER-1' } })).toBe(1);
});

it('without revoking, the next install makes a second Asset (why check-in revokes)', async () => {
  const { device, asset } = await enroll('SER-1');
  await device.update({ lastInventoryAt: new Date() });
  await checkouts.checkOut(as(w.admin), asset, await contact(ann));
  await checkouts.checkIn(as(w.admin), await reload(asset), { status: 'ready_to_issue' });
  const again = await enroll('SER-1');
  expect(again.asset.id).not.toBe(asset.id);
  expect(await models.Asset.count({ where: { serialNumber: 'SER-1' } })).toBe(2);
});
