// Applying playbooks to tickets (Playbooks, PB, task 6).
//
// Applying makes a TicketPlaybook (with a snapshot of the playbook, so
// editing it later never changes a ticket in progress), one TicketForm per
// form the playbook resolves to, and one ticket task per ticket form. The
// person's chosen devices are linked to the ticket. Rules never apply a
// playbook: only a person, from the ticket.
const { Op } = require('sequelize');
const {
  sequelize, Playbook, Form, FormVersion, TicketPlaybook, TicketForm, TicketFormSecret, Task, Asset, AssetTicket,
  Device, Contact, User, TicketPlaybookSuggestion,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { logActivity } = require('../ticketActivity');
const { logAssetActivity } = require('../assetActivity');
const { findAccessibleContact } = require('../permissionService');
const { defaultTaskStatus } = require('../tasks/statuses');
const { nextCode } = require('../tasks/codes');
const { ticketParent } = require('../tasks');
const { resolvePlaybook, offeredFor, deviceContext } = require('./resolve');
const { evaluate } = require('./formDefinition');

const deviceInclude = { model: Device, as: 'device', required: false, attributes: ['id', 'revokedAt', 'lastSeenAt', 'lastInventoryAt'] };
const IN_USE = { [Op.notIn]: ['retired', 'lost'] };

// The devices assigned to a person, in their own company.
async function personDevices(contact) {
  return Asset.findAll({
    where: { assignedToContactId: contact.id, companyId: contact.companyId, status: IN_USE },
    include: [deviceInclude],
    order: [['assetTag', 'ASC']],
  });
}

async function ticketDevices(ticket, { transaction } = {}) {
  const links = await AssetTicket.findAll({ where: { ticketId: ticket.id }, attributes: ['assetId'], transaction });
  if (!links.length) return [];
  return Asset.findAll({
    where: { id: links.map((l) => l.assetId), companyId: ticket.companyId },
    include: [deviceInclude],
    order: [['assetTag', 'ASC']],
    transaction,
  });
}

async function linkDevice(req, ticket, asset, transaction) {
  const [, created] = await AssetTicket.findOrCreate({
    where: { assetId: asset.id, ticketId: ticket.id },
    defaults: { assetId: asset.id, ticketId: ticket.id, linkedBy: req.user.id },
    transaction,
  });
  if (created) {
    await logAssetActivity(asset.id, req.user.id, 'ticket_linked', {
      ticketId: ticket.id, ticketNumber: String(ticket.id).padStart(5, '0'), ticketTitle: ticket.title,
    }, { transaction });
  }
}

// The person a playbook is applied for: a contact of the ticket's company
// the user may see.
async function resolvePerson(user, ticket, rawContactId) {
  const contact = await findAccessibleContact(user, rawContactId);
  if (!contact || contact.companyId !== ticket.companyId) throw new ApiError(400, "Choose a person from the ticket's company", 'VALIDATION_ERROR');
  return contact;
}

// The form versions to use: each form's current one; a form switched off or
// without a version can't be added.
async function currentVersions(formIds, transaction) {
  const forms = await Form.findAll({ where: { id: [...new Set(formIds)] }, transaction });
  const byId = new Map();
  for (const form of forms) {
    if (!form.isActive || !form.currentVersionId) throw new ApiError(400, `The form "${form.name}" is switched off`, 'FORM_INACTIVE');
    // eslint-disable-next-line no-await-in-loop
    const version = await FormVersion.findByPk(form.currentVersionId, { transaction });
    byId.set(form.id, { form, version });
  }
  if (byId.size !== new Set(formIds).size) throw new ApiError(400, 'A form in this playbook no longer exists', 'FORM_MISSING');
  return byId;
}

// Creates the ticket forms (and their tasks) for resolved entries.
async function createForms(req, ticket, applied, entries, assetsById, transaction) {
  if (!entries.length) return [];
  const versions = await currentVersions(entries.map((e) => e.formId), transaction);
  const status = await defaultTaskStatus('ticket');
  if (!status) throw new ApiError(400, 'No open task status is configured', 'VALIDATION_ERROR');
  const parent = ticketParent(ticket);
  const created = [];
  for (const entry of entries) {
    const { form, version } = versions.get(entry.formId);
    const asset = entry.assetId ? assetsById.get(entry.assetId) : null;
    // eslint-disable-next-line no-await-in-loop
    const maxPos = await Task.max('position', { where: { ticketId: ticket.id, parentTaskId: null }, transaction });
    // eslint-disable-next-line no-await-in-loop
    const code = await nextCode(parent, null, transaction);
    // eslint-disable-next-line no-await-in-loop
    const task = await Task.create({
      ticketId: ticket.id,
      parentTaskId: null,
      title: (asset ? `${form.name}: ${asset.name}, ${asset.assetTag}` : form.name).slice(0, 500),
      statusId: status.id,
      priority: 'medium',
      code,
      position: (Number.isFinite(maxPos) ? maxPos : 0) + 1,
      createdBy: req.user.id,
    }, { transaction });
    // eslint-disable-next-line no-await-in-loop
    created.push(await TicketForm.create({
      ticketId: ticket.id,
      ticketPlaybookId: applied.id,
      formVersionId: version.id,
      assetId: asset ? asset.id : null,
      taskId: task.id,
      answers: {},
    }, { transaction }));
  }
  return created;
}

async function findOffered(ticket, rawId) {
  const playbook = await Playbook.findByPk(Number(rawId) || 0);
  if (!playbook || !playbook.isActive) throw new ApiError(404, 'Playbook not found', 'NOT_FOUND');
  if (!offeredFor(playbook, ticket.companyId)) throw new ApiError(400, "This playbook isn't offered for this ticket's company", 'NOT_OFFERED');
  return playbook;
}

// POST /tickets/:id/playbooks { playbookId, contactId?, assetIds? }
// assetIds narrows the person's devices to the ones ticked in the dialog.
async function applyPlaybook(req, ticket, { playbookId, contactId, assetIds } = {}) {
  const playbook = await findOffered(ticket, playbookId);
  const contact = playbook.needsPerson || (contactId !== undefined && contactId !== null)
    ? await resolvePerson(req.user, ticket, contactId)
    : null;
  if (playbook.needsPerson && !contact) throw new ApiError(400, 'Choose who this playbook is for', 'VALIDATION_ERROR');

  let chosen = contact ? await personDevices(contact) : [];
  if (Array.isArray(assetIds)) {
    const wanted = new Set(assetIds.map(Number));
    chosen = chosen.filter((a) => wanted.has(a.id));
  }
  const onTicket = await ticketDevices(ticket);
  const { forms } = resolvePlaybook(playbook, { personDevices: chosen, ticketDevices: onTicket });
  const assetsById = new Map([...chosen, ...onTicket].map((a) => [a.id, a]));

  const applied = await sequelize.transaction(async (transaction) => {
    const tp = await TicketPlaybook.create({
      ticketId: ticket.id,
      playbookId: playbook.id,
      snapshot: { name: playbook.name, needsPerson: playbook.needsPerson, blocks: playbook.blocks },
      contactId: contact ? contact.id : null,
      appliedBy: req.user.id,
      appliedAt: new Date(),
    }, { transaction });
    for (const asset of chosen) await linkDevice(req, ticket, asset, transaction); // eslint-disable-line no-await-in-loop
    await createForms(req, ticket, tp, forms, assetsById, transaction);
    return tp;
  });
  await logActivity(ticket.id, req.user.id, 'playbook_applied', null, contact ? `${playbook.name} for ${contact.displayName}` : playbook.name);
  return applied;
}

const started = (tf, secretCount) => tf.state !== 'open' || !!tf.actionDoneAt || secretCount > 0
  || Object.values(tf.answers || {}).some((v) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));

async function secretCounts(formIds, transaction) {
  if (!formIds.length) return new Map();
  const rows = await TicketFormSecret.findAll({ where: { ticketFormId: formIds }, attributes: ['ticketFormId'], transaction });
  const counts = new Map();
  rows.forEach((r) => counts.set(r.ticketFormId, (counts.get(r.ticketFormId) || 0) + 1));
  return counts;
}

async function destroyForms(forms, transaction) {
  const taskIds = forms.map((f) => f.taskId);
  await TicketForm.destroy({ where: { id: forms.map((f) => f.id) }, transaction });
  if (taskIds.length) await Task.destroy({ where: { id: taskIds }, transaction });
}

// DELETE /tickets/:id/playbooks/:tpId: only while none of its forms is started.
async function removeApplied(req, ticket, rawId) {
  const tp = await TicketPlaybook.findOne({ where: { id: Number(rawId) || 0, ticketId: ticket.id } });
  if (!tp) throw new ApiError(404, 'Applied playbook not found', 'NOT_FOUND');
  const forms = await TicketForm.findAll({ where: { ticketPlaybookId: tp.id } });
  const secrets = await secretCounts(forms.map((f) => f.id));
  if (forms.some((f) => started(f, secrets.get(f.id) || 0))) {
    throw new ApiError(409, 'Work has started on its forms, so it can no longer be removed', 'PLAYBOOK_STARTED');
  }
  await sequelize.transaction(async (transaction) => {
    await destroyForms(forms, transaction);
    await tp.destroy({ transaction });
  });
  await logActivity(ticket.id, req.user.id, 'playbook_removed', tp.snapshot.name, null);
}

// A device was linked to the ticket: each applied playbook with a "devices
// on the ticket" block adds the form that device matches, unless it has one.
async function addFormsForDevice(req, ticket, asset, { transaction } = {}) {
  const applied = await TicketPlaybook.findAll({ where: { ticketId: ticket.id }, transaction });
  const added = [];
  for (const tp of applied) {
    const blocks = tp.snapshot.blocks || [];
    if (!blocks.some((b) => b.applies === 'ticket_devices')) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    if (await TicketForm.count({ where: { ticketPlaybookId: tp.id, assetId: asset.id }, transaction })) continue; // eslint-disable-line no-continue
    // Only the ticket's devices count here: the person's were chosen when it was applied.
    const { forms } = resolvePlaybook({ blocks: blocks.filter((b) => b.applies !== 'person_devices') }, { ticketDevices: [asset] });
    const perDevice = forms.filter((f) => f.assetId);
    // eslint-disable-next-line no-await-in-loop
    added.push(...await createForms(req, ticket, tp, perDevice, new Map([[asset.id, asset]]), transaction));
  }
  return added;
}

// A device was unlinked: its forms on this ticket that nothing was done on
// go; a started form stays, to be finished or skipped.
async function removeUnstartedFormsFor(ticket, assetId, { transaction } = {}) {
  const forms = await TicketForm.findAll({ where: { ticketId: ticket.id, assetId }, transaction });
  const secrets = await secretCounts(forms.map((f) => f.id), transaction);
  const unstarted = forms.filter((f) => !started(f, secrets.get(f.id) || 0));
  if (unstarted.length) await destroyForms(unstarted, transaction);
  return { removed: unstarted.length, kept: forms.length - unstarted.length };
}

// ---- The ticket's view ----------------------------------------------------------

const assetJson = (a) => (a ? {
  id: a.id,
  assetTag: a.assetTag,
  name: a.name,
  categoryId: a.categoryId,
  status: a.status,
  isManaged: a.isManaged,
  mdmId: a.mdmId,
  hasCellular: a.hasCellular,
  assignedToContactId: a.assignedToContactId,
  hasAgent: !!(a.device && !a.device.revokedAt),
} : null);

// The person context forms use.
const personContext = (contact) => (contact ? { companyId: contact.companyId, departmentId: contact.departmentId } : null);

// → { applied, devices, uncovered, suggestions } for a ticket's Tasks tab
// and Devices panel.
async function ticketPlaybooksView(ticket) {
  const [applied, devices, suggestions] = await Promise.all([
    TicketPlaybook.findAll({
      where: { ticketId: ticket.id },
      include: [
        { model: Contact, as: 'contact', attributes: ['id', 'displayName', 'companyId', 'departmentId'] },
        { model: User, as: 'appliedByUser', attributes: ['id', 'displayName'] },
      ],
      order: [['appliedAt', 'ASC'], ['id', 'ASC']],
    }),
    ticketDevices(ticket),
    TicketPlaybookSuggestion.findAll({
      where: { ticketId: ticket.id, dismissedAt: null },
      include: [{ model: Playbook, as: 'playbook', attributes: ['id', 'name', 'isActive', 'needsPerson'] }],
    }),
  ]);
  const forms = await TicketForm.findAll({
    where: { ticketId: ticket.id },
    include: [
      { model: FormVersion, as: 'formVersion', include: [{ model: Form, as: 'form', attributes: ['id', 'name'] }] },
      { model: Asset, as: 'asset', include: [deviceInclude] },
      { model: Task, as: 'task', attributes: ['id', 'code', 'title', 'assigneeId', 'statusId'] },
    ],
    order: [['id', 'ASC']],
  });
  const secrets = await TicketFormSecret.findAll({ where: { ticketFormId: forms.map((f) => f.id) }, attributes: ['ticketFormId', 'itemKey'] });
  const secretKeys = new Map();
  secrets.forEach((s) => secretKeys.set(s.ticketFormId, [...(secretKeys.get(s.ticketFormId) || []), s.itemKey]));
  const contactsByTp = new Map(applied.map((tp) => [tp.id, tp.contact]));

  const formJson = (tf) => {
    const state = evaluate(tf.formVersion.definition, {
      device: deviceContext(tf.asset), person: personContext(contactsByTp.get(tf.ticketPlaybookId)),
    }, tf.answers, secretKeys.get(tf.id) || []);
    return {
      id: tf.id,
      ticketPlaybookId: tf.ticketPlaybookId,
      formId: tf.formVersion.form ? tf.formVersion.form.id : null,
      formName: tf.formVersion.form ? tf.formVersion.form.name : null,
      version: tf.formVersion.version,
      state: tf.state,
      skipReason: tf.skipReason,
      finishedAt: tf.finishedAt,
      asset: assetJson(tf.asset),
      task: tf.task ? { id: tf.task.id, code: tf.task.code, title: tf.task.title, assigneeId: tf.task.assigneeId } : null,
      progress: { required: state.required, done: state.done },
    };
  };

  const covered = new Set(forms.filter((f) => f.assetId).map((f) => f.assetId));
  const perDevice = applied.some((tp) => (tp.snapshot.blocks || []).some((b) => b.applies !== 'once'));
  const appliedIds = new Set(applied.map((tp) => tp.playbookId));
  return {
    applied: applied.map((tp) => ({
      id: tp.id,
      playbookId: tp.playbookId,
      name: tp.snapshot.name,
      contact: tp.contact ? { id: tp.contact.id, displayName: tp.contact.displayName } : null,
      appliedBy: tp.appliedByUser ? { id: tp.appliedByUser.id, displayName: tp.appliedByUser.displayName } : null,
      appliedAt: tp.appliedAt,
      forms: forms.filter((f) => f.ticketPlaybookId === tp.id).map(formJson),
    })),
    otherForms: forms.filter((f) => !f.ticketPlaybookId).map(formJson),
    devices: devices.map(assetJson),
    uncovered: perDevice ? devices.filter((d) => !covered.has(d.id)).map(assetJson) : [],
    suggestions: suggestions
      .filter((s) => s.playbook && s.playbook.isActive && !appliedIds.has(s.playbookId))
      .map((s) => ({ id: s.id, playbook: { id: s.playbook.id, name: s.playbook.name, needsPerson: s.playbook.needsPerson } })),
  };
}

module.exports = {
  personDevices,
  ticketDevices,
  linkDevice,
  applyPlaybook,
  removeApplied,
  addFormsForDevice,
  removeUnstartedFormsFor,
  ticketPlaybooksView,
  findOffered,
  assetJson,
  personContext,
  deviceInclude,
  started,
};
