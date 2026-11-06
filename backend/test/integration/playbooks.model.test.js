const Sequelize = require('sequelize');
const {
  resetData, closeDb, sequelize, models,
} = require('./helpers');
const { makeWorld, makeTicket, makeCompany } = require('./fixtures');
const migration = require('../../migrations/20260101000080-playbooks');

// Sub-project PB, task 1: MDMs, managed and cellular devices, the two new
// asset statuses, forms and their versions, playbooks, ticket forms, secure
// values, suggestions, and the three permissions.

const qi = () => sequelize.getQueryInterface();
const select = (sql, replacements) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
const tableNames = async () => (await qi().showAllTables()).map((x) => (typeof x === 'string' ? x : x.tableName));

let w;
let company;
let category;
beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  company = await makeCompany(w.admin, { name: 'Playbook Co' });
  category = await models.AssetCategory.findOne({ where: { name: 'Computers' } });
});
afterAll(closeDb);

const asset = (fields = {}) => models.Asset.create({
  assetTag: `PB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: 'Laptop', categoryId: category.id, companyId: company.id, ...fields,
});

const formWithVersion = async (usage = 'device') => {
  const form = await models.Form.create({ name: 'Device check-in', usage, createdBy: w.admin.user.id });
  const version = await models.FormVersion.create({ formId: form.id, version: 1, definition: { sections: [] }, createdBy: w.admin.user.id });
  await form.update({ currentVersionId: version.id });
  return { form, version };
};

const ticketForm = async (ticket, version, fields = {}) => {
  const status = await models.TaskStatus.findOne({ where: { scope: 'ticket', isDefault: true } })
    || await models.TaskStatus.findOne({ where: { scope: 'ticket' } });
  const task = await models.Task.create({ ticketId: ticket.id, title: 'Device check-in', statusId: status.id });
  return models.TicketForm.create({ ticketId: ticket.id, formVersionId: version.id, taskId: task.id, ...fields });
};

it('devices default to not managed and no cellular; managed, MDM, cellular, carrier and a hold reason save', async () => {
  const plain = await asset();
  expect(plain.isManaged).toBe(false);
  expect(plain.hasCellular).toBe(false);
  expect((await plain.reload()).mdmId).toBeNull();

  const mdm = await models.Mdm.create({ name: 'MDM A', consoleUrl: 'https://mdm.example/devices/{id}' });
  expect(mdm.isActive).toBe(true);
  await expect(models.Mdm.create({ name: 'MDM A' })).rejects.toThrow();

  const carrier = await makeCompany(w.admin, { name: 'Carrier Co', isVendor: true });
  const phone = await asset({
    isManaged: true, mdmId: mdm.id, mdmDeviceId: '1487', hasCellular: true, imei: '353918114826117', phoneNumber: '(979) 555-0142', carrierCompanyId: carrier.id,
  });
  const fresh = await models.Asset.findByPk(phone.id, { include: [{ model: models.Mdm, as: 'mdm' }, { model: models.Company, as: 'carrier' }] });
  expect(fresh.mdm.name).toBe('MDM A');
  expect(fresh.carrier.name).toBe('Carrier Co');
  expect(fresh.imei).toBe('353918114826117');
});

it('the two new statuses save; categories can default to cellular', async () => {
  const ready = await asset({ status: 'ready_to_issue' });
  const held = await asset({ status: 'on_hold', holdReason: 'Activation Locked' });
  expect((await models.Asset.findByPk(ready.id)).status).toBe('ready_to_issue');
  expect((await models.Asset.findByPk(held.id)).holdReason).toBe('Activation Locked');
  const phones = await models.AssetCategory.create({ name: `Phones ${Date.now()}`, cellularByDefault: true });
  expect((await models.AssetCategory.findByPk(phones.id)).cellularByDefault).toBe(true);
  expect((await models.AssetCategory.findByPk(category.id)).cellularByDefault).toBe(false);
  await phones.destroy();
});

it('a form keeps numbered versions, one number each', async () => {
  const { form, version } = await formWithVersion();
  await expect(models.FormVersion.create({ formId: form.id, version: 1, definition: { sections: [] } })).rejects.toThrow();
  await models.FormVersion.create({ formId: form.id, version: 2, definition: { sections: [{ key: 's1', title: 'Step 1', items: [] }] } });
  const loaded = await models.Form.findByPk(form.id, { include: [{ model: models.FormVersion, as: 'versions' }] });
  expect(loaded.versions.map((v) => v.version).sort()).toEqual([1, 2]);
  expect(loaded.currentVersionId).toBe(version.id);
  expect(loaded.isActive).toBe(true);
});

it('a ticket form has one task, one secret per item, and goes with its ticket', async () => {
  const { version } = await formWithVersion();
  const playbook = await models.Playbook.create({
    name: 'Account termination', needsPerson: true, blocks: [{ formId: version.formId, applies: 'person_devices', limits: {} }], createdBy: w.admin.user.id,
  });
  const ticket = await makeTicket(w.admin.agent, { title: 'Termination: J. Reyes', contactId: w.contact.id });
  const applied = await models.TicketPlaybook.create({
    ticketId: ticket.id, playbookId: playbook.id, snapshot: playbook.toJSON(), contactId: w.contact.id, appliedBy: w.admin.user.id, appliedAt: new Date(),
  });
  const device = await asset();
  const tf = await ticketForm(ticket, version, { ticketPlaybookId: applied.id, assetId: device.id });
  expect(tf.state).toBe('open');
  expect(tf.answers).toEqual({});

  // One ticket form per task.
  await expect(models.TicketForm.create({ ticketId: ticket.id, formVersionId: version.id, taskId: tf.taskId })).rejects.toThrow();

  // One secret per item of a ticket form.
  await models.TicketFormSecret.create({ ticketFormId: tf.id, itemKey: 'bypass', ciphertext: 'x', setBy: w.admin.user.id, setAt: new Date() });
  await expect(models.TicketFormSecret.create({ ticketFormId: tf.id, itemKey: 'bypass', ciphertext: 'y', setAt: new Date() })).rejects.toThrow();

  const loaded = await models.Ticket.findByPk(ticket.id, {
    include: [{ model: models.TicketPlaybook, as: 'playbooks' }, { model: models.TicketForm, as: 'forms', include: ['task', 'asset', 'secrets'] }],
  });
  expect(loaded.playbooks).toHaveLength(1);
  expect(loaded.forms[0].task.id).toBe(tf.taskId);
  expect(loaded.forms[0].asset.id).toBe(device.id);
  expect(loaded.forms[0].secrets).toHaveLength(1);

  // The ticket's forms, playbooks and secrets go with it.
  await models.Ticket.destroy({ where: { id: ticket.id } });
  expect(await models.TicketForm.count({ where: { ticketId: ticket.id } })).toBe(0);
  expect(await models.TicketPlaybook.count({ where: { ticketId: ticket.id } })).toBe(0);
  expect(await models.TicketFormSecret.count({ where: { ticketFormId: tf.id } })).toBe(0);
});

it('a device removed from PRISM leaves its ticket form, without the device', async () => {
  const { version } = await formWithVersion();
  const ticket = await makeTicket(w.admin.agent, { title: 'Check-in', contactId: w.contact.id });
  const device = await asset();
  const tf = await ticketForm(ticket, version, { assetId: device.id });
  await device.destroy();
  expect((await models.TicketForm.findByPk(tf.id)).assetId).toBeNull();
});

it('one suggestion per ticket and playbook', async () => {
  const playbook = await models.Playbook.create({ name: 'New account', blocks: [] });
  const ticket = await makeTicket(w.admin.agent, { title: 'New account: T. Brooks', contactId: w.contact.id });
  await models.TicketPlaybookSuggestion.create({ ticketId: ticket.id, playbookId: playbook.id });
  await expect(models.TicketPlaybookSuggestion.create({ ticketId: ticket.id, playbookId: playbook.id })).rejects.toThrow();
});

it('the three permissions belong to exactly the seeded roles', async () => {
  const holders = async (key) => (await select(
    `SELECT r.name FROM RolePermissions rp JOIN Roles r ON r.id = rp.roleId JOIN Permissions p ON p.id = rp.permissionId
      WHERE p.\`key\` = :key AND rp.granted = 1 ORDER BY r.name`,
    { key }
  )).map((h) => h.name);
  expect(await holders('settings.manage_playbooks')).toEqual(['System Administrator']);
  expect(await holders('tickets.view_secure_fields')).toEqual(['System Administrator', 'System Technician']);
  expect(await holders('tickets.override_checklist')).toEqual(['System Administrator']);
});

it('round trip: down maps the new statuses back and removes everything; up puts it back', async () => {
  const ready = await asset({ status: 'ready_to_issue' });
  const held = await asset({ status: 'on_hold', holdReason: 'Waiting on a part' });
  await migration.down(qi(), Sequelize);
  try {
    const tables = await tableNames();
    for (const t of ['Mdms', 'Forms', 'FormVersions', 'Playbooks', 'TicketPlaybooks', 'TicketForms', 'TicketFormSecrets', 'TicketPlaybookSuggestions']) {
      expect(tables).not.toContain(t);
    }
    const [r] = await select('SELECT status FROM Assets WHERE id = ?', [ready.id]);
    const [h] = await select('SELECT status FROM Assets WHERE id = ?', [held.id]);
    expect(r.status).toBe('in_storage');
    expect(h.status).toBe('in_repair');
    const columns = (await select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets'")).map((x) => x.c);
    expect(columns).not.toEqual(expect.arrayContaining(['isManaged']));
    expect(columns).not.toContain('imei');
    expect(await select("SELECT id FROM Permissions WHERE `key` IN ('settings.manage_playbooks','tickets.view_secure_fields','tickets.override_checklist')")).toHaveLength(0);
  } finally {
    await migration.up(qi(), Sequelize);
  }
  await migration.up(qi(), Sequelize); // idempotent
  await ready.reload();
  await ready.update({ status: 'ready_to_issue', isManaged: false });
  expect((await models.Asset.findByPk(ready.id)).status).toBe('ready_to_issue');
  expect(await select("SELECT id FROM Permissions WHERE `key` IN ('settings.manage_playbooks','tickets.view_secure_fields','tickets.override_checklist')")).toHaveLength(3);
});
