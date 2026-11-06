const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeTech, makeCompany, setCompanyAccess,
} = require('./fixtures');

// Sub-project PB, task 3: cellular on devices (IMEI, phone number, carrier)
// and the category default.

const IMEI = '353918114826114'; // valid check digit
const IMEI2 = '490154203237518';

let w;
let category;
let carrier;
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'Phones PB' } });
  w = await makeWorld();
  category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
  carrier = await makeCompany(w.admin, { name: 'Wireless Co', isVendor: true, isClient: false });
});
afterAll(closeDb);

const newAsset = (agent, body) => agent.post(`${API}/assets`).send({ name: 'Phone', categoryId: category.id, ...body });
const cell = (extra = {}) => ({
  hasCellular: true, imei: IMEI, phoneNumber: '(979) 555-0142', carrierCompanyId: carrier.id, ...extra,
});

it('saves IMEI, phone number and carrier; the phone is stored as digits', async () => {
  const { asset, warnings } = expectOk(await newAsset(w.admin.agent, cell({ imei: '35 391811 482611 4' })), 201);
  expect(asset).toMatchObject({ hasCellular: true, imei: IMEI, phoneNumber: '9795550142' });
  expect(asset.carrier).toMatchObject({ id: carrier.id, name: 'Wireless Co' });
  expect(warnings).toEqual([]);
});

it('checks the IMEI check digit and length', async () => {
  expect((await newAsset(w.admin.agent, cell({ imei: '353918114826117' }))).status).toBe(400);
  expect((await newAsset(w.admin.agent, cell({ imei: '12345' }))).status).toBe(400);
  // IMEI is required with cellular; a data-only line has no phone number.
  expect((await newAsset(w.admin.agent, cell({ imei: '' }))).status).toBe(400);
  expectOk(await newAsset(w.admin.agent, cell({ phoneNumber: '' })), 201);
});

it('the carrier must be a vendor company the user may use', async () => {
  const client = await makeCompany(w.admin, { name: 'Client Co' });
  expect((await newAsset(w.admin.agent, cell({ carrierCompanyId: client.id }))).status).toBe(400);
  expect((await newAsset(w.admin.agent, cell({ carrierCompanyId: 999999 }))).status).toBe(400);
});

it("hides a carrier the viewer can't reach (one that is also a client); a plain vendor is shared", async () => {
  const fencedCarrier = await makeCompany(w.admin, { name: 'Client Wireless', isVendor: true });
  const { asset } = expectOk(await newAsset(w.admin.agent, cell({ carrierCompanyId: fencedCarrier.id })), 201);
  const { asset: shared } = expectOk(await newAsset(w.admin.agent, cell({ imei: IMEI2, phoneNumber: '' })), 201);
  const tech = await makeTech('fenced', w.deptA.id);
  const internal = await models.Company.findOne({ where: { isInternal: true } });
  await setCompanyAccess(w.admin, tech.user.id, { allCompanies: false, companyIds: [internal.id] });
  const seen = expectOk(await tech.agent.get(`${API}/assets/${asset.id}`)).asset;
  expect(seen.carrier).toBeNull();
  expect(expectOk(await tech.agent.get(`${API}/assets/${shared.id}`)).asset.carrier.name).toBe('Wireless Co');
});

it('turning cellular off clears the line details', async () => {
  const { asset } = expectOk(await newAsset(w.admin.agent, cell()), 201);
  const { asset: off } = expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ hasCellular: false }));
  expect(off).toMatchObject({ hasCellular: false, imei: null, phoneNumber: null, carrierCompanyId: null });
  // Line details sent without cellular are ignored.
  const { asset: still } = expectOk(await w.admin.agent.patch(`${API}/assets/${asset.id}`).send({ imei: IMEI }));
  expect(still.imei).toBeNull();
});

it('warns, without refusing, when another active device has the same IMEI or number', async () => {
  const first = expectOk(await newAsset(w.admin.agent, cell()), 201).asset;
  const second = expectOk(await newAsset(w.admin.agent, cell()), 201);
  expect(second.warnings.sort()).toEqual(['IMEI_IN_USE', 'PHONE_IN_USE']);
  // A retired or lost device doesn't count.
  expectOk(await w.admin.agent.patch(`${API}/assets/${first.id}`).send({ status: 'retired' }));
  const third = expectOk(await w.admin.agent.patch(`${API}/assets/${second.asset.id}`).send({ imei: IMEI2, hasCellular: true }));
  expect(third.warnings).toEqual([]);
});

it('a category can start new devices with cellular on', async () => {
  const phones = expectOk(await w.admin.agent.post(`${API}/assets/categories`).send({ name: 'Phones PB', cellularByDefault: true }), 201).category;
  expect(phones.cellularByDefault).toBe(true);
  const { asset } = expectOk(await w.admin.agent.post(`${API}/assets`).send({ name: 'iPhone', categoryId: phones.id, imei: IMEI }), 201);
  expect(asset.hasCellular).toBe(true);
  // Unless the device says otherwise.
  const { asset: wifi } = expectOk(await w.admin.agent.post(`${API}/assets`).send({ name: 'iPad Wi-Fi', categoryId: phones.id, hasCellular: false }), 201);
  expect(wifi.hasCellular).toBe(false);
  const { category: off } = expectOk(await w.admin.agent.patch(`${API}/assets/categories/${phones.id}`).send({ cellularByDefault: false }));
  expect(off.cellularByDefault).toBe(false);
});

it('the asset list filters by cellular and carrier, and its search finds a phone number or IMEI', async () => {
  expectOk(await newAsset(w.admin.agent, cell({ name: 'Line one' })), 201);
  expectOk(await newAsset(w.admin.agent, { name: 'No line' }), 201);
  const names = async (q) => expectOk(await w.admin.agent.get(`${API}/assets?${q}`)).assets.map((x) => x.name).sort();
  expect(await names('hasCellular=true')).toEqual(['Line one']);
  expect(await names('hasCellular=false')).toEqual(['No line']);
  expect(await names(`carrierCompanyId=${carrier.id}`)).toEqual(['Line one']);
  expect(await names(`search=${encodeURIComponent('(979) 555-0142')}`)).toEqual(['Line one']);
  expect(await names('search=482611')).toEqual(['Line one']);
});
