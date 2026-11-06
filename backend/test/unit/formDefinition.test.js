const { validateDefinition, evaluate, LIMITS } = require('../../src/services/playbooks/formDefinition');

// Sub-project PB, task 2: checking a form definition, and working out which
// steps show for a device, a person and earlier answers.

const MDM_A = 11;
const MDM_B = 12;
const MAC = 3;
const IPHONE = 4;

// A small check-in form shaped like the owner's: a step per MDM, a Mac-only
// step, a secure bypass code, a "leaving?" question that shows clean-up, and
// the check-in action last.
const checkIn = () => ({
  sections: [
    {
      key: 'start',
      title: 'Before you start',
      items: [
        { key: 'have_device', kind: 'step', body: 'You have the device and its charger.', required: true },
        { key: 'serial', kind: 'field', fieldType: 'text', label: 'Serial number', required: true },
      ],
    },
    {
      key: 'lock',
      title: 'Step 2: Activation Lock',
      items: [
        { key: 'intro', kind: 'text', body: '<p>Check this <b>before</b> the wipe.</p>' },
        { key: 'lock_a', kind: 'step', body: 'Check lock status in MDM A.', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: MDM_A }] },
        { key: 'lock_b', kind: 'step', body: 'Check lock status in MDM B.', required: true, showWhen: [{ on: 'device', field: 'mdmId', op: 'is', value: MDM_B }] },
        { key: 'bypass', kind: 'secure', label: 'Bypass code' },
        { key: 'mac_only', kind: 'step', body: 'System Settings › [name].', required: true, showWhen: [{ on: 'device', field: 'categoryId', op: 'is', value: MAC }] },
      ],
    },
    {
      key: 'cleanup',
      title: 'Step 7: Clean up',
      items: [
        { key: 'leaving', kind: 'field', fieldType: 'yesno', label: 'Is the user leaving?', required: true },
        { key: 'deactivate', kind: 'step', body: 'Deactivate their account.', required: true, showWhen: [{ on: 'answer', field: 'leaving', op: 'is', value: true }] },
      ],
    },
    {
      key: 'ready',
      title: 'Step 8: Mark the device ready',
      items: [
        { key: 'agent_seen', kind: 'agent', body: 'PRISM agent reporting.' },
        { key: 'checkin', kind: 'action', action: 'check_in', required: true },
      ],
    },
  ],
});

const macOnA = { device: { categoryId: MAC, isManaged: true, mdmId: MDM_A, hasCellular: false, hasAgent: true, companyId: 1 }, person: { companyId: 1, departmentId: 5 } };
const iphoneOnB = { device: { categoryId: IPHONE, isManaged: true, mdmId: MDM_B, hasCellular: true, hasAgent: false, companyId: 1 }, person: null };
const done = { done: true, by: 1, at: '2026-11-06T10:00:00Z' };

const shownKeys = (state) => state.sections.flatMap((s) => s.items.filter((i) => i.shown).map((i) => i.key));
const item = (state, key) => state.sections.flatMap((s) => s.items).find((i) => i.key === key);

describe('validateDefinition', () => {
  it('accepts a good definition and returns it cleaned', () => {
    const clean = validateDefinition(checkIn(), { usage: 'device' });
    expect(clean.sections).toHaveLength(4);
    expect(clean.sections[2].items[1].showWhen).toEqual([{ on: 'answer', field: 'leaving', op: 'is', value: true }]);
    // The action is required whatever was sent; text never is.
    expect(clean.sections[3].items[1].required).toBe(true);
    expect(clean.sections[1].items[0].required).toBe(false);
  });

  it('strips script from rich text and trims labels', () => {
    const def = checkIn();
    def.sections[1].items[0].body = '<p onclick="x()">Hi<script>alert(1)</script></p><img src=x onerror=alert(1)>';
    def.sections[0].items[1].label = '   Serial number   ';
    const clean = validateDefinition(def, { usage: 'device' });
    expect(clean.sections[1].items[0].body).not.toMatch(/script|onclick|onerror/i);
    expect(clean.sections[0].items[1].label).toBe('Serial number');
  });

  const refuse = (mutate, usage = 'device', status = 400) => {
    const def = checkIn();
    mutate(def);
    let err;
    try { validateDefinition(def, { usage }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.status).toBe(status);
    return err;
  };

  it('refuses an unknown kind, a missing or duplicate key, and a bad key', () => {
    expect(refuse((d) => { d.sections[0].items[0].kind = 'script'; }).code).toBe('FORM_INVALID');
    refuse((d) => { delete d.sections[0].items[0].key; });
    refuse((d) => { d.sections[0].items[1].key = 'have_device'; });
    refuse((d) => { d.sections[1].key = 'start'; });
    refuse((d) => { d.sections[0].items[0].key = 'has space'; });
  });

  it('refuses a condition on a later or unknown item, an unknown field or operator', () => {
    refuse((d) => { d.sections[0].items[0].showWhen = [{ on: 'answer', field: 'leaving', op: 'is', value: true }]; });
    refuse((d) => { d.sections[2].items[1].showWhen = [{ on: 'answer', field: 'deactivate', op: 'is', value: true }]; }); // itself
    refuse((d) => { d.sections[2].showWhen = [{ on: 'answer', field: 'leaving', op: 'is', value: true }]; }); // inside its own section
    refuse((d) => { d.sections[0].items[0].showWhen = [{ on: 'answer', field: 'nope', op: 'is', value: true }]; });
    refuse((d) => { d.sections[0].items[0].showWhen = [{ on: 'device', field: 'password', op: 'is', value: 1 }]; });
    refuse((d) => { d.sections[0].items[0].showWhen = [{ on: 'device', field: 'mdmId', op: 'matches', value: 1 }]; });
    refuse((d) => { d.sections[0].items[0].showWhen = [{ on: 'device', field: 'mdmId', op: 'in', value: 1 }]; }); // 'in' needs a list
  });

  it('keeps device conditions, agent steps and actions to forms used per device', () => {
    const err = refuse(() => {}, 'ticket');
    expect(err.message).toMatch(/per device/i);
    const def = checkIn();
    def.sections.pop(); // no agent step or action left
    expect(() => validateDefinition(def, { usage: 'ticket' })).toThrow(/per device/i); // device conditions remain
    def.sections[1].items = def.sections[1].items.filter((i) => !i.showWhen);
    expect(() => validateDefinition(def, { usage: 'ticket' })).not.toThrow();
  });

  it('allows one action, and only as the very last item', () => {
    refuse((d) => { d.sections[3].items.push({ key: 'after', kind: 'step', body: 'Too late.' }); });
    refuse((d) => { d.sections[2].items.push({ key: 'checkout', kind: 'action', action: 'check_out' }); });
    refuse((d) => { d.sections[3].items[1].action = 'wipe'; });
    refuse((d) => { d.sections[3].items[1].statuses = ['ready_to_issue', 'active']; });
  });

  it('checks fields: a known type, and options for choices', () => {
    refuse((d) => { d.sections[0].items[1].fieldType = 'file'; });
    refuse((d) => { d.sections[0].items[1] = { key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition' }; });
    refuse((d) => { d.sections[0].items[1] = { key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Good'] }; });
    expect(() => validateDefinition({ sections: [{ key: 's', title: 'S', items: [{ key: 'cond', kind: 'field', fieldType: 'choice', label: 'Condition', options: ['Good', 'Damaged'] }] }] }, { usage: 'ticket' })).not.toThrow();
  });

  it('refuses a definition past the size limits', () => {
    refuse((d) => { d.sections[0].items[0].body = 'x'.repeat(LIMITS.textLength + 1); });
    refuse((d) => {
      d.sections = Array.from({ length: LIMITS.sections + 1 }, (_, i) => ({ key: `s${i}`, title: `S${i}`, items: [] }));
    });
    refuse((d) => {
      d.sections = [{ key: 's', title: 'S', items: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ key: `i${i}`, kind: 'step', body: 'x' })) }];
    });
    refuse((d) => { d.sections[0].items[0].body = 'x'.repeat(LIMITS.bytes); }, 'device', 413);
    refuse((d) => { d.sections = 'nope'; });
  });
});

describe('evaluate', () => {
  const def = validateDefinition(checkIn(), { usage: 'device' });

  it('shows the steps for the device MDM and type, and hides the rest', () => {
    const mac = evaluate(def, macOnA, {}, []);
    expect(shownKeys(mac)).toEqual(expect.arrayContaining(['lock_a', 'mac_only']));
    expect(shownKeys(mac)).not.toContain('lock_b');
    const phone = evaluate(def, iphoneOnB, {}, []);
    expect(shownKeys(phone)).toContain('lock_b');
    expect(shownKeys(phone)).not.toEqual(expect.arrayContaining(['lock_a']));
    expect(shownKeys(phone)).not.toContain('mac_only');
  });

  it('an earlier answer shows or hides later steps; hidden steps are not required', () => {
    const before = evaluate(def, macOnA, {}, []);
    expect(item(before, 'deactivate').shown).toBe(false);
    const leaving = evaluate(def, macOnA, { leaving: true }, []);
    expect(item(leaving, 'deactivate')).toMatchObject({ shown: true, required: true, done: false });
    const staying = evaluate(def, macOnA, { leaving: false }, []);
    expect(item(staying, 'deactivate')).toMatchObject({ shown: false, required: false });
  });

  it('counts required shown items, and knows when the action is ready and the form finished', () => {
    // Mac on A, leaving: have_device, serial, lock_a, mac_only, leaving, deactivate, checkin = 7.
    const answers = { have_device: done, serial: 'C02X', lock_a: done, mac_only: done, leaving: true };
    let state = evaluate(def, macOnA, answers, []);
    expect(state.required).toBe(7);
    expect(state.done).toBe(5);
    expect(state.actionReady).toBe(false);
    state = evaluate(def, macOnA, { ...answers, deactivate: done }, []);
    expect(state.actionReady).toBe(true);
    expect(state.finished).toBe(false);
    state = evaluate(def, macOnA, { ...answers, deactivate: done, checkin: done }, []);
    expect(state.finished).toBe(true);
    // Staying instead: deactivate drops out of the count.
    state = evaluate(def, macOnA, { ...answers, leaving: false }, []);
    expect(state.required).toBe(6);
    expect(state.actionReady).toBe(true);
  });

  it('fields are done when filled; secure items when a value is set; text never counts', () => {
    const state = evaluate(def, macOnA, { serial: '   ' }, ['bypass']);
    expect(item(state, 'serial').done).toBe(false);
    expect(item(state, 'bypass').done).toBe(true);
    expect(item(state, 'intro')).toMatchObject({ shown: true, required: false, done: null });
  });

  it('answers on items that became hidden are kept but ignored, also by later conditions', () => {
    const chain = validateDefinition({
      sections: [{
        key: 's',
        title: 'S',
        items: [
          { key: 'a', kind: 'field', fieldType: 'yesno', label: 'A?' },
          { key: 'b', kind: 'field', fieldType: 'yesno', label: 'B?', showWhen: [{ on: 'answer', field: 'a', op: 'is', value: true }] },
          { key: 'c', kind: 'step', body: 'C', required: true, showWhen: [{ on: 'answer', field: 'b', op: 'is', value: true }] },
        ],
      }],
    }, { usage: 'ticket' });
    const shown = evaluate(chain, { device: null, person: null }, { a: true, b: true }, []);
    expect(item(shown, 'c').shown).toBe(true);
    const hidden = evaluate(chain, { device: null, person: null }, { a: false, b: true }, []);
    expect(item(hidden, 'b').shown).toBe(false);
    expect(item(hidden, 'c').shown).toBe(false); // b's answer no longer counts
    expect(hidden.ignored).toEqual(['b']);
  });

  it('a whole section can be hidden; person and list conditions work; a missing person matches nothing but "is empty"', () => {
    const d = validateDefinition({
      sections: [
        { key: 'it', title: 'IT only', showWhen: [{ on: 'person', field: 'departmentId', op: 'in', value: [5, 6] }], items: [{ key: 'x', kind: 'step', body: 'x', required: true }] },
        { key: 'noone', title: 'No person', showWhen: [{ on: 'person', field: 'departmentId', op: 'is_empty' }], items: [{ key: 'y', kind: 'step', body: 'y', required: true }] },
        { key: 'cell', title: 'Line', showWhen: [{ on: 'device', field: 'hasCellular', op: 'is', value: true }], items: [{ key: 'z', kind: 'step', body: 'z', required: true }] },
      ],
    }, { usage: 'device' });
    const a = evaluate(d, macOnA, {}, []);
    expect(shownKeys(a)).toEqual(['x']);
    const b = evaluate(d, iphoneOnB, {}, []);
    expect(shownKeys(b)).toEqual(['y', 'z']);
    expect(b.sections.find((s) => s.key === 'it').shown).toBe(false);
  });

  it('multiple-choice answers match by membership', () => {
    const d = validateDefinition({
      sections: [{
        key: 's',
        title: 'S',
        items: [
          { key: 'apps', kind: 'field', fieldType: 'choices', label: 'Apps', options: ['Mail', 'Finance', 'GIS'] },
          { key: 'fin', kind: 'step', body: 'Remove finance access', showWhen: [{ on: 'answer', field: 'apps', op: 'is', value: 'Finance' }] },
          { key: 'none', kind: 'step', body: 'Nothing to remove', showWhen: [{ on: 'answer', field: 'apps', op: 'is_empty' }] },
        ],
      }],
    }, { usage: 'ticket' });
    expect(shownKeys(evaluate(d, {}, { apps: ['Mail', 'Finance'] }, []))).toEqual(['apps', 'fin']);
    expect(shownKeys(evaluate(d, {}, { apps: [] }, []))).toEqual(['apps', 'none']);
  });
});
