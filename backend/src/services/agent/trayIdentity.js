// Who is at the computer (owner, 2026-11-13). In order:
//
//  1. Their sign-in's email (a directory account's UPN) matches a contact
//     of the computer's company: the original rule.
//  2. Staff have said so: a ticket this account raised from this computer
//     was given to a contact, and PRISM remembered it (AgentUserLinks).
//  3. The computer is assigned to a contact, and this account is the one
//     the agent reports as the computer's usual user: it is that contact,
//     and PRISM remembers it.
//
// 2 and 3 are for Macs and PCs that aren't joined to a directory, where the
// account is just a local name. A link is always for one computer and one
// account, inside the computer's own company; another account on the same
// computer stays unknown until staff link it too.
const { Op } = require('sequelize');
const {
  Contact, AgentUserLink, AssetTicket, Device, Ticket, sequelize,
} = require('../../models');
const { matchContact } = require('./inventory');

const key = (account) => (typeof account === 'string' ? account.trim().toLowerCase().slice(0, 255) : '');

async function contactInCompany(id, companyId, transaction) {
  if (!id) return null;
  return Contact.findOne({ where: { id, companyId, isPlaceholder: false }, attributes: ['id', 'departmentId'], transaction });
}

async function remember(deviceId, account, contactId, source, createdBy, transaction) {
  const where = { deviceId, account: key(account) };
  if (!where.account) return;
  const [row, created] = await AgentUserLink.findOrCreate({ where, defaults: { contactId, source, createdBy: createdBy || null }, transaction });
  if (!created && row.contactId !== contactId) await row.update({ contactId, source, createdBy: createdBy || null }, { transaction });
}

// → { id, departmentId } or null. `how` says which rule matched.
async function resolveContact(device, asset, user, { transaction } = {}) {
  const byEmail = await matchContact(asset.companyId, user, transaction);
  if (byEmail) return Object.assign(byEmail, { how: 'email' });
  const account = key(user && user.account);
  if (!account || !device) return null;

  const link = await AgentUserLink.findOne({ where: { deviceId: device.id, account }, transaction });
  if (link) {
    const linked = await contactInCompany(link.contactId, asset.companyId, transaction);
    if (linked) return Object.assign(linked, { how: 'link' });
  }

  // The computer's assignee, for the account the agent says uses it.
  const usual = key(device.inventory && device.inventory.signedInUser && device.inventory.signedInUser.account);
  if (asset.assignedToContactId && usual && usual === account) {
    const assignee = await contactInCompany(asset.assignedToContactId, asset.companyId, transaction);
    if (assignee) {
      await remember(device.id, account, assignee.id, 'assigned', null, transaction).catch(() => {});
      return Object.assign(assignee, { how: 'assigned' });
    }
  }
  return null;
}

// A ticket raised from the agent by someone PRISM didn't know was given to
// a real contact: remember that account on that computer as the contact,
// and hand them the other tickets the same account raised there that are
// still under the stand-in. → how many other tickets moved.
async function learnFromTicket(ticket, previousContactId, actorId) {
  if (ticket.source !== 'agent' || !previousContactId || previousContactId === ticket.contactId) return 0;
  // The caller's ticket may have been loaded without this column.
  const account = ticket.agentAccount !== undefined ? ticket.agentAccount
    : (await Ticket.findByPk(ticket.id, { attributes: ['agentAccount'] }) || {}).agentAccount;
  if (!account) return 0;
  const [previous, now] = await Promise.all([
    Contact.findByPk(previousContactId, { attributes: ['id', 'isPlaceholder', 'companyId'] }),
    Contact.findByPk(ticket.contactId, { attributes: ['id', 'isPlaceholder', 'companyId'] }),
  ]);
  if (!previous || !previous.isPlaceholder || !now || now.isPlaceholder || now.companyId !== previous.companyId) return 0;
  const links = await AssetTicket.findAll({ where: { ticketId: ticket.id }, attributes: ['assetId'], raw: true });
  const devices = links.length ? await Device.findAll({ where: { assetId: links.map((l) => l.assetId), companyId: now.companyId }, attributes: ['id', 'assetId'] }) : [];
  if (!devices.length) return 0;
  return sequelize.transaction(async (transaction) => {
    for (const d of devices) await remember(d.id, account, now.id, 'staff', actorId, transaction); // eslint-disable-line no-await-in-loop
    const siblings = await AssetTicket.findAll({ where: { assetId: devices.map((d) => d.assetId) }, attributes: ['ticketId'], raw: true, transaction });
    const [moved] = await Ticket.update({ contactId: now.id }, {
      where: {
        id: { [Op.in]: siblings.map((s) => s.ticketId), [Op.ne]: ticket.id }, contactId: previous.id, source: 'agent', agentAccount: account,
      },
      transaction,
    });
    return moved;
  });
}

module.exports = { resolveContact, learnFromTicket, remember };
