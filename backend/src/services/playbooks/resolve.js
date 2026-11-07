// Which forms a playbook adds to a ticket (Playbooks, PB).
//
// A playbook's blocks apply once, per device of the person it's for
// ('person_devices'), or per device linked to the ticket ('ticket_devices').
// A per-device block may be limited by device type, managed, MDM, cellular
// and the PRISM agent. Each device takes the FIRST per-device block it
// matches, in the playbook's order, so "Apple check-in for Apple devices,
// then Device check-in for everything else" gives each device one form. A
// device that matches none is reported as not covered, never silently
// dropped.

const APPLIES = ['once', 'person_devices', 'ticket_devices'];
const LIMIT_KEYS = ['categoryIds', 'managed', 'mdmIds', 'hasCellular', 'hasAgent'];

// What forms and playbooks may know about a device: the same fields form
// conditions use (formDefinition DEVICE_FIELDS). `asset` may carry its
// `device` (the PRISM agent) association.
function deviceContext(asset) {
  if (!asset) return null;
  const device = asset.device || null;
  return {
    categoryId: asset.categoryId,
    mdm: asset.isManaged && asset.mdmId ? asset.mdmId : 'none',
    isManaged: !!asset.isManaged,
    mdmId: asset.mdmId || null,
    hasCellular: !!asset.hasCellular,
    carrierCompanyId: asset.carrierCompanyId || null,
    hasAgent: !!(device && !device.revokedAt),
    companyId: asset.companyId,
  };
}

function blockMatches(block, ctx) {
  const l = block.limits || {};
  if (Array.isArray(l.categoryIds) && l.categoryIds.length && !l.categoryIds.includes(ctx.categoryId)) return false;
  if (typeof l.managed === 'boolean' && l.managed !== ctx.isManaged) return false;
  if (Array.isArray(l.mdmIds) && l.mdmIds.length && !l.mdmIds.includes(ctx.mdmId)) return false;
  if (typeof l.hasCellular === 'boolean' && l.hasCellular !== ctx.hasCellular) return false;
  if (typeof l.hasAgent === 'boolean' && l.hasAgent !== ctx.hasAgent) return false;
  return true;
}

// Whether a playbook is offered for a ticket of this company.
const offeredFor = (playbook, companyId) => !Array.isArray(playbook.companyIds) || playbook.companyIds.includes(companyId);

// → { forms: [{ blockIndex, formId, assetId }], uncovered: [asset] }
// personDevices / ticketDevices: assets (with `device` when known). A device
// in both lists is counted once; it may take a block of either kind.
function resolvePlaybook(playbook, { personDevices = [], ticketDevices = [] } = {}) {
  const blocks = playbook.blocks || [];
  const forms = [];
  blocks.forEach((block, blockIndex) => {
    if (block.applies === 'once') forms.push({ blockIndex, formId: block.formId, assetId: null });
  });
  const hasPerson = blocks.some((b) => b.applies === 'person_devices');
  const hasTicket = blocks.some((b) => b.applies === 'ticket_devices');
  if (!hasPerson && !hasTicket) return { forms, uncovered: [] };

  const sources = new Map();
  const add = (list, kind) => list.forEach((asset) => {
    if (!sources.has(asset.id)) sources.set(asset.id, { asset, kinds: new Set() });
    sources.get(asset.id).kinds.add(kind);
  });
  if (hasPerson) add(personDevices, 'person_devices');
  if (hasTicket) add(ticketDevices, 'ticket_devices');

  const uncovered = [];
  for (const { asset, kinds } of sources.values()) {
    const ctx = deviceContext(asset);
    const blockIndex = blocks.findIndex((b) => kinds.has(b.applies) && blockMatches(b, ctx));
    if (blockIndex === -1) uncovered.push(asset);
    else forms.push({ blockIndex, formId: blocks[blockIndex].formId, assetId: asset.id });
  }
  // In the playbook's order; within a block, in the order the devices came.
  forms.sort((a, b) => a.blockIndex - b.blockIndex);
  return { forms, uncovered };
}

module.exports = {
  APPLIES, LIMIT_KEYS, deviceContext, blockMatches, offeredFor, resolvePlaybook,
};
