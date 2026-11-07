const Sequelize = require('sequelize');
const {
  sequelize, resetData, closeDb, models,
} = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');
const migration = require('../../migrations/20260101000082-checklists-simpler');
const { validateDefinition, evaluate } = require('../../src/services/playbooks/formDefinition');
const { deviceContext } = require('../../src/services/playbooks/resolve');

// PB2 task 1: migration 082, and the `mdm` device field "Only for" uses.

let w;
let mdmA;
let mdmB;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  mdmA = await models.Mdm.create({ name: 'Jamf Test' });
  mdmB = await models.Mdm.create({ name: 'Intune Test' });
});
afterAll(closeDb);

const qi = () => sequelize.getQueryInterface();
const select = (sql) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT });
const columns = async (table) => (await select(
  `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
)).map((r) => r.c);

// "Only for Jamf or not managed".
const onlyFor = (values) => ({
  sections: [{
    key: 's1',
    title: 'Wipe',
    items: [
      { key: 'wipe', kind: 'step', body: 'Wipe it', showWhen: [{ on: 'device', field: 'mdm', op: 'in', value: values }] },
      { key: 'always', kind: 'step', body: 'Always' },
    ],
  }],
});

describe('the mdm device field', () => {
  it("is the MDM when managed, and 'none' otherwise", () => {
    expect(deviceContext({ isManaged: true, mdmId: 7, categoryId: 1 }).mdm).toBe(7);
    expect(deviceContext({ isManaged: false, mdmId: 7, categoryId: 1 }).mdm).toBe('none');
    expect(deviceContext({ isManaged: true, mdmId: null, categoryId: 1 }).mdm).toBe('none');
  });

  it('shows "Jamf or not managed" for both, and hides it for another MDM', () => {
    const def = validateDefinition(onlyFor([mdmA.id, 'none']), { usage: 'device' });
    const shown = (asset) => evaluate(def, { device: deviceContext(asset) }).sections[0].items[0].shown;
    expect(shown({ isManaged: true, mdmId: mdmA.id })).toBe(true);
    expect(shown({ isManaged: false, mdmId: null })).toBe(true);
    expect(shown({ isManaged: true, mdmId: mdmB.id })).toBe(false);
  });

  it('is a device field only', () => {
    expect(() => validateDefinition(onlyFor(['none']), { usage: 'ticket' })).toThrow(/per device/i);
  });

  it("exports MDMs by name and keeps 'none'; importing maps the names back", async () => {
    const form = expectOk(await w.admin.agent.post(`${API}/forms`).send({ name: 'Only for', usage: 'device', definition: onlyFor([mdmA.id, 'none']) }), 201).form;
    const file = expectOk(await w.admin.agent.post(`${API}/playbooks/export`).send({ formIds: [form.id] }));
    expect(file.forms[0].definition.sections[0].items[0].showWhen[0].value).toEqual([{ $ref: 'mdm', name: 'Jamf Test' }, 'none']);
    const result = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file }), 201);
    const imported = await models.Form.findByPk(result.forms[0].id, { include: ['currentVersion'] });
    expect(imported.currentVersion.definition.sections[0].items[0].showWhen[0].value).toEqual([mdmA.id, 'none']);
  });
});

describe('migration 082', () => {
  it('stores the person on a checklist added on its own, and a bundle\'s categories', async () => {
    const playbook = await models.Playbook.create({ name: 'Termination', suggestCategoryIds: [3, 4] });
    expect((await models.Playbook.findByPk(playbook.id)).suggestCategoryIds).toEqual([3, 4]);
    expect(await columns('TicketForms')).toContain('contactId');
    const [fk] = await select(`SELECT REFERENCED_TABLE_NAME AS t FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TicketForms' AND COLUMN_NAME = 'contactId' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    expect(fk.t).toBe('Contacts');
  });

  it('gives the permissions the screens\' words', async () => {
    const rows = await select("SELECT `key`, label FROM Permissions WHERE `key` IN ('settings.manage_playbooks','tickets.view_secure_fields','tickets.override_checklist') ORDER BY `key`");
    expect(Object.fromEntries(rows.map((r) => [r.key, r.label]))).toEqual({
      'settings.manage_playbooks': 'Manage checklists, bundles and MDMs',
      'tickets.override_checklist': 'Close tickets with unfinished checklists',
      'tickets.view_secure_fields': 'Reveal hidden passwords and codes on checklists',
    });
  });

  it('rolls back and forward again', async () => {
    await migration.down(qi(), Sequelize);
    try {
      expect(await columns('TicketForms')).not.toContain('contactId');
      expect(await columns('Playbooks')).not.toContain('suggestCategoryIds');
      const [perm] = await select("SELECT label FROM Permissions WHERE `key` = 'settings.manage_playbooks'");
      expect(perm.label).toBe('Manage forms, playbooks and MDMs');
    } finally {
      await migration.up(qi(), Sequelize);
    }
    await migration.up(qi(), Sequelize); // idempotent
    expect(await columns('TicketForms')).toContain('contactId');
    expect(await columns('Playbooks')).toContain('suggestCategoryIds');
  });
});
