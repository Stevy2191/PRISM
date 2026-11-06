// Checking a device out and in (Playbooks, PB, task 5). One service for the
// asset page and for ticket forms' device actions, so a form's check-out has
// the same history, activity and assignment as the asset page's.
//
// Check-out sets the holder by hand: it clears the PRISM agent's marker
// (Device.inventory.agentAssignedContactId), so the agent's usual-user
// matching never moves a device someone checked out, even when the person is
// the one the agent had picked.
//
// Check-in can revoke the device's PRISM agent. A wiped computer's old agent
// stays live in PRISM with its last inventory, and enrollment only claims
// an Asset with no live agent: without revoking, installing the agent again
// for the next person would make a second Asset.
const {
  sequelize, Asset, AssetCheckout, AssetAttachment, Contact, Department, Device,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logAssetActivity } = require('../assetActivity');
const { generateCheckoutFormPdf } = require('../assetCheckoutPdf');
const { hasPermission, canAccessCompany } = require('../permissionService');
const { orgTimeZone, dateInZone } = require('../../utils/orgTime');

const CHECK_IN_STATUSES = ['ready_to_issue', 'in_repair', 'on_hold', 'retired', 'in_storage', 'active'];
const bad = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code);

// Checkout and check-in dates may be backdated but never postdated
// (compared with the end of today, so "today" is always fine).
function assertNotFutureDate(value, label) {
  if (!value) return;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid date`);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) throw new ApiError(400, `${label} cannot be in the future`, 'FUTURE_DATE_NOT_ALLOWED');
}

// Whether the agent, not a person, set the device's holder.
async function assignedByAgent(asset, { transaction } = {}) {
  if (!asset.assignedToContactId) return false;
  const device = await Device.findOne({ where: { assetId: asset.id }, attributes: ['id', 'inventory'], transaction });
  return !!(device && device.inventory && device.inventory.agentAssignedContactId === asset.assignedToContactId);
}

async function forgetAgentHolder(assetId, transaction) {
  const device = await Device.findOne({ where: { assetId }, transaction });
  if (device && device.inventory && device.inventory.agentAssignedContactId) {
    const { agentAssignedContactId, ...rest } = device.inventory; // eslint-disable-line no-unused-vars
    await device.update({ inventory: rest }, { transaction });
  }
}

// req: the request (its user acts; it's used for the audit trail).
// contact: a contact of the asset's company, already checked by the caller.
// refuseIfOut: refuse when the device is checked out to someone else (a
// form's device action), rather than starting another checkout as the asset
// page has always allowed.
// → { checkout }
async function checkOut(req, asset, contact, {
  checkedOutAt: rawDate, notes = null, refuseIfOut = false,
} = {}, { transaction } = {}) {
  if (!contact || contact.companyId !== asset.companyId) throw bad('Contact not found');
  assertNotFutureDate(rawDate, 'Checkout date');
  const checkedOutAt = rawDate ? new Date(rawDate) : new Date();
  const run = async (t) => {
    if (refuseIfOut) {
      const open = await AssetCheckout.findOne({ where: { assetId: asset.id, checkedInAt: null }, transaction: t });
      if (open && open.contactId !== contact.id) throw new ApiError(409, 'This device is checked out to someone else. Check it in first.', 'ALREADY_CHECKED_OUT');
      if (open) return { checkout: open, already: true };
    }
    const checkout = await AssetCheckout.create({
      assetId: asset.id, contactId: contact.id, checkedOutBy: req.user.id, checkedOutAt, notes: notes || null,
    }, { transaction: t });
    if (asset.assignedToContactId !== contact.id || asset.assignedToUserId) {
      // The device takes the person's department with them, when they have one.
      const dept = contact.departmentId && contact.departmentId !== asset.departmentId ? { departmentId: contact.departmentId } : {};
      await asset.update({ assignedToContactId: contact.id, assignedToUserId: null, ...dept }, { transaction: t });
      await logAssetActivity(asset.id, req.user.id, 'assignment_changed', { assignedToContactId: contact.id, assignedToUserId: null, ...dept }, { transaction: t });
    }
    await forgetAgentHolder(asset.id, t);
    await logAssetActivity(asset.id, req.user.id, 'checked_out', { contactId: contact.id, contactName: contact.displayName, checkedOutAt }, { transaction: t });
    return { checkout };
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

// The checkout's agreement as a PDF on the asset's attachments, linked to
// the checkout as its form (a new one replaces the link, not the file).
async function makeCheckoutForm(asset, contactId, checkout, user) {
  const contact = await Contact.findByPk(contactId, { include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }] });
  const full = asset.category ? asset : await Asset.findByPk(asset.id, { include: ['category'] });
  const { filename, size } = await generateCheckoutFormPdf({
    asset: full,
    contact,
    checkoutDate: dateInZone(checkout.checkedOutAt, await orgTimeZone()),
  });
  const attachment = await AssetAttachment.create({
    assetId: asset.id,
    filename,
    originalName: `Checkout Form - ${asset.assetTag}.pdf`,
    mimeType: 'application/pdf',
    size,
    uploadedById: user.id,
  });
  await checkout.update({ formAttachmentId: attachment.id });
  await logAssetActivity(asset.id, user.id, 'checkout_form_generated', { checkoutId: checkout.id, attachmentId: attachment.id });
  return attachment;
}

// checkoutId: the checkout to close (the asset page names it); otherwise the
// open one, if any. With none open (a holder the agent set), the holder is
// cleared. status / holdReason: the device's status after check-in.
// revokeAgent: revoke its live PRISM agent; needs Manage devices, checked
// before anything changes.
// → { checkout | null, revoked }
async function checkIn(req, asset, {
  checkoutId = null, checkedInAt: rawDate, status, holdReason, revokeAgent = false,
} = {}, { transaction } = {}) {
  assertNotFutureDate(rawDate, 'Check-in date');
  const checkedInAt = rawDate ? new Date(rawDate) : new Date();
  if (status !== undefined && status !== null) {
    if (!CHECK_IN_STATUSES.includes(status)) throw bad("A device can't be checked in to that status");
    if (status === 'on_hold' && !(typeof holdReason === 'string' && holdReason.trim())) throw bad('Say why the device is on hold');
  }
  const device = revokeAgent ? await Device.findOne({ where: { assetId: asset.id } }) : null;
  const revoking = !!(device && !device.revokedAt);
  if (revoking && !((await hasPermission(req.user.id, 'devices.manage')) && (await canAccessCompany(req.user, device.companyId)))) {
    throw new ApiError(403, 'Revoking the PRISM agent needs the Manage devices permission. Ask someone who has it.', 'AGENT_REVOKE_FORBIDDEN');
  }

  const run = async (t) => {
    const where = checkoutId ? { id: checkoutId, assetId: asset.id } : { assetId: asset.id, checkedInAt: null };
    const checkout = await AssetCheckout.findOne({ where, order: [['checkedOutAt', 'DESC'], ['id', 'DESC']], transaction: t });
    if (checkoutId && !checkout) throw new ApiError(404, 'Checkout not found', 'NOT_FOUND');
    if (checkout && checkout.checkedInAt) throw bad('This checkout has already been checked in', 'ALREADY_CHECKED_IN');
    if (checkout && checkedInAt.getTime() < new Date(checkout.checkedOutAt).getTime()) {
      throw bad('Check-in date cannot be before the checkout date');
    }
    const holder = checkout ? checkout.contactId : asset.assignedToContactId;
    if (checkout) await checkout.update({ checkedInAt, checkedInBy: req.user.id }, { transaction: t });
    if (holder && asset.assignedToContactId === holder) {
      await asset.update({ assignedToContactId: null }, { transaction: t });
      await logAssetActivity(asset.id, req.user.id, 'assignment_changed', { assignedToContactId: null, assignedToUserId: asset.assignedToUserId }, { transaction: t });
    }
    if (checkout || holder) await logAssetActivity(asset.id, req.user.id, 'checked_in', { contactId: holder }, { transaction: t });
    if (status !== undefined && status !== null) {
      const from = asset.status;
      await asset.update({ status, holdReason: status === 'on_hold' ? holdReason.trim().slice(0, 255) : null }, { transaction: t });
      if (from !== status) await logAssetActivity(asset.id, req.user.id, 'status_changed', { from, to: status }, { transaction: t });
    }
    if (revoking) {
      await device.update({ revokedAt: new Date() }, { transaction: t });
      await logAssetActivity(asset.id, req.user.id, 'agent_revoked', { hostname: device.hostname }, { transaction: t });
    }
    return { checkout, revoked: revoking };
  };
  const result = transaction ? await run(transaction) : await sequelize.transaction(run);
  if (result.revoked) await writeAudit(req, 'agent.device_revoked', 'Device', device.id, { hostname: device.hostname, assetId: asset.id });
  return result;
}

module.exports = {
  checkOut, checkIn, makeCheckoutForm, assignedByAgent, assertNotFutureDate, CHECK_IN_STATUSES,
};
