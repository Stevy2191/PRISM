// Paste to build (PB2): turns a pasted document into a checklist definition.
// A plain function so node:test can check it; the server checks the result
// again on save, like any checklist.
//
// Line by line, in this order:
//   blank lines        end a run ("If Jamf Pro:" groups, write-down runs)
//   bullets and boxes  -, *, •, ☐, [ ], - [ ], 1. and 1) are stripped. When
//                      the text uses bullets, lines WITHOUT one are notes,
//                      headings, labels or "Only for" groups, never steps.
//   sections           a line starting with #, or "Step <n>", or a short line
//                      (60 characters or fewer) that doesn't end with . : or ?
//                      and is followed by a line that isn't a heading. Lines
//                      before the first one go in a section named after the
//                      checklist (a first line that IS the name is dropped).
//   Only for           "Jamf Pro: …", "Mac only: …", "If Jamf Pro: …",
//                      "If Jamf Pro (Mac): …", "iPhone/iPad: …": every name
//                      one of the install's MDMs or device types (or "Not
//                      managed"). On a line by itself ("If Jamf Pro:") it
//                      applies to the lines after it until a blank line, a
//                      heading, a line without a bullet, or "Both:" / "All:".
//   write-downs        a line ending with ":" and nothing after it, 60
//                      characters or fewer, not followed by a bulleted line
//                      (then it's a label, kept as a note). Password,
//                      passcode, PIN, code or secret make it a hidden value.
//   questions          a line ending with "?" is a yes/no question.
//   optional           "(optional)" anywhere, or a line starting "Ideally,".
//   bold               **text**. Everything else is plain text, escaped.

const MAX_HEADING = 60;
const BULLET_RE = /^\s*(?:[-*•▪◦·]\s*\[[ xX]?\]|[-*•▪◦·]|☐|☑|✓|\[[ xX]?\]|\d{1,3}[.)])\s+/;
const STEP_HEADING_RE = /^step\s+\d+\b/i;
const SECRET_RE = /password|passcode|\bpin\b|code|secret/i;
const GROUP_END_RE = /^(both|all|everyone|either|all devices|any device)\s*:$/i;
const NOT_MANAGED = ['not managed', 'unmanaged', 'no mdm'];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const richText = (s) => `<p>${escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
const plainText = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1');

// A key from the text: readable, unique in the checklist, and what the
// server accepts (letters, digits, - and _; at most 60).
function keyMaker() {
  const used = new Set();
  return (prefix, text) => {
    const slug = (text || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
    let key = `${prefix}_${slug}`;
    for (let n = 2; used.has(key); n += 1) key = `${prefix}_${slug}_${n}`;
    used.add(key);
    return key;
  };
}

// name → { kind: 'mdm'|'category', id } (lower case; device types also by plural).
function nameIndex(mdms = [], categories = []) {
  const index = new Map();
  NOT_MANAGED.forEach((n) => index.set(n, { kind: 'mdm', id: 'none' }));
  mdms.forEach((m) => index.set(m.name.trim().toLowerCase(), { kind: 'mdm', id: m.id }));
  categories.forEach((c) => {
    const n = c.name.trim().toLowerCase();
    if (!index.has(n)) index.set(n, { kind: 'category', id: c.id });
    if (!index.has(`${n}s`)) index.set(`${n}s`, { kind: 'category', id: c.id });
  });
  return index;
}

// "If Jamf Pro (Mac)" → [{kind,id}, …], or null when any part isn't a name.
function namesIn(prefix, index) {
  let p = prefix.trim().replace(/^if\s+/i, '').replace(/\s+only$/i, '').trim();
  if (!p) return null;
  p = p.replace(/[()]/g, ',');
  const parts = p.split(/\s*(?:\/|,|\bor\b|&)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const found = parts.map((part) => index.get(part.toLowerCase()));
  return found.every(Boolean) ? found : null;
}

// Splits "Jamf Pro: rest" into names and rest; null when it isn't an Only-for prefix.
function onlyForPrefix(text, index) {
  const at = text.indexOf(':');
  if (at <= 0 || at > MAX_HEADING) return null;
  const names = namesIn(text.slice(0, at), index);
  if (!names) return null;
  return { names, rest: text.slice(at + 1).trim() };
}

// Merges names into { mdm: [], categoryId: [] }; a later list of a kind
// replaces an earlier one of the same kind ("If Jamf Pro:" then "Mac: …").
function mergeOnlyFor(base, names) {
  const out = { mdm: base ? [...base.mdm] : [], categoryId: base ? [...base.categoryId] : [] };
  const mdm = names.filter((n) => n.kind === 'mdm').map((n) => n.id);
  const cats = names.filter((n) => n.kind === 'category').map((n) => n.id);
  if (mdm.length) out.mdm = [...new Set(mdm)];
  if (cats.length) out.categoryId = [...new Set(cats)];
  return out;
}

function onlyForConditions(only) {
  if (!only) return undefined;
  const conds = [];
  if (only.mdm.length) conds.push({ on: 'device', field: 'mdm', op: 'in', value: only.mdm });
  if (only.categoryId.length) conds.push({ on: 'device', field: 'categoryId', op: 'in', value: only.categoryId });
  return conds.length ? conds : undefined;
}

// Lines → [{ text, bullet, blank }].
function readLines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const line = raw.replace(/[​ ]/g, ' ').trimEnd();
    if (!line.trim()) return { blank: true };
    const bullet = BULLET_RE.test(line);
    return { text: line.replace(BULLET_RE, '').trim(), bullet, blank: false };
  });
}

// parseChecklist(text, { name, usage, finish, mdms, categories })
// → { definition, summary: { sections, steps, fields, secrets, onlyFor } }
// finish: 'check_out' | 'check_in' | null, for device checklists: adds the
// device action as the last item (check-in offers ready to issue, in repair
// and on hold).
export function parseChecklist(text, {
  name = 'Checklist', usage = 'ticket', finish = null, mdms = [], categories = [],
} = {}) {
  const lines = readLines(text);
  const index = usage === 'device' ? nameIndex(mdms, categories) : new Map();
  const usesBullets = lines.some((l) => !l.blank && l.bullet);
  const key = keyMaker();

  // Drop a first line that is the checklist's name.
  const firstIdx = lines.findIndex((l) => !l.blank);
  if (firstIdx !== -1 && lines[firstIdx].text.replace(/^#+\s*/, '').trim().toLowerCase() === name.trim().toLowerCase()) {
    lines[firstIdx] = { blank: true };
  }

  const nextLine = (i) => {
    for (let j = i + 1; j < lines.length; j += 1) if (!lines[j].blank) return { line: lines[j], j };
    return null;
  };
  // Short, no closing . : or ?, not optional, not an Only-for prefix.
  const headingShaped = (l) => !!l && !l.blank && !(usesBullets && l.bullet)
    && l.text.length <= MAX_HEADING && !/[.:?]$/.test(l.text) && !/\(optional\)/i.test(l.text)
    && !(index.size && onlyForPrefix(l.text, index));
  const isHeadingAt = (i) => {
    const l = lines[i];
    if (!l || l.blank) return false;
    if (/^#+\s*\S/.test(l.text)) return true;
    if (usesBullets && l.bullet) return false;
    if (STEP_HEADING_RE.test(l.text)) return true;
    if (!headingShaped(l) || !nextLine(i)) return false;
    // Only the first of a run of short lines: the rest are its steps.
    const prev = i > 0 ? lines[i - 1] : null;
    return !prev || prev.blank || !headingShaped(prev) || /^#|^step\s+\d/i.test(prev.text);
  };

  const sections = [];
  let section = null;
  const open = (title) => {
    section = { key: key('s', title), title: plainText(title).slice(0, 200), items: [] };
    sections.push(section);
  };
  const add = (item) => {
    if (!section) open(name);
    section.items.push(item);
  };

  let group = null; // Only for, from a line like "If Jamf Pro:"
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.blank) { group = null; continue; } // eslint-disable-line no-continue
    let { text: t } = l;

    if (isHeadingAt(i)) {
      open(t.replace(/^#+\s*/, ''));
      group = null;
      continue; // eslint-disable-line no-continue
    }
    if (usesBullets && !l.bullet) group = null;
    if (GROUP_END_RE.test(t)) { group = null; continue; } // eslint-disable-line no-continue

    // Only for: a prefix on the line, or a line that is only a prefix.
    let only = group;
    if (index.size) {
      const pre = onlyForPrefix(t, index);
      if (pre && !pre.rest) {
        group = mergeOnlyFor(null, pre.names);
        continue; // eslint-disable-line no-continue
      }
      if (pre) {
        only = mergeOnlyFor(group, pre.names);
        t = pre.rest.charAt(0).toUpperCase() + pre.rest.slice(1);
      }
    }
    const showWhen = onlyForConditions(only);
    const withWhen = (item) => (showWhen ? { ...item, showWhen } : item);

    let optional = false;
    if (/\(optional\)/i.test(t)) { optional = true; t = t.replace(/\s*\(optional\)\s*/ig, ' ').trim(); }
    if (/^ideally,/i.test(t)) optional = true;

    // A label line ("Managed Apple Account:" over bulleted lines) is a note.
    if (/:$/.test(t) && t.length <= MAX_HEADING) {
      const after = nextLine(i);
      const label = t.slice(0, -1).trim();
      if (usesBullets && after && after.line.bullet) {
        add(withWhen({ key: key('n', label), kind: 'text', body: richText(`**${label}**`), required: false }));
        continue; // eslint-disable-line no-continue
      }
      if (SECRET_RE.test(label)) {
        add(withWhen({ key: key('code', label), kind: 'secure', label: plainText(label), required: !optional }));
      } else {
        add(withWhen({ key: key('f', label), kind: 'field', fieldType: 'text', label: plainText(label), required: !optional }));
      }
      continue; // eslint-disable-line no-continue
    }
    if (/\?$/.test(t)) {
      add(withWhen({ key: key('q', t), kind: 'field', fieldType: 'yesno', label: plainText(t).slice(0, 200), required: !optional }));
      continue; // eslint-disable-line no-continue
    }
    if (usesBullets && !l.bullet) {
      add(withWhen({ key: key('n', t), kind: 'text', body: richText(t), required: false }));
      continue; // eslint-disable-line no-continue
    }
    add(withWhen({ key: key('i', t), kind: 'step', body: richText(t), required: !optional }));
  }

  if (usage === 'device' && (finish === 'check_out' || finish === 'check_in')) {
    if (!section) open(name);
    // In the order the server stores it.
    const action = { key: finish === 'check_out' ? 'check_out' : 'check_in', kind: 'action', action: finish };
    if (finish === 'check_in') action.statuses = ['ready_to_issue', 'in_repair', 'on_hold'];
    action.required = true;
    sections[sections.length - 1].items.push(action);
  }

  const items = sections.flatMap((s) => s.items);
  return {
    definition: { sections },
    summary: {
      sections: sections.length,
      steps: items.filter((i) => i.kind === 'step').length,
      fields: items.filter((i) => i.kind === 'field').length,
      secrets: items.filter((i) => i.kind === 'secure').length,
      onlyFor: items.filter((i) => i.showWhen).length,
    },
  };
}

// "9 sections, 31 steps, 5 things to write down, 1 password/code"
export function describeSummary(s) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(s.sections, 'section', 'sections'), n(s.steps, 'step', 'steps')];
  if (s.fields) parts.push(n(s.fields, 'thing to write down', 'things to write down'));
  if (s.secrets) parts.push(n(s.secrets, 'password/code', 'passwords/codes'));
  return parts.join(', ');
}
