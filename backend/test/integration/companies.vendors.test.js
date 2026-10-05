const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeProject, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Plan 2b task 3: vendor companies. Vendor-only companies are shared
// reference data; a company that is also a client is fenced like a client.

const { Company } = models;

let w;
let category;
let dell;
let acme;
let fenced;
const a = () => w.admin.agent;
const expectErr = (res, status, code, message) => {
  expect({ status: res.status, body: res.body }).toEqual({ status, body: { error: true, message, code } });
};
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  w = await makeWorld();
  category = await models.AssetCategory.create({ name: 'Laptops' });
  dell = await Company.create({ name: 'Dell', isVendor: true });
  acme = await makeCompany(w.admin, { name: 'Acme', isClient: true, isVendor: true });
  const internalId = (await Company.findOne({ where: { isInternal: true } })).id;
  fenced = await makeTech('fenced', w.deptA.id);
  await setCompanyAccess(w.admin, fenced.user.id, { allCompanies: false, companyIds: [internalId] });
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: 'Laptops' } });
  await closeDb();
});
const newAsset = (body, agent = a()) => agent.post(`${API}/assets`).send({ name: 'L', categoryId: category.id, ...body });

it('the vendor picker offers shared vendors to everyone, and a client-vendor only to those who reach it', async () => {
  const names = async (agent) => expectOk(await agent.get(`${API}/companies/vendors`)).vendors.map((v) => v.name);
  expect(await names(a())).toEqual(['Acme', 'Dell']);
  expect(await names(fenced.agent)).toEqual(['Dell']);
  expect(expectOk(await a().get(`${API}/companies/vendors?search=de`)).vendors.map((v) => v.name)).toEqual(['Dell']);
});

it('an asset can be bought from a vendor company, and its vendor text follows the company', async () => {
  const asset = expectOk(await newAsset({ assetTag: 'A-1', vendorCompanyId: dell.id, vendorName: 'typo' }), 201).asset;
  expect(asset.vendorCompany).toEqual({ id: dell.id, name: 'Dell' });
  expect(asset.vendorName).toBe('Dell');
});

it('the vendor must be an active vendor company the user may pick', async () => {
  const clientOnly = await makeCompany(w.admin, { name: 'Globex' });
  const retired = await Company.create({ name: 'Old Vendor', isVendor: true, status: 'inactive' });
  for (const [tag, vendorCompanyId] of [['B-1', clientOnly.id], ['B-2', retired.id], ['B-3', 'abc'], ['B-4', 99999], ['B-5', `${dell.id}x`]]) {
    // eslint-disable-next-line no-await-in-loop
    expectErr(await newAsset({ assetTag: tag, vendorCompanyId }), 400, 'VALIDATION_ERROR', 'Unknown vendor');
  }
  // Acme is a vendor too, but the fenced user can't reach it: the same answer.
  expectErr(await newAsset({ assetTag: 'B-6', vendorCompanyId: acme.id }, fenced.agent), 400, 'VALIDATION_ERROR', 'Unknown vendor');
  expectOk(await newAsset({ assetTag: 'B-7', vendorCompanyId: dell.id }, fenced.agent), 201);
});

it('re-sending the current vendor after it is deactivated still saves', async () => {
  const asset = expectOk(await newAsset({ assetTag: 'C-1', vendorCompanyId: dell.id }), 201).asset;
  await dell.update({ status: 'inactive' });
  expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ vendorCompanyId: dell.id, notes: 'x' }));
  const cleared = expectOk(await a().patch(`${API}/assets/${asset.id}`).send({ vendorCompanyId: null })).asset;
  expect(cleared.vendorCompanyId).toBeNull();
});

it('licenses, contracts and project materials take a vendor company too', async () => {
  const license = expectOk(await a().post(`${API}/licenses`).send({ name: 'Office', vendorCompanyId: dell.id }), 201).license;
  expect([license.vendor, license.vendorCompany]).toEqual(['Dell', { id: dell.id, name: 'Dell' }]);
  // A contract needs a vendor: the company alone is enough.
  const contract = expectOk(await a().post(`${API}/contracts`).send({ name: 'Support', vendorCompanyId: dell.id }), 201).contract;
  expect([contract.vendor, contract.vendorCompany]).toEqual(['Dell', { id: dell.id, name: 'Dell' }]);
  expectErr(await a().post(`${API}/contracts`).send({ name: 'No vendor' }), 400, 'VALIDATION_ERROR', 'Vendor is required');
  const project = await makeProject(a(), { name: 'P', ownerDepartmentId: w.deptA.id });
  const material = expectOk(await a().post(`${API}/projects/${project.id}/materials`).send({ itemName: 'Switch', quantity: 1, unitCost: 5, vendorCompanyId: dell.id }), 201).material;
  expect([material.vendor, material.vendorCompanyId]).toEqual(['Dell', dell.id]);
  const { materials } = expectOk(await a().get(`${API}/projects/${project.id}/materials`));
  expect(materials[0].vendorCompany).toEqual({ id: dell.id, name: 'Dell' });
});

it('asset, license and contract lists filter by vendor', async () => {
  expectOk(await newAsset({ assetTag: 'D-1', vendorCompanyId: dell.id }), 201);
  expectOk(await newAsset({ assetTag: 'D-2' }), 201);
  const tags = expectOk(await a().get(`${API}/assets?vendorCompanyId=${dell.id}`)).assets.map((x) => x.assetTag);
  expect(tags).toEqual(['D-1']);
  expect(expectOk(await a().get(`${API}/assets?vendorCompanyId=abc`)).assets).toEqual([]);
  expectOk(await a().post(`${API}/licenses`).send({ name: 'L1', vendorCompanyId: dell.id }), 201);
  expect(expectOk(await a().get(`${API}/licenses?vendorCompanyId=${dell.id}`)).licenses).toHaveLength(1);
  expectOk(await a().post(`${API}/contracts`).send({ name: 'K1', vendorCompanyId: dell.id }), 201);
  expect(expectOk(await a().get(`${API}/contracts?vendorCompanyId=${dell.id}`)).contracts).toHaveLength(1);
});
