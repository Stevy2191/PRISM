const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');

// Sub-project PB, task 4: export and import of forms and playbooks.

let w;
let mdmA;
let macs;
beforeEach(async () => {
  await resetData();
  await models.AssetCategory.destroy({ where: { name: ['PB Macs', 'PB Apple computers'] } });
  w = await makeWorld();
  mdmA = await models.Mdm.create({ name: 'MDM A' });
  macs = await models.AssetCategory.create({ name: 'PB Macs' });
});
afterAll(closeDb);

const checkIn = () => ({
  sections: [{
    key: 's1',
    title: 'Wipe',
    items: [
      { key: 'wipe_a', kind: 'step', body: 'Wipe it in MDM A', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: mdmA.id }] },
      { key: 'mac', kind: 'step', body: 'Mac only', showWhen: [{ on: 'device', field: 'categoryId', op: 'in', value: [macs.id] }] },
      { key: 'checkin', kind: 'action', action: 'check_in' },
    ],
  }],
});

async function exported() {
  const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({ name: 'Check-in', usage: 'device', definition: checkIn() }), 201).form;
  const { playbook } = expectOk(await w.admin.agent.post(`${API}/playbooks`).send({
    name: 'Termination', needsPerson: true, blocks: [{ formId: form.id, applies: 'person_devices', limits: { mdmIds: [mdmA.id], categoryIds: [macs.id] } }],
  }), 201);
  return expectOk(await w.admin.agent.post(`${API}/playbooks/export`).send({ playbookIds: [playbook.id] }));
}

it('exports by name, not id', async () => {
  const file = await exported();
  expect(file.format).toBe('prism-playbooks');
  expect(file.forms).toHaveLength(1);
  const items = file.forms[0].definition.sections[0].items;
  expect(items[0].showWhen[0].value).toEqual({ $ref: 'mdm', name: 'MDM A' });
  expect(items[1].showWhen[0].value).toEqual([{ $ref: 'category', name: 'PB Macs' }]);
  expect(file.playbooks[0].blocks[0]).toMatchObject({ form: file.forms[0].ref, limits: { mdms: ['MDM A'], categories: ['PB Macs'] } });
});

it('imports matching names, saving everything inactive', async () => {
  const file = await exported();
  const result = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file }), 201);
  expect(result.imported).toBe(true);
  const form = await models.Form.findByPk(result.forms[0].id, { include: ['currentVersion'] });
  expect(form.isActive).toBe(false);
  expect(form.currentVersion.definition.sections[0].items[0].showWhen[0].value).toBe(mdmA.id);
  const playbook = await models.Playbook.findByPk(result.playbooks[0].id);
  expect(playbook.isActive).toBe(false);
  expect(playbook.blocks[0]).toMatchObject({ formId: form.id, limits: { mdmIds: [mdmA.id], categoryIds: [macs.id] } });
});

it('reports names it cannot match; a mapping points them here or drops them', async () => {
  const file = await exported();
  await models.Mdm.update({ name: 'Our MDM' }, { where: { id: mdmA.id } });
  await models.AssetCategory.update({ name: 'PB Apple computers' }, { where: { id: macs.id } });

  const dry = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file, dryRun: true }));
  expect(dry.imported).toBe(false);
  expect(dry.needs.filter((n) => !n.resolved).map((n) => `${n.kind}:${n.name}`).sort()).toEqual(['category:PB Macs', 'mdm:MDM A']);
  const refused = await w.admin.agent.post(`${API}/playbooks/import`).send({ file });
  expect(refused.status).toBe(409);
  expect(refused.body.code).toBe('IMPORT_NEEDS_MAPPING');
  expect(await models.Form.count()).toBe(1); // nothing new saved

  const result = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({
    file, mapping: { mdm: { 'MDM A': mdmA.id }, category: { 'PB Macs': null } },
  }), 201);
  const form = await models.Form.findByPk(result.forms[0].id, { include: ['currentVersion'] });
  const items = form.currentVersion.definition.sections[0].items;
  expect(items[0].showWhen[0].value).toBe(mdmA.id);
  expect(items[1].showWhen).toBeUndefined(); // its only category was dropped
  const playbook = await models.Playbook.findByPk(result.playbooks[0].id);
  expect(playbook.blocks[0].limits).toEqual({ mdmIds: [mdmA.id] });

  expect((await w.admin.agent.post(`${API}/playbooks/import`).send({ file, mapping: { mdm: { 'MDM A': 999999 }, category: { 'PB Macs': null } } })).status).toBe(400);
});

it('refuses a file that is not one, or whose forms break the rules, saving nothing', async () => {
  expect((await w.admin.agent.post(`${API}/playbooks/import`).send({ file: { hello: 1 } })).status).toBe(400);
  const file = await exported();
  const before = await models.Form.count();

  const scripted = JSON.parse(JSON.stringify(file));
  scripted.forms[0].definition.sections[0].items[1].body = '<p>ok</p><script>alert(1)</script>';
  const ok = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file: scripted }), 201);
  const form = await models.Form.findByPk(ok.forms[0].id, { include: ['currentVersion'] });
  expect(JSON.stringify(form.currentVersion.definition)).not.toMatch(/script/);

  for (const breakIt of [
    (f) => { f.forms[0].definition.sections[0].items[0].kind = 'shell'; },
    (f) => { f.forms[0].definition.sections[0].items[0].showWhen = [{ on: 'answer', field: 'checkin', op: 'is', value: true }]; },
    (f) => { f.forms[0].definition.sections[0] = 'nope'; },
    (f) => { f.forms[0].usage = 'ticket'; },
    (f) => { f.playbooks[0].blocks[0].form = 'missing'; },
  ]) {
    const bad = JSON.parse(JSON.stringify(file));
    breakIt(bad);
    // eslint-disable-next-line no-await-in-loop
    const res = await w.admin.agent.post(`${API}/playbooks/import`).send({ file: bad });
    expect(res.status).toBe(400);
  }
  expect(await models.Form.count()).toBe(before + 1); // only the cleaned one
});
