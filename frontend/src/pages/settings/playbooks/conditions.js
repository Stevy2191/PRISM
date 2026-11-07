// Form builder helpers (PB), plain functions so node:test can check them.
//
// conditionFieldsFor: what a "show when" condition can be about at a point in
// the form: the device (forms used per device only), the person, or an
// answer to a field or step BEFORE that point (the server refuses anything
// else). Each entry may carry `choices` for its value.
const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function earlierItems(sections, at) {
  const out = [];
  sections.forEach((section, s) => {
    if (s > at.s) return;
    section.items.forEach((item, i) => {
      if (s < at.s || (at.i !== null && i < at.i)) out.push(item);
    });
  });
  return out;
}

export function conditionFieldsFor({ sections, at, usage, lookups = {} }) {
  const named = (rows = []) => rows.map((r) => ({ value: r.id, label: r.name }));
  const fields = [];
  if (usage === 'device') {
    fields.push(
      { on: 'device', field: 'categoryId', label: 'Device type', choices: named(lookups.categories) },
      // PB2: the MDM, or 'none' when not managed.
      { on: 'device', field: 'mdm', label: 'MDM (or not managed)', choices: [...named(lookups.mdms), { value: 'none', label: 'Not managed' }] },
      { on: 'device', field: 'isManaged', label: 'Managed', choices: YES_NO },
      { on: 'device', field: 'mdmId', label: 'MDM', choices: named(lookups.mdms) },
      { on: 'device', field: 'hasCellular', label: 'Has cellular', choices: YES_NO },
      { on: 'device', field: 'hasAgent', label: 'Has the PRISM agent', choices: YES_NO },
      { on: 'device', field: 'companyId', label: 'Device company', choices: named(lookups.companies) },
    );
  }
  fields.push(
    { on: 'person', field: 'companyId', label: 'Person company', choices: named(lookups.companies) },
    { on: 'person', field: 'departmentId', label: 'Person department', choices: named(lookups.departments) },
  );
  for (const item of earlierItems(sections, at)) {
    if (item.kind === 'step') fields.push({ on: 'answer', field: item.key, label: `Step: ${strip(item.body).slice(0, 40)}`, choices: [{ value: true, label: 'Done' }] });
    if (item.kind === 'field') {
      const choices = item.fieldType === 'yesno' ? YES_NO
        : ['choice', 'choices'].includes(item.fieldType) ? (item.options || []).map((o) => ({ value: o, label: o })) : null;
      fields.push({ on: 'answer', field: item.key, label: item.label, ...(choices ? { choices } : {}) });
    }
  }
  return fields;
}

const OPS = { is: 'is', is_not: 'is not', is_empty: 'is empty', is_not_empty: 'is not empty', in: 'is one of' };

// "MDM is MDM A", for the builder's item chips.
export function describeCondition(c, fields) {
  const def = fields.find((f) => f.on === c.on && f.field === c.field);
  const label = def ? def.label : c.field;
  if (c.op === 'is_empty' || c.op === 'is_not_empty') return `${label} ${OPS[c.op]}`;
  const name = (v) => (def?.choices?.find((o) => o.value === v)?.label ?? String(v));
  const value = Array.isArray(c.value) ? c.value.map(name).join(', ') : name(c.value);
  return `${label} ${OPS[c.op] || c.op} ${value}`;
}

// A key for a new section or item: stable once saved (answers are stored by it).
export function newKey(kind) {
  return `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
