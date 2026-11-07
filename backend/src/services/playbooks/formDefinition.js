// Form definitions (Playbooks, PB): checking one, and working out what shows.
//
// A definition is { sections: [{ key, title, showWhen?, items: [Item] }] }.
// Every Item has a key, unique in the form and kept across versions, and a
// kind:
//   text    { body }                            explanation; never required
//   step    { body, askNote? }                  a checkbox
//   field   { label, fieldType, options? }      something to record
//   secure  { label }                           a secret value (stored apart)
//   agent   { body }                            ticked when the PRISM agent reports in
//   action  { action, statuses? }               check the device out or in
// Any section or item may have showWhen: conditions that must all hold, on
// the device the form is for, the person the playbook was applied for, or an
// earlier answer in the same form.
//
// Definitions are untrusted (built in the browser, or imported from a file):
// validateDefinition() is the only way one is saved. evaluate() runs on the
// server only, so a request can't finish a form the rules wouldn't.
const { sanitizeRichHtml } = require('../../utils/richHtml');
const { ApiError } = require('../../middleware/error');

const LIMITS = {
  sections: 40,
  items: 400,
  textLength: 4000,
  titleLength: 200,
  options: 50,
  optionLength: 200,
  conditions: 10,
  bytes: 256 * 1024,
};

const KINDS = ['text', 'step', 'field', 'secure', 'agent', 'action'];
const DEVICE_ONLY_KINDS = ['agent', 'action'];
const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'yesno', 'choice', 'choices', 'staff', 'contact'];
const ACTIONS = ['check_out', 'check_in'];
const CHECK_IN_STATUSES = ['ready_to_issue', 'in_repair', 'on_hold', 'retired'];
const OPS = ['is', 'is_not', 'in', 'is_empty', 'is_not_empty'];
// mdm: the MDM id when managed, else 'none' (PB2: "Jamf Pro or not managed"
// is one condition).
const DEVICE_FIELDS = ['categoryId', 'mdm', 'isManaged', 'mdmId', 'hasCellular', 'carrierCompanyId', 'hasAgent', 'companyId'];
const PERSON_FIELDS = ['companyId', 'departmentId'];
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;

const invalid = (message) => new ApiError(400, message, 'FORM_INVALID');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function plain(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} is required`);
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); // eslint-disable-line no-control-regex
  if (text.length > max) throw invalid(`${label} is longer than ${max} characters`);
  return text;
}

function rich(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} is required`);
  if (value.length > LIMITS.textLength) throw invalid(`${label} is longer than ${LIMITS.textLength} characters`);
  return sanitizeRichHtml(value);
}

function conditionValue(value, label) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return plain(value, label, LIMITS.optionLength);
  throw invalid(`${label} must be text, a number or yes/no`);
}

// `earlier`: the keys of the items before this element, with their items.
function cleanConditions(raw, { where, usage, earlier }) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw invalid(`The conditions of ${where} must be a list`);
  if (raw.length > LIMITS.conditions) throw invalid(`${where} has more than ${LIMITS.conditions} conditions`);
  if (!raw.length) return undefined;
  return raw.map((c, i) => {
    const label = `Condition ${i + 1} of ${where}`;
    if (!isObject(c)) throw invalid(`${label} is not valid`);
    if (!OPS.includes(c.op)) throw invalid(`${label} has an unknown operator`);
    if (c.on === 'device') {
      if (usage !== 'device') throw invalid('Only forms used per device can show steps by device');
      if (!DEVICE_FIELDS.includes(c.field)) throw invalid(`${label} uses an unknown device field`);
    } else if (c.on === 'person') {
      if (!PERSON_FIELDS.includes(c.field)) throw invalid(`${label} uses an unknown person field`);
    } else if (c.on === 'answer') {
      const target = earlier.get(c.field);
      if (!target) throw invalid(`${label} must refer to an earlier question or step`);
      if (!['field', 'step'].includes(target.kind)) throw invalid(`${label} must refer to a question or step`);
    } else {
      throw invalid(`${label} must be about the device, the person or an earlier answer`);
    }
    const out = { on: c.on, field: c.field, op: c.op };
    if (c.op === 'in') {
      if (!Array.isArray(c.value) || !c.value.length || c.value.length > LIMITS.options) throw invalid(`${label} needs a list of values`);
      out.value = c.value.map((v) => conditionValue(v, label));
    } else if (c.op === 'is' || c.op === 'is_not') {
      out.value = conditionValue(c.value === undefined ? null : c.value, label);
    }
    return out;
  });
}

function cleanItem(raw, { usage, earlier, isLast }) {
  if (!isObject(raw)) throw invalid('An item is not valid');
  const { key, kind } = raw;
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw invalid('Every item needs a key of letters, digits, - and _');
  const where = `item "${key}"`;
  if (!KINDS.includes(kind)) throw invalid(`${where} has an unknown kind`);
  if (DEVICE_ONLY_KINDS.includes(kind) && usage !== 'device') {
    throw invalid('Agent steps and device actions belong on forms used per device');
  }
  const item = { key, kind };
  switch (kind) {
    case 'text':
      item.body = rich(raw.body, `The text of ${where}`);
      break;
    case 'step':
    case 'agent':
      item.body = rich(raw.body, `The text of ${where}`);
      if (kind === 'step' && raw.askNote) item.askNote = true;
      break;
    case 'field': {
      item.label = plain(raw.label, `The label of ${where}`, LIMITS.titleLength);
      if (!FIELD_TYPES.includes(raw.fieldType)) throw invalid(`${where} has an unknown field type`);
      item.fieldType = raw.fieldType;
      if (raw.fieldType === 'choice' || raw.fieldType === 'choices') {
        if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > LIMITS.options) {
          throw invalid(`${where} needs between 1 and ${LIMITS.options} options`);
        }
        const options = raw.options.map((o) => plain(o, `An option of ${where}`, LIMITS.optionLength));
        if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw invalid(`${where} has the same option twice`);
        item.options = options;
      }
      break;
    }
    case 'secure':
      item.label = plain(raw.label, `The label of ${where}`, LIMITS.titleLength);
      break;
    case 'action':
      if (!ACTIONS.includes(raw.action)) throw invalid(`${where} must check the device out or in`);
      if (!isLast) throw invalid('The device action must be the last item of the form');
      item.action = raw.action;
      if (raw.action === 'check_in') {
        const statuses = raw.statuses === undefined ? CHECK_IN_STATUSES : raw.statuses;
        if (!Array.isArray(statuses) || !statuses.length || statuses.some((s) => !CHECK_IN_STATUSES.includes(s))) {
          throw invalid(`${where} offers a status a device can't be checked in to`);
        }
        item.statuses = [...new Set(statuses)];
      }
      break;
    default:
      break;
  }
  // Text is never required; a device action always is.
  if (kind === 'action') item.required = true;
  else item.required = kind !== 'text' && raw.required === true;
  const showWhen = cleanConditions(raw.showWhen, { where, usage, earlier });
  if (showWhen) item.showWhen = showWhen;
  return item;
}

// → the definition as it will be stored. Throws ApiError 400 FORM_INVALID
// with the first problem, or 413 when it's too large to look at.
function validateDefinition(def, { usage } = {}) {
  if (!['ticket', 'device'].includes(usage)) throw invalid('A form is used once per ticket or per device');
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(def)); } catch { throw invalid('The form is not valid'); }
  if (bytes > LIMITS.bytes) throw new ApiError(413, 'This form is too large', 'FORM_TOO_LARGE');
  if (!isObject(def) || !Array.isArray(def.sections)) throw invalid('A form is a list of sections');
  if (def.sections.length > LIMITS.sections) throw invalid(`A form has at most ${LIMITS.sections} sections`);
  const total = def.sections.reduce((n, s) => n + (isObject(s) && Array.isArray(s.items) ? s.items.length : 0), 0);
  if (total > LIMITS.items) throw invalid(`A form has at most ${LIMITS.items} items`);

  const sectionKeys = new Set();
  const earlier = new Map();
  const lastSection = def.sections.length - 1;
  let actions = 0;
  const sections = def.sections.map((raw, si) => {
    if (!isObject(raw)) throw invalid('A section is not valid');
    if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) throw invalid('Every section needs a key of letters, digits, - and _');
    if (sectionKeys.has(raw.key)) throw invalid(`Two sections share the key "${raw.key}"`);
    sectionKeys.add(raw.key);
    if (!Array.isArray(raw.items)) throw invalid(`Section "${raw.key}" needs a list of items`);
    const where = `section "${raw.key}"`;
    const section = { key: raw.key, title: plain(raw.title, `The title of ${where}`, LIMITS.titleLength) };
    // A section's conditions see only the items before the section.
    const showWhen = cleanConditions(raw.showWhen, { where, usage, earlier: new Map(earlier) });
    if (showWhen) section.showWhen = showWhen;
    section.items = raw.items.map((rawItem, ii) => {
      const isLast = si === lastSection && ii === raw.items.length - 1;
      const item = cleanItem(rawItem, { usage, earlier, isLast });
      if (earlier.has(item.key)) throw invalid(`Two items share the key "${item.key}"`);
      if (item.kind === 'action') actions += 1;
      earlier.set(item.key, item);
      return item;
    });
    return section;
  });
  if (actions > 1) throw invalid('A form has at most one device action');
  return { sections };
}

// ---- Evaluating ------------------------------------------------------------

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const norm = (v) => (v === undefined || v === null ? null : typeof v === 'boolean' ? v : String(v));

// The value a condition compares against. A step's answer is its done flag.
function subject(cond, ctx, effective) {
  if (cond.on === 'device') return ctx.device ? ctx.device[cond.field] : null;
  if (cond.on === 'person') return ctx.person ? ctx.person[cond.field] : null;
  const v = effective.get(cond.field);
  return v && typeof v === 'object' && !Array.isArray(v) ? !!v.done : v;
}

function holds(cond, ctx, effective) {
  const value = subject(cond, ctx, effective);
  if (cond.op === 'is_empty') return empty(value);
  if (cond.op === 'is_not_empty') return !empty(value);
  const values = Array.isArray(value) ? value.map(norm) : [norm(value)];
  const wanted = cond.op === 'in' ? cond.value.map(norm) : [norm(cond.value)];
  const any = values.some((v) => v !== null && wanted.includes(v));
  return cond.op === 'is_not' ? !any : any;
}

const allHold = (conds, ctx, effective) => !conds || conds.every((c) => holds(c, ctx, effective));

function isDone(item, answer, secrets) {
  switch (item.kind) {
    case 'text': return null;
    case 'secure': return secrets.has(item.key);
    case 'field': return !empty(answer) && !(item.fieldType === 'number' && !Number.isFinite(Number(answer)));
    default: return !!(answer && typeof answer === 'object' && answer.done === true);
  }
}

// ctx: { device: { categoryId, mdm, isManaged, mdmId, ... } | null, person: { companyId, departmentId } | null }
// answers: { itemKey: value }; secretKeys: the keys that have a secure value.
// → { sections: [{ key, shown, items: [{ key, kind, shown, required, done }] }],
//     required, done, finished, actionReady, ignored }
// Answers on hidden items are kept but ignored, by later conditions too
// (listed in `ignored`). actionReady: every other required shown item is done.
function evaluate(def, ctx = {}, answers = {}, secretKeys = []) {
  const context = { device: ctx.device || null, person: ctx.person || null };
  const given = answers || {};
  const secrets = new Set(secretKeys);
  const effective = new Map();
  const ignored = [];
  let required = 0;
  let done = 0;
  let otherOpen = 0;
  let action = null;
  const sections = def.sections.map((section) => {
    const sectionShown = allHold(section.showWhen, context, effective);
    const items = section.items.map((item) => {
      const shown = sectionShown && allHold(item.showWhen, context, effective);
      const answer = given[item.key];
      if (shown) {
        if (answer !== undefined) effective.set(item.key, answer);
      } else if (answer !== undefined && !empty(answer)) {
        ignored.push(item.key);
      }
      const itemDone = isDone(item, shown ? answer : undefined, shown ? secrets : new Set());
      const isRequired = shown && item.required;
      if (isRequired) {
        required += 1;
        if (itemDone) done += 1;
        else if (item.kind !== 'action') otherOpen += 1;
      }
      if (item.kind === 'action' && shown) action = { done: itemDone };
      return {
        key: item.key, kind: item.kind, shown, required: isRequired, done: itemDone,
      };
    });
    return { key: section.key, shown: sectionShown, items };
  });
  return {
    sections,
    required,
    done,
    finished: done === required,
    actionReady: otherOpen === 0 && !(action && action.done),
    ignored,
  };
}

module.exports = {
  validateDefinition,
  evaluate,
  LIMITS,
  KINDS,
  FIELD_TYPES,
  DEVICE_FIELDS,
  PERSON_FIELDS,
  CHECK_IN_STATUSES,
};
