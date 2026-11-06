// Devices on a ticket (Playbooks, PB, task 6): link one of the company's
// devices, or create one, and the forms an applied playbook needs for it
// follow; unlinking removes its forms nothing was done on.
const { Asset, AssetTicket } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { hasPermission, canAccessCompany } = require('../../services/permissionService');
const { logAssetActivity } = require('../../services/assetActivity');
const apply = require('../../services/playbooks/apply');
const { ticketFor } = require('./playbooks');

async function linkAndAddForms(req, ticket, asset) {
  await apply.linkDevice(req, ticket, asset);
  await apply.addFormsForDevice(req, ticket, await Asset.findByPk(asset.id, { include: apply.assetIncludes }));
}

// POST /tickets/:id/devices { assetId }
const link = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const asset = await Asset.findByPk(Number((req.body || {}).assetId) || 0);
  if (!asset || asset.companyId !== ticket.companyId || !(await canAccessCompany(req.user, asset.companyId))) {
    throw new ApiError(400, "Choose a device of the ticket's company", 'VALIDATION_ERROR');
  }
  await linkAndAddForms(req, ticket, asset);
  res.status(201).json(await apply.ticketPlaybooksView(ticket));
});

// POST /tickets/:id/devices/new { name, categoryId, ...asset fields }
// The device belongs to the ticket's company. Warns SERIAL_EMPTY: the PRISM
// agent claims a device by its serial number when it's installed.
const createDevice = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  if (!(await hasPermission(req.user.id, 'assets.create'))) throw new ApiError(403, 'Creating devices needs the Create assets permission', 'FORBIDDEN');
  // Lazy: the assets controller loads much of the app.
  const { createAsset } = require('../assetsController'); // eslint-disable-line global-require
  const body = { ...(req.body || {}), companyId: ticket.companyId };
  delete body.assignedToContactId; // the form's check-out step does that
  const { asset, warnings } = await createAsset(req, body);
  await linkAndAddForms(req, ticket, asset);
  const out = await apply.ticketPlaybooksView(ticket);
  res.status(201).json({
    asset, warnings: [...warnings, ...(asset.serialNumber ? [] : ['SERIAL_EMPTY'])], ...out,
  });
});

// DELETE /tickets/:id/devices/:assetId
const unlink = asyncHandler(async (req, res) => {
  const ticket = await ticketFor(req);
  const assetId = Number(req.params.assetId) || 0;
  const linkRow = await AssetTicket.findOne({ where: { ticketId: ticket.id, assetId } });
  if (!linkRow) throw new ApiError(404, "That device isn't on this ticket", 'NOT_FOUND');
  const { kept } = await apply.removeUnstartedFormsFor(ticket, assetId);
  await linkRow.destroy();
  await logAssetActivity(assetId, req.user.id, 'ticket_unlinked', { ticketId: ticket.id });
  res.json({ keptForms: kept, ...(await apply.ticketPlaybooksView(ticket)) });
});

module.exports = { link, createDevice, unlink };
