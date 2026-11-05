const { resetData, closeDb, models } = require('./helpers');
const {
  API, expectOk, makeWorld, makeCompany,
} = require('./fixtures');

// Deleting a client's department (now done from its company page) clears it
// from that company's contacts and assets instead of leaving a dangling id.

let w;
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: 'DelProbe' } });
  w = await makeWorld();
});
afterAll(closeDb);

it('deleting a department clears it from its contacts and assets', async () => {
  const acme = await makeCompany(w.admin, { name: 'Acme' });
  const hr = expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201).department;
  const ann = await models.Contact.create({ firstName: 'Ann', displayName: 'Ann', email: 'ann@acme.test', companyId: acme.id, departmentId: hr.id });
  const category = await models.AssetCategory.create({ name: 'DelProbe' });
  const laptop = await models.Asset.create({ assetTag: 'DEL-1', name: 'x', categoryId: category.id, companyId: acme.id, departmentId: hr.id });

  expectOk(await w.admin.agent.delete(`${API}/departments/${hr.id}`));
  expect(await models.Department.findByPk(hr.id)).toBeNull();
  expect((await models.Contact.findByPk(ann.id)).departmentId).toBeNull();
  expect((await models.Asset.findByPk(laptop.id)).departmentId).toBeNull();
  // The contact still opens.
  expectOk(await w.admin.agent.get(`${API}/contacts/${ann.id}`));
});

it('the departments list says which company each one is in, and whether it is the help desk\'s own', async () => {
  const acme = await makeCompany(w.admin, { name: 'Acme' });
  expectOk(await w.admin.agent.post(`${API}/departments`).send({ name: 'HR', companyId: acme.id }), 201);
  const list = expectOk(await w.admin.agent.get(`${API}/departments`)).departments;
  const hr = list.find((d) => d.name === 'HR');
  expect(hr.company).toMatchObject({ id: acme.id, name: 'Acme', isInternal: false });
  expect(list.find((d) => d.id === w.deptA.id).company.isInternal).toBe(true);
});
