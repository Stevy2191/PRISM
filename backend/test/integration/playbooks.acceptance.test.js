const { resetData, closeDb, models } = require('./helpers');
const { API, expectOk, makeWorld } = require('./fixtures');
const { evaluate } = require('../../src/services/playbooks/formDefinition');
const checkOutFile = require('../fixtures/playbooks/apple-check-out.json');
const checkInFile = require('../fixtures/playbooks/apple-check-in.json');

// Sub-project PB, task 13: the owner's two documents (2026-11-05), "Apple
// Device Check-Out: Enroll and Assign" and "Apple Device Check-In:
// Deprovision for Reuse", built with the form builder's rules and no code
// changes. They are test data only, never seeded. They import into an
// install by name, as any shared file would.

let w;
let ids;

async function ensureCategory(name) {
  const [c] = await models.AssetCategory.findOrCreate({ where: { name }, defaults: { name } });
  return c.id;
}

async function importForm(file) {
  const dry = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file, dryRun: true }));
  expect(dry.needs.filter((n) => !n.resolved)).toEqual([]);
  const result = expectOk(await w.admin.agent.post(`${API}/playbooks/import`).send({ file }), 201);
  const form = await models.Form.findByPk(result.forms[0].id, { include: ['currentVersion'] });
  return form.currentVersion.definition;
}

beforeEach(async () => {
  await resetData();
  w = await makeWorld();
  ids = {
    jamf: (await models.Mdm.create({ name: 'Jamf Pro' })).id,
    me: (await models.Mdm.create({ name: 'ManageEngine' })).id,
    mac: await ensureCategory('Mac'),
    iphone: await ensureCategory('iPhone'),
    ipad: await ensureCategory('iPad'),
  };
});
afterAll(async () => {
  await models.AssetCategory.destroy({ where: { name: ['Mac', 'iPhone', 'iPad'] } }).catch(() => {});
  await closeDb();
});

const device = (categoryId, mdmId) => ({
  categoryId, isManaged: true, mdmId, hasCellular: false, hasAgent: false, companyId: 1,
});
const shown = (state) => new Set(state.sections.flatMap((s) => s.items).filter((i) => i.shown).map((i) => i.key));
const done = { done: true, by: 1, at: '2026-11-06T10:00:00Z' };

describe('Apple Device Check-Out: Enroll and Assign', () => {
  it('a Mac on Jamf Pro shows the Jamf and Mac steps only', async () => {
    const def = await importForm(checkOutFile);
    expect(def.sections.map((s) => s.title)).toEqual([
      'Before you start', 'Step 1: Confirm the device is in Apple Business Manager', 'Step 2: Assign the device to the right MDM',
      "Step 3: Create the user's Managed Apple Account", 'Step 4: Set up and enroll the device', 'Step 5: Verify in the MDM and assign to the user',
      'Step 6: Hand off to the user and record it',
    ]);
    const s = shown(evaluate(def, { device: device(ids.mac, ids.jamf) }, {}, []));
    for (const k of ['jamf_prestage', 'jamf_scope', 'jamf_managed', 'jamf_location', 'mac_local']) expect(s.has(k)).toBe(true);
    for (const k of ['me_sync', 'me_profile', 'me_managed', 'me_assign', 'ios_signin']) expect(s.has(k)).toBe(false);
  });

  it('an iPhone on ManageEngine shows the ManageEngine and iPhone steps', async () => {
    const def = await importForm(checkOutFile);
    const s = shown(evaluate(def, { device: device(ids.iphone, ids.me) }, {}, []));
    for (const k of ['me_sync', 'me_profile', 'me_managed', 'me_assign', 'ios_signin']) expect(s.has(k)).toBe(true);
    for (const k of ['jamf_prestage', 'jamf_location', 'mac_local']) expect(s.has(k)).toBe(false);
  });

  it('the Managed Apple Account steps follow the answers; the temporary password is a secure field', async () => {
    const def = await importForm(checkOutFile);
    const ctx = { device: device(ids.mac, ids.jamf) };
    expect(shown(evaluate(def, ctx, { has_maa: true }, [])).has('federated')).toBe(false);
    const manual = shown(evaluate(def, ctx, { has_maa: false, federated: false }, []));
    for (const k of ['add_user', 'role_staff', 'create_signin', 'temp_password']) expect(manual.has(k)).toBe(true);
    expect(manual.has('confirm_entra')).toBe(false);
    const federated = shown(evaluate(def, ctx, { has_maa: false, federated: true }, []));
    expect(federated.has('confirm_entra')).toBe(true);
    expect(federated.has('add_user')).toBe(false);
    // Already has one: the federated answer no longer counts, so neither path shows.
    const already = shown(evaluate(def, ctx, { has_maa: true, federated: false }, []));
    expect(already.has('add_user')).toBe(false);
    expect(def.sections[3].items.find((i) => i.key === 'temp_password').kind).toBe('secure');
  });

  it('the check-out is the last step, ready once every required step that shows is done', async () => {
    const def = await importForm(checkOutFile);
    const items = def.sections.flatMap((s) => s.items);
    expect(items[items.length - 1]).toMatchObject({ kind: 'action', action: 'check_out' });
    const ctx = { device: device(ids.mac, ids.jamf) };
    const answers = { in_abm: true, has_maa: true };
    let state = evaluate(def, ctx, answers, []);
    expect(state.actionReady).toBe(false);
    for (const item of items) {
      const e = state.sections.flatMap((s) => s.items).find((i) => i.key === item.key);
      if (!e.shown || !e.required || e.done || item.kind === 'action') continue; // eslint-disable-line no-continue
      if (item.kind === 'step') answers[item.key] = done;
      if (item.kind === 'field') answers[item.key] = item.fieldType === 'choice' ? item.options[0] : item.fieldType === 'date' ? '2026-11-06' : 'x';
    }
    state = evaluate(def, ctx, answers, []);
    expect(state.actionReady).toBe(true);
    expect(state.finished).toBe(false);
  });
});

describe('Apple Device Check-In: Deprovision for Reuse', () => {
  it('a Mac on Jamf Pro: the Jamf wipe for a Mac, the Mac passcode, no ManageEngine or iPhone steps', async () => {
    const def = await importForm(checkInFile);
    expect(def.sections).toHaveLength(9);
    const s = shown(evaluate(def, { device: device(ids.mac, ids.jamf) }, {}, []));
    for (const k of ['find_jamf', 'lock_jamf', 'signed_in_mac', 'jamf_scope', 'jamf_wipe_mac', 'mac_passcode', 'jamf_cleanup', 'bypass_code']) expect(s.has(k)).toBe(true);
    for (const k of ['find_me', 'lock_me', 'signed_in_ios', 'me_wipe', 'jamf_wipe_ios', 'me_cleanup']) expect(s.has(k)).toBe(false);
  });

  it('an iPad on ManageEngine: the Complete Wipe, iPad steps, no Mac passcode', async () => {
    const def = await importForm(checkInFile);
    const s = shown(evaluate(def, { device: device(ids.ipad, ids.me) }, {}, []));
    for (const k of ['find_me', 'lock_me', 'signed_in_ios', 'me_wipe', 'me_cleanup']) expect(s.has(k)).toBe(true);
    for (const k of ['jamf_wipe_mac', 'jamf_wipe_ios', 'mac_passcode', 'signed_in_mac']) expect(s.has(k)).toBe(false);
  });

  it('"Is the user leaving?" picks the clean-up; a legal hold adds the approval step; the lock steps show only if it appears', async () => {
    const def = await importForm(checkInFile);
    const ctx = { device: device(ids.mac, ids.jamf) };
    const staying = shown(evaluate(def, ctx, { leaving: false }, []));
    expect(staying.has('staying')).toBe(true);
    expect(staying.has('leaving_maa')).toBe(false);
    const leaving = shown(evaluate(def, ctx, { leaving: true, legal_hold: true, lock_appeared: true }, []));
    for (const k of ['leaving_maa', 'hold_approval', 'abm_off', 'use_bypass', 'locked_note']) expect(leaving.has(k)).toBe(true);
    expect(shown(evaluate(def, ctx, { lock_appeared: false }, [])).has('abm_off')).toBe(false);
  });

  it('checks in to ready to issue, in repair, or on hold (Activation Locked)', async () => {
    const def = await importForm(checkInFile);
    const items = def.sections.flatMap((s) => s.items);
    expect(items[items.length - 1]).toMatchObject({ kind: 'action', action: 'check_in', statuses: ['ready_to_issue', 'in_repair', 'on_hold'] });
    expect(items.filter((i) => i.kind === 'secure').map((i) => i.label)).toEqual(['Activation Lock bypass code', '6-digit passcode (older Intel Macs)']);
  });
});
