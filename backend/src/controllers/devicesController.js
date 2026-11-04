// Staff screens for the PRISM agent (8a, task 12): a company's devices, an
// Asset's device detail and software list, revoking a computer, and the
// installers. Viewing follows Assets' view permission and company access;
// revoking and downloading installers need devices.manage.
const path = require('path');
const { Op } = require('sequelize');
const {
  Asset, AssetSoftware, AgentEnrollmentKey, Contact, Device,
} = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId, canAccessCompany } = require('../services/permissionService');
const { parsePagination, paginated } = require('../utils/pagination');
const { escapeLike } = require('../utils/escapeLike');
const { loadAccessibleCompany } = require('./companiesController');
const { latestPackage, compareVersions } = require('../services/agent/updates');
const { logAssetActivity } = require('../services/assetActivity');

// Online: checked in within 10 minutes (two missed heartbeats). Stale: not
// seen for 14 days (owner decision 4; nothing is retired automatically).
const ONLINE_MS = 10 * 60 * 1000;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const PLATFORMS = ['windows', 'macos', 'linux'];
const ARCHES = ['amd64', 'arm64'];

function deviceStatus(d, now = Date.now()) {
  if (!d) return null;
  if (d.revokedAt) return 'revoked';
  const seen = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
  if (seen && now - seen <= ONLINE_MS) return 'online';
  if (!seen || now - seen > STALE_MS) return 'stale';
  return 'offline';
}

// Sequelize conditions on Devices for a status (for list filters).
function statusWhere(status, now = Date.now()) {
  const online = new Date(now - ONLINE_MS);
  const stale = new Date(now - STALE_MS);
  switch (status) {
    case 'online': return { revokedAt: null, lastSeenAt: { [Op.gte]: online } };
    case 'offline': return { revokedAt: null, lastSeenAt: { [Op.lt]: online, [Op.gte]: stale } };
    case 'stale': return { revokedAt: null, [Op.or]: [{ lastSeenAt: null }, { lastSeenAt: { [Op.lt]: stale } }] };
    default: return { revokedAt: null };
  }
}

const osLabel = (inv) => {
  const os = (inv && inv.os) || {};
  return [os.edition || os.name, os.version].filter(Boolean).join(' ') || null;
};

// A newer package for this device's platform and arch is waiting.
function updatePending(d) {
  try {
    const pkg = latestPackage(d.platform, d.arch);
    return !!pkg && compareVersions(pkg.version, d.agentVersion) > 0;
  } catch (err) {
    return false;
  }
}

// The summary every list and badge uses.
const deviceSummary = (d) => (d ? {
  id: d.id,
  status: deviceStatus(d),
  lastSeenAt: d.lastSeenAt,
  lastInventoryAt: d.lastInventoryAt,
  scanRequestedAt: d.scanRequestedAt || null,
  agentVersion: d.agentVersion,
  platform: d.platform,
} : null);

const contactJson = (c) => (c ? { id: c.id, displayName: c.displayName } : null);

// GET /companies/:id/devices?status=all|offline|stale → { devices, counts }
const listForCompany = asyncHandler(async (req, res) => {
  const company = await loadAccessibleCompany(req);
  const now = Date.now();
  const rows = await Device.findAll({
    where: { companyId: company.id },
    include: [{
      model: Asset,
      as: 'asset',
      attributes: ['id', 'assetTag', 'name', 'make', 'model', 'operatingSystem', 'osVersion'],
      include: [{ model: Contact, as: 'assignedToContact', attributes: ['id', 'displayName'] }],
    }],
    order: [['hostname', 'ASC'], ['id', 'ASC']],
  });
  const all = rows.map((d) => ({
    id: d.id,
    hostname: d.hostname,
    platform: d.platform,
    arch: d.arch,
    os: osLabel(d.inventory),
    agentVersion: d.agentVersion,
    updatePending: d.revokedAt ? false : updatePending(d),
    status: deviceStatus(d, now),
    lastSeenAt: d.lastSeenAt,
    lastInventoryAt: d.lastInventoryAt,
    scanRequestedAt: d.scanRequestedAt || null,
    revokedAt: d.revokedAt,
    signedInAccount: d.inventory && d.inventory.signedInUser ? d.inventory.signedInUser.account || null : null,
    asset: d.asset ? {
      id: d.asset.id, assetTag: d.asset.assetTag, make: d.asset.make, model: d.asset.model, usualUser: contactJson(d.asset.assignedToContact),
    } : null,
  }));
  const live = all.filter((d) => d.status !== 'revoked');
  const counts = {
    all: live.length,
    online: live.filter((d) => d.status === 'online').length,
    offline: live.filter((d) => d.status === 'offline').length,
    stale: live.filter((d) => d.status === 'stale').length,
    revoked: all.length - live.length,
  };
  const want = req.query.status;
  let devices = live;
  if (['online', 'offline', 'stale', 'revoked'].includes(want)) devices = all.filter((d) => d.status === want);
  res.json({ devices, counts });
});

// GET /assets/:id/device → the device's detail for the Device tab.
const getForAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id, { attributes: ['id', 'companyId', 'assignedToContactId'] });
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  const d = await Device.findOne({
    where: { assetId: asset.id },
    include: [{ model: AgentEnrollmentKey, as: 'enrollmentKey', attributes: ['id', 'name'] }],
  });
  if (!d) throw new ApiError(404, 'This Asset has no agent', 'NOT_FOUND');
  const inv = d.inventory || {};
  // The signed-in account, and the contact it is (when the agent matched it
  // as the usual user).
  let signedInContact = null;
  if (inv.signedInUser && inv.agentAssignedContactId && inv.agentAssignedContactId === asset.assignedToContactId) {
    signedInContact = contactJson(await Contact.findByPk(asset.assignedToContactId, { attributes: ['id', 'displayName'] }));
  }
  res.json({
    device: {
      ...deviceSummary(d),
      arch: d.arch,
      hostname: d.hostname,
      enrolledAt: d.createdAt,
      enrollmentKey: d.enrollmentKey ? { id: d.enrollmentKey.id, name: d.enrollmentKey.name } : null,
      lastInventoryAt: d.lastInventoryAt,
      revokedAt: d.revokedAt,
      updatePending: d.revokedAt ? false : updatePending(d),
      os: inv.os || null,
      cpu: inv.cpu || null,
      memoryBytes: inv.memoryBytes || null,
      domain: inv.domain || null,
      lastBootAt: inv.lastBootAt || null,
      disks: Array.isArray(inv.disks) ? inv.disks : [],
      adapters: Array.isArray(inv.adapters) ? inv.adapters : [],
      signedInUser: inv.signedInUser ? { account: inv.signedInUser.account || null } : null,
      signedInContact,
    },
  });
});

// GET /assets/:id/software?search=&page=&limit= → paginated, by name, with
// `programs`, the count of everything installed.
const listSoftware = asyncHandler(async (req, res) => {
  const asset = await Asset.findByPk(req.params.id, { attributes: ['id'] });
  if (!asset) throw new ApiError(404, 'Asset not found', 'NOT_FOUND');
  const where = { assetId: asset.id };
  const term = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  if (term) {
    const like = { [Op.like]: `%${escapeLike(term)}%` };
    where[Op.or] = [{ name: like }, { publisher: like }];
  }
  const { page, limit, offset } = parsePagination(req);
  const { rows, count } = await AssetSoftware.findAndCountAll({
    where,
    attributes: ['id', 'name', 'version', 'publisher', 'installDate'],
    order: [['name', 'ASC'], ['version', 'ASC'], ['id', 'ASC']],
    limit,
    offset,
  });
  // `total` is what matches; `programs` is everything installed.
  const programs = term ? await AssetSoftware.count({ where: { assetId: asset.id } }) : count;
  res.json({ ...paginated('software', { rows, count }, { page, limit }), programs });
});

// POST /devices/:id/revoke — the computer is refused from now on; its Asset
// and history stay. Re-enrolling it (a new key) is the way back.
const revoke = asyncHandler(async (req, res) => {
  const d = await Device.findByPk(parseRecordId(req.params.id) || 0);
  if (!d) throw new ApiError(404, 'Device not found', 'NOT_FOUND');
  if (!(await canAccessCompany(req.user, d.companyId))) throw new ApiError(403, 'You do not have access to this device', 'FORBIDDEN');
  if (!d.revokedAt) {
    await d.update({ revokedAt: new Date() });
    await writeAudit(req, 'agent.device_revoked', 'Device', d.id, { hostname: d.hostname, assetId: d.assetId });
    await logAssetActivity(d.assetId, req.user.id, 'agent_revoked', { hostname: d.hostname });
  }
  res.json({ device: deviceSummary(d) });
});

// POST /devices/:id/scan — Scan now: the computer sends a fresh inventory
// right after its next check-in (within its heartbeat interval, 5 minutes
// by default). Asking again while one is pending changes nothing.
const requestScan = asyncHandler(async (req, res) => {
  const d = await Device.findByPk(parseRecordId(req.params.id) || 0);
  if (!d) throw new ApiError(404, 'Device not found', 'NOT_FOUND');
  if (!(await canAccessCompany(req.user, d.companyId))) throw new ApiError(403, 'You do not have access to this device', 'FORBIDDEN');
  if (d.revokedAt) throw new ApiError(400, 'This computer was revoked', 'DEVICE_REVOKED');
  if (!d.scanRequestedAt) {
    await d.update({ scanRequestedAt: new Date() });
    await logAssetActivity(d.assetId, req.user.id, 'agent_scan_requested', { hostname: d.hostname });
  }
  res.json({ device: deviceSummary(d) });
});

// GET /devices/packages → the installers this PRISM can hand out, one entry
// per file: { platform, arch, arches, universal, version, size, file }. The
// Mac's universal .pkg covers amd64 and arm64 and is listed once.
const listPackages = asyncHandler(async (req, res) => {
  const packages = [];
  for (const platform of PLATFORMS) {
    for (const arch of ARCHES) {
      let pkg = null;
      try { pkg = latestPackage(platform, arch); } catch (err) { pkg = null; }
      if (pkg) {
        const file = path.basename(pkg.file);
        const same = packages.find((p) => p.platform === platform && p.file === file);
        if (same) {
          same.arches.push(arch);
          same.universal = true;
        } else {
          packages.push({
            platform, arch, arches: [arch], universal: false, version: pkg.version, size: pkg.size, file,
          });
        }
      }
    }
  }
  res.json({ packages });
});

// GET /devices/packages/:platform/:arch → the installer itself (staff only;
// never published anywhere else — owner, 2026-11-03).
const downloadPackage = asyncHandler(async (req, res) => {
  const { platform, arch } = req.params;
  if (!PLATFORMS.includes(platform) || !ARCHES.includes(arch)) throw new ApiError(404, 'No such installer', 'NOT_FOUND');
  const pkg = latestPackage(platform, arch);
  if (!pkg) throw new ApiError(404, 'No installer for that platform yet', 'NOT_FOUND');
  await writeAudit(req, 'agent.installer_downloaded', 'Device', null, { platform, arch, version: pkg.version });
  res.set('X-Prism-Sha256', pkg.sha256);
  await new Promise((resolve, reject) => {
    res.download(pkg.file, path.basename(pkg.file), { dotfiles: 'deny' }, (err) => (err && !res.headersSent ? reject(err) : resolve()));
  });
});

module.exports = {
  listForCompany, getForAsset, listSoftware, revoke, requestScan, listPackages, downloadPackage, deviceStatus, statusWhere, deviceSummary, ONLINE_MS, STALE_MS,
};
