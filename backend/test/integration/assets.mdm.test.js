const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech,
} = require('./fixtures');

// Sub-project PB, task 3: the MDM list, and managed / MDM / hold reason on
// devices.

let w;
let category;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
});
afterAll(closeDb);

const addMdm = async (body) => expectOk(await w.admin.agent.post(`${API}/mdms`).send(body), 201).mdm;
const newAsset = (agent, body) => agent.post(`${API}/assets`).send({ name: 'Laptop', categoryId: category.id, ...body });

it('keeps the list of MDMs: add, rename, reorder, retire; no delete', async () => {
  const a = await addMdm({ name: 'MDM A', consoleUrl: 'https://a.example/devices/{id}' });
  const b = await addMdm({ name: 'MDM B' });
  expect((await w.admin.agent.post(`${API}/mdms`).send({ name: 'mdm a' })).status).toBe(409);
  expect((await w.admin.agent.post(`${API}/mdms`).send({ name: '  ' })).status).toBe(400);

  expectOk(await w.admin.agent.patch(`${API}/mdms/${a.id}`).send({ name: 'MDM A Cloud' }));
  expectOk(await w.admin.agent.post(`${API}/mdms/reorder`).send({ ids: [b.id, a.id] }));
  expectOk(await w.admin.agent.patch(`${API}/mdms/${b.id}`).send({ isActive: false }));
  const { mdms } = expectOk(await w.admin.agent.get(`${API}/mdms`));
  expect(mdms.map((m) => [m.name, m.isActive])).toEqual([['MDM B', false], ['MDM A Cloud', true]]);
  expect(mdms[0]).toHaveProperty('deviceCount', 0);
  expect((await w.admin.agent.delete(`${API}/mdms/${a.id}`)).status).toBe(404);
});

it('only http and https console addresses are kept', async () => {
  for (const consoleUrl of ['javascript:alert(1)//{id}', 'data:text/html,hi', 'ftp://x.example/{id}', 'not a url']) {
    // eslint-disable-next-line no-await-in-loop
    expect((await w.admin.agent.post(`${API}/mdms`).send({ name: `Bad ${consoleUrl}`, consoleUrl })).status).toBe(400);
  }
  const ok = await addMdm({ name: 'Plain', consoleUrl: 'http://mdm.local/d?id={id}' });
  expect(ok.consoleUrl).toBe('http://mdm.local/d?id={id}');
});

it('anyone who sees assets can read the list; only playbook managers change it', async () => {
  await addMdm({ name: 'MDM A' });
  const tech = await makeTech('tech1', w.deptA.id);
  expectOk(await tech.agent.get(`${API}/mdms`));
  expect((await tech.agent.post(`${API}/mdms`).send({ name: 'Mine' })).status).toBe(403);
});

it('a managed device needs an MDM; the console link carries its ID, encoded', async () => {
  const a = await addMdm({ name: 'MDM A', consoleUrl: 'https://a.example/devices/{id}' });
  expect((await newAsset(w.admin.agent, { isManaged: true })).status).toBe(400);
  const { asset } = expectOk(await newAsset(w.admin.agent, { isManaged: true, mdmId: a.id, mdmDeviceId: '14 87/x' }), 201);
  expect(asset.mdm.name).toBe('MDM A');
  expect(asset.mdmLink).toBe('https://a.example/devices/14%2087%2Fx');

  // Not managed clears the MDM and its ID.
  const { asset: plain } = expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ isManaged: false }));
  expect(plain.mdmId).toBeNull();
  expect(plain.mdmDeviceId).toBeNull();
  expect(plain.mdmLink).toBeNull();
  // An MDM sent without managed is ignored.
  const { asset: still } = expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ mdmId: a.id }));
  expect(still.mdmId).toBeNull();
  expect((await newAsset(w.admin.agent, { isManaged: true, mdmId: 999999 })).status).toBe(400);
});

it('a retired MDM stays on its devices but cannot be picked again', async () => {
  const a = await addMdm({ name: 'MDM A' });
  const b = await addMdm({ name: 'MDM B' });
  const { asset } = expectOk(await newAsset(w.admin.agent, { isManaged: true, mdmId: a.id }), 201);
  expectOk(await w.admin.agent.patch(`${API}/mdms/${a.id}`).send({ isActive: false }));
  // Saving the device again with its own (retired) MDM is fine.
  expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ name: 'Laptop 2', isManaged: true, mdmId: a.id }));
  expect((await newAsset(w.admin.agent, { isManaged: true, mdmId: a.id })).status).toBe(400);
  expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ mdmId: b.id }));
  expect((await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ mdmId: a.id })).status).toBe(400);
  const { mdms } = expectOk(await w.admin.agent.get(`${API}/mdms`));
  expect(mdms.find((m) => m.id === b.id).deviceCount).toBe(1);
});

it('on hold needs a reason; other statuses clear it; ready to issue is a status', async () => {
  expect((await newAsset(w.admin.agent, { status: 'on_hold' })).status).toBe(400);
  const { asset } = expectOk(await newAsset(w.admin.agent, { status: 'on_hold', holdReason: 'Activation Locked' }), 201);
  expect(asset.holdReason).toBe('Activation Locked');
  const { asset: ready } = expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ status: 'ready_to_issue' }));
  expect(ready.status).toBe('ready_to_issue');
  expect(ready.holdReason).toBeNull();
  expect((await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ status: 'on_hold', holdReason: ' ' })).status).toBe(400);
});

it('the asset list filters by managed and MDM', async () => {
  const a = await addMdm({ name: 'MDM A' });
  const b = await addMdm({ name: 'MDM B' });
  expectOk(await newAsset(w.admin.agent, { name: 'On A', isManaged: true, mdmId: a.id }), 201);
  expectOk(await newAsset(w.admin.agent, { name: 'On B', isManaged: true, mdmId: b.id }), 201);
  expectOk(await newAsset(w.admin.agent, { name: 'Loose' }), 201);
  const names = async (q) => expectOk(await w.admin.agent.get(`${API}/assets?${q}`)).assets.map((x) => x.name).sort();
  expect(await names('managed=true')).toEqual(['On A', 'On B']);
  expect(await names('managed=false')).toEqual(['Loose']);
  expect(await names(`mdmId=${a.id}`)).toEqual(['On A']);
});
