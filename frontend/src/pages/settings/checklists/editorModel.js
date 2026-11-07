// The checklist editor's model (PB2), plain functions so node:test can check
// them. The editor shows a checklist as lines, and stores exactly what the
// server already understands:
//   Only for       device conditions: mdm in [...] and/or categoryId in [...]
//                  (older "mdmId is X" / "categoryId is X" read as chips too)
//   indenting      one answer condition on a yes/no question above, in the
//                  same section: { on: 'answer', field, op: 'is', value: true }
//                  (false: the "If no" lines)
//   finish         the last item, when it checks the device out or in
// Anything else is kept as it is and shown as Advanced rules.
//
// Opening a checklist and saving it without changes gives back exactly the
// stored definition: a line keeps its stored conditions until its Only for
// or indenting is changed.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- Conditions ↔ chips ------------------------------------------------------------

// showWhen → { onlyFor: { mdm: [], categoryId: [] } | null, indent: { question, value } | null, advanced: bool }
export function readConditions(showWhen, { questions = new Set() } = {}) {
  const out = { onlyFor: null, indent: null, advanced: false };
  if (!Array.isArray(showWhen) || !showWhen.length) return out;
  const only = { mdm: [], categoryId: [] };
  let sawMdm = false;
  let sawCat = false;
  for (const c of showWhen) {
    if (!isObj(c)) return { ...out, advanced: true };
    if (c.on === 'device' && (c.field === 'mdm' || c.field === 'mdmId') && !sawMdm
      && ((c.op === 'in' && Array.isArray(c.value)) || (c.op === 'is' && c.value !== null && c.value !== undefined))) {
      only.mdm = [].concat(c.value);
      sawMdm = true;
    } else if (c.on === 'device' && c.field === 'categoryId' && !sawCat
      && ((c.op === 'in' && Array.isArray(c.value)) || (c.op === 'is' && c.value !== null && c.value !== undefined))) {
      only.categoryId = [].concat(c.value);
      sawCat = true;
    } else if (c.on === 'answer' && c.op === 'is' && typeof c.value === 'boolean' && !out.indent && questions.has(c.field)) {
      out.indent = { question: c.field, value: c.value };
    } else {
      return { onlyFor: null, indent: null, advanced: true };
    }
  }
  if (sawMdm || sawCat) out.onlyFor = only;
  return out;
}

// { onlyFor, indent } → showWhen (undefined when nothing limits the line).
export function writeConditions({ onlyFor, indent }) {
  const conds = [];
  if (indent) conds.push({ on: 'answer', field: indent.question, op: 'is', value: indent.value });
  if (onlyFor && onlyFor.mdm.length) conds.push({ on: 'device', field: 'mdm', op: 'in', value: [...onlyFor.mdm] });
  if (onlyFor && onlyFor.categoryId.length) conds.push({ on: 'device', field: 'categoryId', op: 'in', value: [...onlyFor.categoryId] });
  return conds.length ? conds : undefined;
}

// "Shows for Macs and iPads on Jamf Pro or not managed"
export function describeOnlyFor(onlyFor, { mdms = [], categories = [] } = {}) {
  if (!onlyFor || (!onlyFor.mdm.length && !onlyFor.categoryId.length)) return 'Shows for every device';
  const name = (rows, id) => (rows.find((r) => r.id === id) || {}).name || `#${id}`;
  const list = (words, joiner) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`);
  const types = onlyFor.categoryId.map((id) => {
    const n = name(categories, id);
    return /s$/i.test(n) ? n : `${n}s`;
  });
  const managed = onlyFor.mdm.filter((m) => m !== 'none').map((id) => name(mdms, id));
  const where = [...(managed.length ? [list(managed, 'or')] : []), ...(onlyFor.mdm.includes('none') ? ['not managed'] : [])];
  const who = types.length ? list(types, 'and') : 'devices';
  if (!where.length) return `Shows for ${who}`;
  const onWhat = managed.length ? `on ${list(where, 'or')}` : 'that are not managed';
  return `Shows for ${who} ${onWhat}`;
}

// ---- Definition ↔ editor ------------------------------------------------------------------------

// An item's own fields, without its conditions.
const bare = (item) => {
  const { showWhen, ...rest } = item; // eslint-disable-line no-unused-vars
  return rest;
};

const yesNo = (item) => item.kind === 'field' && item.fieldType === 'yesno';

// definition → { sections: [{ key, title, onlyFor, advanced, conditions, lines }], finish }
// A line: { item, onlyFor, indent, advanced, conditions, dirty }. `conditions`
// is the stored showWhen, written back unchanged unless the line is `dirty`.
export function toEditor(definition) {
  const sections = (definition && Array.isArray(definition.sections) ? definition.sections : []).map((s) => {
    const read = readConditions(s.showWhen);
    const questions = new Set();
    const lines = (s.items || []).map((item) => {
      const r = readConditions(item.showWhen, { questions });
      if (yesNo(item)) questions.add(item.key);
      return {
        item: bare(item), onlyFor: r.onlyFor, indent: r.indent, advanced: r.advanced, conditions: item.showWhen, dirty: false,
      };
    });
    return {
      key: s.key, title: s.title, onlyFor: read.onlyFor, advanced: read.advanced, conditions: s.showWhen, dirty: false, lines,
    };
  });
  // The fixed last step: the device action, when it's the very last item.
  let finish = null;
  const last = sections.length ? sections[sections.length - 1] : null;
  const lastLine = last && last.lines.length ? last.lines[last.lines.length - 1] : null;
  if (lastLine && lastLine.item.kind === 'action' && !lastLine.conditions) {
    finish = { ...lastLine.item };
    last.lines = last.lines.slice(0, -1);
  }
  return { sections, finish };
}

const conditionsOf = (thing) => (thing.dirty ? writeConditions(thing) : thing.conditions);

// editor → definition
export function fromEditor(model) {
  const sections = model.sections.map((s) => {
    const out = { key: s.key, title: s.title };
    const sw = s.advanced ? s.conditions : conditionsOf({ ...s, indent: null });
    if (sw) out.showWhen = sw;
    out.items = s.lines.map((line) => {
      const showWhen = line.advanced ? line.conditions : conditionsOf(line);
      return showWhen ? { ...line.item, showWhen } : { ...line.item };
    });
    return out;
  });
  if (model.finish) {
    if (!sections.length) sections.push({ key: 'finish', title: 'Finish', items: [] });
    sections[sections.length - 1].items.push({ ...model.finish });
  }
  return { sections };
}

// ---- Editing ---------------------------------------------------------------------------

const CHECK_IN_DEFAULT = ['ready_to_issue', 'in_repair', 'on_hold'];

// When it's finished: 'nothing' | 'check_out' | 'check_in'. Keeps the step's
// key and statuses when the choice doesn't change.
export function setFinish(model, choice) {
  const current = model.finish ? model.finish.action : 'nothing';
  if (choice === current) return model;
  if (choice === 'nothing') return { ...model, finish: null };
  const finish = { key: choice, kind: 'action', action: choice };
  if (choice === 'check_in') finish.statuses = [...CHECK_IN_DEFAULT];
  finish.required = true;
  return { ...model, finish };
}

export const finishChoice = (model) => (model.finish ? model.finish.action : 'nothing');

const editLine = (model, s, i, fn) => ({
  ...model,
  sections: model.sections.map((sec, j) => (j !== s ? sec : { ...sec, lines: sec.lines.map((l, k) => (k === i ? fn(l) : l)) })),
});

// The yes/no question a line at (s, i) can be indented under: the nearest
// question above it in the section that isn't itself indented.
export function questionAbove(model, s, i) {
  const lines = model.sections[s].lines;
  for (let k = i - 1; k >= 0; k -= 1) {
    if (!lines[k].indent && yesNo(lines[k].item)) return lines[k].item.key;
  }
  return null;
}

// Tab: indents a line under the question above ("If yes"; the "If no" group
// when the line above is in it). No-op where it can't.
export function indentLine(model, s, i) {
  const line = model.sections[s].lines[i];
  if (!line || line.advanced || line.indent || yesNo(line.item)) return model;
  const question = questionAbove(model, s, i);
  if (!question) return model;
  const above = model.sections[s].lines[i - 1];
  const value = above && above.indent && above.indent.question === question ? above.indent.value : true;
  return editLine(model, s, i, (l) => ({ ...l, indent: { question, value }, dirty: true }));
}

// Shift+Tab.
export function outdentLine(model, s, i) {
  const line = model.sections[s].lines[i];
  if (!line || line.advanced || !line.indent) return model;
  return editLine(model, s, i, (l) => ({ ...l, indent: null, dirty: true }));
}

// Switches an indented line between the "If yes" and "If no" groups.
export function flipBranch(model, s, i) {
  const line = model.sections[s].lines[i];
  if (!line || !line.indent) return model;
  return editLine(model, s, i, (l) => ({ ...l, indent: { ...l.indent, value: !l.indent.value }, dirty: true }));
}

export function setOnlyFor(model, s, i, onlyFor) {
  const clean = onlyFor && (onlyFor.mdm.length || onlyFor.categoryId.length) ? { mdm: [...onlyFor.mdm], categoryId: [...onlyFor.categoryId] } : null;
  if (i === null) {
    return { ...model, sections: model.sections.map((sec, j) => (j === s ? { ...sec, onlyFor: clean, dirty: true } : sec)) };
  }
  return editLine(model, s, i, (l) => ({ ...l, onlyFor: clean, dirty: true }));
}

// Advanced rules edited in the full condition editor. An empty list clears
// them, giving the line its Only for and indenting back.
export function setAdvanced(model, s, i, conditions) {
  const list = Array.isArray(conditions) && conditions.length ? conditions : undefined;
  const apply = (thing, questions) => {
    const r = readConditions(list, { questions });
    return {
      ...thing, conditions: list, onlyFor: r.onlyFor, indent: r.indent, advanced: r.advanced, dirty: false,
    };
  };
  if (i === null) return { ...model, sections: model.sections.map((sec, j) => (j === s ? apply(sec, new Set()) : sec)) };
  const questions = new Set(model.sections[s].lines.slice(0, i).filter((l) => yesNo(l.item)).map((l) => l.item.key));
  return editLine(model, s, i, (l) => apply(l, questions));
}

// Lines that hang on a question lose their indent when it goes or stops
// being a yes/no question.
function dropOrphans(model) {
  return {
    ...model,
    sections: model.sections.map((sec) => {
      const questions = new Set();
      return {
        ...sec,
        lines: sec.lines.map((l) => {
          const out = l.indent && !questions.has(l.indent.question) ? { ...l, indent: null, dirty: true } : l;
          if (yesNo(out.item) && !out.indent) questions.add(out.item.key);
          return out;
        }),
      };
    }),
  };
}

export function updateItem(model, s, i, patch) {
  return dropOrphans(editLine(model, s, i, (l) => ({ ...l, item: { ...l.item, ...patch } })));
}

export function insertLine(model, s, at, item) {
  const line = {
    item, onlyFor: null, indent: null, advanced: false, conditions: undefined, dirty: false,
  };
  // A new line under an indented one joins its group.
  const prev = model.sections[s].lines[at - 1];
  if (prev && prev.indent && !yesNo(item)) Object.assign(line, { indent: { ...prev.indent }, dirty: true });
  if (prev && yesNo(prev.item) && !prev.indent && !yesNo(item)) Object.assign(line, { indent: { question: prev.item.key, value: true }, dirty: true });
  return {
    ...model,
    sections: model.sections.map((sec, j) => (j !== s ? sec : { ...sec, lines: [...sec.lines.slice(0, at), line, ...sec.lines.slice(at)] })),
  };
}

export function removeLine(model, s, i) {
  return dropOrphans({
    ...model,
    sections: model.sections.map((sec, j) => (j !== s ? sec : { ...sec, lines: sec.lines.filter((_, k) => k !== i) })),
  });
}

// Moves a line up (-1) or down (+1) inside its section.
export function moveLine(model, s, i, by) {
  const lines = [...model.sections[s].lines];
  const j = i + by;
  if (j < 0 || j >= lines.length) return model;
  [lines[i], lines[j]] = [lines[j], lines[i]];
  return dropOrphans({ ...model, sections: model.sections.map((sec, k) => (k === s ? { ...sec, lines } : sec)) });
}

// ---- Text ------------------------------------------------------------------------------

// A line's body as editable text: bold as **text**. null when the body holds
// more than paragraphs and bold, which the plain line can't keep: it opens
// in the rich text editor instead.
export function bodyToText(html) {
  const h = String(html || '').trim();
  const inner = h.replace(/^<p>/i, '').replace(/<\/p>$/i, '');
  if (/<(?!\/?(b|strong)>)[^>]+>/i.test(inner)) return null;
  return inner.replace(/<\/?(b|strong)>/gi, '**')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function textToBody(text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<p>${esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
}

// Turn into: changes a line's kind, keeping its words.
export function turnInto(item, kind, { fieldType } = {}) {
  const words = item.kind === 'field' || item.kind === 'secure' ? item.label : (bodyToText(item.body) ?? String(item.body || '').replace(/<[^>]+>/g, ' ').trim());
  const label = (words || '').replace(/\*\*/g, '').trim() || 'Untitled';
  const base = { key: item.key, kind };
  switch (kind) {
    case 'step': return { ...base, body: textToBody(words || 'New step'), required: item.required !== false };
    case 'agent': return { ...base, body: textToBody(words || 'New step'), required: item.required !== false };
    case 'text': return { ...base, body: textToBody(words || 'Note'), required: false };
    case 'secure': return { ...base, label, required: item.required !== false };
    case 'field': {
      const type = fieldType || 'text';
      const out = { ...base, label, fieldType: type };
      if (type === 'choice' || type === 'choices') out.options = Array.isArray(item.options) && item.options.length ? item.options : ['Yes', 'No'];
      out.required = item.required !== false;
      return out;
    }
    default: return item;
  }
}
