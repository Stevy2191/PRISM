// Filling in a ticket form (Playbooks, PB, task 7).
//
// The server works out what shows (formDefinition.evaluate) after every
// change and returns the form's new state, so the browser never re-runs the
// rules. A form finishes when every required item that shows is done; its
// task then closes itself. Secure values are stored apart, encrypted, and
// only the reveal endpoint returns one. The device action (check out / in)
// runs once, in one transaction with the form row locked.
const {
  sequelize, TicketForm, TicketFormSecret, TicketPlaybook, FormVersion, Form, Asset, Device, Mdm, Contact, User, Task, TaskStatus,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { encryptToken, decryptToken } = require('../../utils/tokenCrypto');
const { logActivity } = require('../ticketActivity');
const { logAssetActivity } = require('../assetActivity');
const { hasPermission, canAccessTicket, findAccessibleContact } = require('../permissionService');
const { evaluate } = require('./formDefinition');
const { deviceContext } = require('./resolve');
const { personContext } = require('./apply');
const { mdmLink } = require('../assets/management');
const checkouts = require('../assets/checkouts');

const ONLINE_MS = 10 * 60 * 1000;
const MAX_TEXT = 4000;
const MAX_SECRET = 1000;
const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');

async function loadTicketForm(ticket, rawId, { transaction, lock } = {}) {
  const tf = await TicketForm.findOne({
    where: { id: Number(rawId) || 0, ticketId: ticket.id },
    include: [
      { model: FormVersion, as: 'formVersion', include: [{ model: Form, as: 'form', attributes: ['id', 'name', 'usage'] }] },
      {
        model: Asset,
        as: 'asset',
        include: [
          { model: Device, as: 'device', required: false, attributes: ['id', 'revokedAt', 'lastSeenAt', 'lastInventoryAt', 'scanRequestedAt'] },
          { model: Mdm, as: 'mdm', attributes: ['id', 'name', 'consoleUrl'] },
        ],
      },
      { model: TicketPlaybook, as: 'ticketPlaybook', include: [{ model: Contact, as: 'contact', attributes: ['id', 'displayName', 'companyId', 'departmentId', 'email'] }] },
      { model: Contact, as: 'contact', attributes: ['id', 'displayName', 'companyId', 'departmentId', 'email'] },
    ],
    transaction,
    ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!tf) throw new ApiError(404, 'Form not found on this ticket', 'NOT_FOUND');
  return tf;
}

const items = (def) => def.sections.flatMap((s) => s.items);
const findItem = (def, key) => items(def).find((i) => i.key === key) || null;
// The person: the bundle's, or the one a checklist added on its own was for.
const person = (tf) => (tf.ticketPlaybook ? tf.ticketPlaybook.contact : tf.contact) || null;

async function secretsOf(tf, transaction) {
  return TicketFormSecret.findAll({ where: { ticketFormId: tf.id }, transaction });
}

function stateOf(tf, secrets) {
  return evaluate(tf.formVersion.definition, {
    device: deviceContext(tf.asset), person: personContext(person(tf)),
  }, tf.answers, secrets.map((s) => s.itemKey));
}

// → the form as the ticket form page shows it. Secure values never: only
// whether one was set, by whom and when.
async function formView(tf) {
  const secrets = await secretsOf(tf);
  const setters = new Map((await User.findAll({ where: { id: secrets.map((s) => s.setBy).filter(Boolean) }, attributes: ['id', 'displayName'] })).map((u) => [u.id, u.displayName]));
  const a = tf.asset;
  const device = a ? {
    id: a.id,
    assetTag: a.assetTag,
    name: a.name,
    categoryId: a.categoryId,
    status: a.status,
    serialNumber: a.serialNumber,
    isManaged: a.isManaged,
    mdm: a.mdm ? { id: a.mdm.id, name: a.mdm.name } : null,
    mdmLink: mdmLink(a.mdm, a.mdmDeviceId),
    hasCellular: a.hasCellular,
    assignedToContactId: a.assignedToContactId,
    agent: a.device ? {
      id: a.device.id,
      revoked: !!a.device.revokedAt,
      online: !a.device.revokedAt && !!a.device.lastSeenAt && Date.now() - new Date(a.device.lastSeenAt).getTime() < ONLINE_MS,
      lastSeenAt: a.device.lastSeenAt,
      scanRequested: !!a.device.scanRequestedAt,
    } : null,
  } : null;
  const p = person(tf);
  return {
    id: tf.id,
    ticketId: tf.ticketId,
    taskId: tf.taskId,
    form: tf.formVersion.form ? { id: tf.formVersion.form.id, name: tf.formVersion.form.name, usage: tf.formVersion.form.usage } : null,
    version: tf.formVersion.version,
    definition: tf.formVersion.definition,
    playbook: tf.ticketPlaybook ? { id: tf.ticketPlaybook.id, name: tf.ticketPlaybook.snapshot.name } : null,
    person: p ? { id: p.id, displayName: p.displayName } : null,
    device,
    answers: tf.answers || {},
    secrets: Object.fromEntries(secrets.map((s) => [s.itemKey, { set: true, setBy: setters.get(s.setBy) || null, setAt: s.setAt }])),
    state: tf.state,
    skipReason: tf.skipReason,
    finishedAt: tf.finishedAt,
    actionDoneAt: tf.actionDoneAt,
    evaluation: stateOf(tf, secrets),
  };
}

async function closedTaskStatus(transaction) {
  return TaskStatus.findOne({ where: { scope: 'ticket', behaviorType: 'closed' }, order: [['isDefault', 'DESC'], ['position', 'ASC'], ['id', 'ASC']], transaction });
}

async function closeTask(taskId, transaction) {
  const status = await closedTaskStatus(transaction);
  if (!status) return;
  await Task.update({ statusId: status.id, completedAt: new Date() }, { where: { id: taskId }, transaction });
}

// Finishes the form when everything required that shows is done.
async function finishIfDone(req, tf, transaction) {
  if (tf.state !== 'open') return false;
  const state = stateOf(tf, await secretsOf(tf, transaction));
  if (!state.finished) return false;
  await tf.update({ state: 'finished', finishedAt: new Date(), finishedBy: req ? req.user.id : null }, { transaction });
  await closeTask(tf.taskId, transaction);
  await logActivity(tf.ticketId, req ? req.user.id : null, 'form_finished', null, tf.formVersion.form ? tf.formVersion.form.name : null);
  return true;
}

function assertOpen(tf) {
  if (tf.state !== 'open') throw new ApiError(409, tf.state === 'skipped' ? 'This form was skipped' : 'This form is finished', 'FORM_CLOSED');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Checks one answer against its item. → the value to store, or undefined to clear it.
async function cleanAnswer(req, ticket, item, value) {
  if (value === null || value === undefined) return undefined;
  if (item.kind === 'step' || item.kind === 'agent') {
    const done = typeof value === 'object' ? value.done === true : value === true;
    if (!done) return undefined;
    const note = typeof value === 'object' && typeof value.note === 'string' && value.note.trim() ? value.note.trim().slice(0, 1000) : undefined;
    return { done: true, by: req.user.id, at: new Date().toISOString(), ...(note ? { note } : {}) };
  }
  if (item.kind !== 'field') throw bad(`"${item.key}" can't be answered here`);
  const label = `"${item.label}"`;
  switch (item.fieldType) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') throw bad(`${label} takes text`);
      const text = value.trim();
      if (text.length > MAX_TEXT) throw bad(`${label} is too long`);
      return text || undefined;
    }
    case 'number': {
      if (value === '') return undefined;
      const n = Number(value);
      if (!Number.isFinite(n)) throw bad(`${label} takes a number`);
      return n;
    }
    case 'date': {
      if (value === '') return undefined;
      const d = new Date(`${value}T00:00:00Z`);
      if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw bad(`${label} takes a date`);
      return value;
    }
    case 'yesno':
      if (typeof value !== 'boolean') throw bad(`${label} takes yes or no`);
      return value;
    case 'choice':
      if (!item.options.includes(value)) throw bad(`${label} has no option "${value}"`);
      return value;
    case 'choices':
      if (!Array.isArray(value) || value.some((v) => !item.options.includes(v))) throw bad(`${label} takes options from its list`);
      return value.length ? [...new Set(value)] : undefined;
    case 'staff': {
      const user = await User.findByPk(Number(value) || 0, { attributes: ['id', 'isActive'] });
      if (!user || user.isActive === false) throw bad(`${label} takes a staff member`);
      return user.id;
    }
    case 'contact': {
      const contact = await findAccessibleContact(req.user, value);
      if (!contact || contact.companyId !== ticket.companyId) throw bad(`${label} takes a contact of the ticket's company`);
      return contact.id;
    }
    default:
      throw bad(`${label} can't be answered`);
  }
}

// PATCH /tickets/:id/forms/:formId { answers: { key: value } }
async function saveAnswers(req, ticket, rawId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Send the answers to save');
  await sequelize.transaction(async (transaction) => {
    const tf = await loadTicketForm(ticket, rawId, { transaction, lock: true });
    assertOpen(tf);
    const def = tf.formVersion.definition;
    const answers = { ...(tf.answers || {}) };
    for (const [key, value] of Object.entries(patch)) {
      const item = findItem(def, key);
      if (!item) throw bad(`This form has no item "${key}"`);
      if (item.kind === 'action') throw bad('Use the device action to check the device out or in');
      if (item.kind === 'secure') throw bad('Secure values are saved on their own');
      // eslint-disable-next-line no-await-in-loop
      const clean = await cleanAnswer(req, ticket, item, value);
      if (clean === undefined) delete answers[key];
      else answers[key] = clean;
    }
    await tf.update({ answers }, { transaction });
    await finishIfDone(req, tf, transaction);
  });
  return formView(await loadTicketForm(ticket, rawId));
}

// PUT /tickets/:id/forms/:formId/secrets/:key { value }
async function setSecret(req, ticket, rawId, key, value) {
  if (typeof value !== 'string' || !value.length) throw bad('Enter the value to keep');
  if (value.length > MAX_SECRET) throw bad('That value is too long');
  let label;
  await sequelize.transaction(async (transaction) => {
    const tf = await loadTicketForm(ticket, rawId, { transaction, lock: true });
    assertOpen(tf);
    const item = findItem(tf.formVersion.definition, key);
    if (!item || item.kind !== 'secure') throw bad(`This form has no secure item "${key}"`);
    label = item.label;
    const existing = await TicketFormSecret.findOne({ where: { ticketFormId: tf.id, itemKey: key }, transaction });
    const fields = { ciphertext: encryptToken(value), setBy: req.user.id, setAt: new Date() };
    if (existing) await existing.update(fields, { transaction });
    else await TicketFormSecret.create({ ticketFormId: tf.id, itemKey: key, ...fields }, { transaction });
    await finishIfDone(req, tf, transaction);
  });
  // The activity says a value was recorded, never what it is.
  await logActivity(ticket.id, req.user.id, 'form_secret_set', null, label);
  return formView(await loadTicketForm(ticket, rawId));
}

// POST /tickets/:id/forms/:formId/secrets/:key/reveal → { value }
// Needs Reveal secure form values and the right to view the ticket; every
// reveal is logged on the ticket and in the audit log.
async function revealSecret(req, ticket, rawId, key) {
  if (!(await hasPermission(req.user.id, 'tickets.view_secure_fields')) || !(await canAccessTicket(req.user, ticket))) {
    throw new ApiError(403, 'Revealing secure values needs the Reveal secure form values permission', 'FORBIDDEN');
  }
  const tf = await loadTicketForm(ticket, rawId);
  const item = findItem(tf.formVersion.definition, key);
  const secret = item && item.kind === 'secure'
    ? await TicketFormSecret.unscoped().findOne({ where: { ticketFormId: tf.id, itemKey: key } })
    : null;
  if (!secret) throw new ApiError(404, 'No value was recorded for that item', 'NOT_FOUND');
  const value = decryptToken(secret.ciphertext);
  await logActivity(ticket.id, req.user.id, 'form_secret_revealed', null, item.label);
  await writeAudit(req, 'ticketForm.secret_revealed', 'TicketForm', tf.id, { ticketId: ticket.id, item: key });
  return { value };
}

// POST /tickets/:id/forms/:formId/skip { reason, notReturned?, markLost? }
async function skip(req, ticket, rawId, { reason, notReturned = false, markLost = false } = {}) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  const why = notReturned ? `Not returned${text ? `: ${text}` : ''}` : text;
  if (!why) throw bad('Say why this form is skipped');
  await sequelize.transaction(async (transaction) => {
    const tf = await loadTicketForm(ticket, rawId, { transaction, lock: true });
    assertOpen(tf);
    if (notReturned && !tf.assetId) throw bad('Only a form for a device can be marked not returned');
    await tf.update({
      state: 'skipped', skipReason: why.slice(0, 500), finishedAt: new Date(), finishedBy: req.user.id,
    }, { transaction });
    await closeTask(tf.taskId, transaction);
    if (notReturned && markLost && tf.asset && tf.asset.status !== 'lost') {
      const from = tf.asset.status;
      await tf.asset.update({ status: 'lost', holdReason: null }, { transaction });
      await logAssetActivity(tf.asset.id, req.user.id, 'status_changed', { from, to: 'lost', ticketId: ticket.id }, { transaction });
    }
  });
  await logActivity(ticket.id, req.user.id, 'form_skipped', null, why.slice(0, 255));
  return formView(await loadTicketForm(ticket, rawId));
}

// POST /tickets/:id/forms/:formId/action { contactId?, status?, holdReason?, revokeAgent?, generateForm? }
// Only when every other required item that shows is done; once.
async function runAction(req, ticket, rawId, body = {}) {
  let checkoutForForm = null;
  await sequelize.transaction(async (transaction) => {
    const tf = await loadTicketForm(ticket, rawId, { transaction, lock: true });
    assertOpen(tf);
    if (tf.actionDoneAt) throw new ApiError(409, 'The device action was already done', 'ACTION_DONE');
    const def = tf.formVersion.definition;
    const action = items(def).find((i) => i.kind === 'action');
    if (!action) throw bad('This form has no device action');
    if (!tf.asset) throw bad('This form is not for a device');
    const state = stateOf(tf, await secretsOf(tf, transaction));
    const shown = state.sections.flatMap((s) => s.items).find((i) => i.key === action.key);
    if (!shown || !shown.shown) throw bad("The device action doesn't apply to this device");
    if (!state.actionReady) throw new ApiError(409, 'Finish the required steps above first', 'ACTION_NOT_READY');
    const asset = await Asset.findByPk(tf.asset.id, { transaction, lock: transaction.LOCK.UPDATE });

    if (action.action === 'check_out') {
      let contact = person(tf);
      if (body.contactId !== undefined && body.contactId !== null) {
        contact = await findAccessibleContact(req.user, body.contactId);
      }
      if (!contact || contact.companyId !== asset.companyId) throw bad('Choose who the device is checked out to');
      const full = await Contact.findByPk(contact.id, { transaction });
      const { checkout } = await checkouts.checkOut(req, asset, full, { refuseIfOut: true }, { transaction });
      if (body.generateForm === true) checkoutForForm = { asset, contactId: full.id, checkout };
    } else {
      const status = body.status || action.statuses[0];
      if (!action.statuses.includes(status)) throw bad('Choose a status this form allows');
      await checkouts.checkIn(req, asset, { status, holdReason: body.holdReason, revokeAgent: body.revokeAgent === true }, { transaction });
    }
    const at = new Date();
    await tf.update({
      actionDoneAt: at,
      answers: { ...(tf.answers || {}), [action.key]: { done: true, by: req.user.id, at: at.toISOString() } },
    }, { transaction });
    await finishIfDone(req, tf, transaction);
  });
  if (checkoutForForm) {
    await checkouts.makeCheckoutForm(checkoutForForm.asset, checkoutForForm.contactId, checkoutForForm.checkout, req.user);
  }
  const tf = await loadTicketForm(ticket, rawId);
  await logActivity(ticket.id, req.user.id, 'form_device_action', null, `${tf.formVersion.form ? tf.formVersion.form.name : 'Form'}: ${tf.asset ? tf.asset.assetTag : ''}`);
  return formView(tf);
}

// After the PRISM agent's inventory for an asset: its open forms tick their
// "confirmed by the agent" items, when this inventory came after the form
// was created. Called by services/agent/inventory.js; never throws.
async function markAgentItems(assetId, inventoryAt = new Date()) {
  try {
    const open = await TicketForm.findAll({ where: { assetId, state: 'open' }, attributes: ['id', 'ticketId'] });
    for (const row of open) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.transaction(async (transaction) => {
        const tf = await loadTicketForm({ id: row.ticketId }, row.id, { transaction, lock: true });
        if (tf.state !== 'open' || new Date(tf.createdAt) > inventoryAt) return;
        const agentItems = items(tf.formVersion.definition).filter((i) => i.kind === 'agent');
        const answers = { ...(tf.answers || {}) };
        let changed = false;
        for (const item of agentItems) {
          if (!(answers[item.key] && answers[item.key].done)) {
            answers[item.key] = { done: true, by: null, byAgent: true, at: inventoryAt.toISOString() };
            changed = true;
          }
        }
        if (!changed) return;
        await tf.update({ answers }, { transaction });
        await finishIfDone(null, tf, transaction);
      });
    }
  } catch (err) {
    console.error('[playbooks] agent items:', err.message);
  }
}

module.exports = {
  loadTicketForm, formView, saveAnswers, setSecret, revealSecret, skip, runAction, markAgentItems, findItem, items, stateOf, secretsOf,
};
