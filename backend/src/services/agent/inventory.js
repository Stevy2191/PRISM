// Inventory from the PRISM agent into Assets (8a).
//
// The agent owns these Asset fields and overwrites them at every inventory:
// name, make, model, serial number, processor, RAM, storage, operating
// system, OS version, firmware version, IP and MAC. Everything else on the
// Asset (location, purchase, warranty, notes, status…) stays staff-owned.
// Detail that has no Asset field (each disk and adapter, domain, last boot,
// the signed-in user) goes in Device.inventory; the software list replaces
// AssetSoftware as a whole.
//
// The usual user: the signed-in account's UPN or email is matched to a
// contact of the Asset's own company. The agent sets the Asset's assigned
// contact only while nobody has set it by hand: when it is empty, or still
// the contact the agent set last time. No contact is ever created, and the
// placeholder "Unknown tray user" contact (task 5) is never matched.
//
// Inventory is untrusted text: everything is type-checked, trimmed and cut
// to its column; unknown keys are dropped.
const { Op } = require('sequelize');
const {
  sequelize, Asset, AssetSoftware, Contact,
} = require('../../models');
const { ApiError } = require('../../middleware/error');
const { logAssetActivity } = require('../assetActivity');

const MAX_SOFTWARE = 5000;
const MAX_DISKS = 64;
const MAX_ADAPTERS = 64;
const GB = 1024 ** 3;

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null); // eslint-disable-line no-control-regex
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const gb = (bytes) => `${Math.round(bytes / GB)} GB`;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MAC = /^[0-9A-F]{2}([:-][0-9A-F]{2}){5}$/i;

// Windows writes InstallDate as YYYYMMDD; others send YYYY-MM-DD.
function installDate(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

function parseInventory(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (Array.isArray(b.software) && b.software.length > MAX_SOFTWARE) {
    throw new ApiError(413, `At most ${MAX_SOFTWARE} programs in one inventory`, 'PAYLOAD_TOO_LARGE');
  }
  const cpu = b.cpu && typeof b.cpu === 'object' ? { model: str(b.cpu.model, 120), cores: int(b.cpu.cores) } : { model: null, cores: null };
  const os = b.os && typeof b.os === 'object'
    ? { name: str(b.os.name, 100), edition: str(b.os.edition, 100), version: str(b.os.version, 30), build: str(b.os.build, 30) }
    : {};
  const disks = (Array.isArray(b.disks) ? b.disks : []).slice(0, MAX_DISKS).map((d) => ({
    name: str(d && d.name, 64), label: str(d && d.label, 128), kind: str(d && d.kind, 32), sizeBytes: num(d && d.sizeBytes), freeBytes: num(d && d.freeBytes),
  })).filter((d) => d.name && d.sizeBytes !== null);
  const adapters = (Array.isArray(b.adapters) ? b.adapters : []).slice(0, MAX_ADAPTERS).map((a) => ({
    name: str(a && a.name, 128),
    ipv4: (Array.isArray(a && a.ipv4) ? a.ipv4 : []).filter((ip) => typeof ip === 'string' && IPV4.test(ip)).slice(0, 16),
    mac: typeof (a && a.mac) === 'string' && MAC.test(a.mac) ? a.mac.toUpperCase().replace(/-/g, ':') : null,
    primary: !!(a && a.primary),
  })).filter((a) => a.name);
  const seen = new Set();
  const software = (Array.isArray(b.software) ? b.software : []).map((s) => ({
    name: str(s && s.name, 255), version: str(s && s.version, 100), publisher: str(s && s.publisher, 255), installDate: installDate(s && s.installDate),
  })).filter((s) => {
    if (!s.name) return false;
    const key = `${s.name.toLowerCase()}\u0000${(s.version || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const u = b.signedInUser && typeof b.signedInUser === 'object' ? b.signedInUser : null;
  const signedInUser = u && str(u.account, 255)
    ? { account: str(u.account, 255), upn: EMAIL.test(u.upn || '') ? str(u.upn, 255) : null, email: EMAIL.test(u.email || '') ? str(u.email, 255) : null }
    : null;
  const lastBoot = typeof b.lastBootAt === 'string' && !Number.isNaN(Date.parse(b.lastBootAt)) ? new Date(b.lastBootAt).toISOString() : null;
  return {
    hostname: str(b.hostname, 255),
    make: str(b.make, 100),
    model: str(b.model, 100),
    serialNumber: str(b.serialNumber, 150),
    firmware: str(b.firmware, 50),
    domain: str(b.domain, 255),
    memoryBytes: num(b.memoryBytes),
    cpu,
    os,
    disks,
    adapters,
    software,
    signedInUser,
    lastBootAt: lastBoot,
  };
}

// The Asset's own fields, from a parsed inventory. Missing values leave the
// field as it is (an agent that can't read the serial doesn't blank it).
function assetFields(p) {
  const fields = {};
  if (p.hostname) fields.name = p.hostname;
  if (p.make) fields.make = p.make;
  if (p.model) fields.model = p.model;
  if (p.serialNumber) fields.serialNumber = p.serialNumber;
  if (p.cpu.model) fields.processor = (p.cpu.cores ? `${p.cpu.model} (${p.cpu.cores} cores)` : p.cpu.model).slice(0, 150);
  if (p.memoryBytes) fields.ram = gb(p.memoryBytes);
  // The computer's own storage: external drives (USB, removable) are left
  // out when there is an internal one (USB, Thunderbolt and other external
  // buses, SD cards); every disk is still in the Device tab.
  const internal = p.disks.filter((d) => !/^(usb|external|removable)$/i.test(d.kind || ''));
  const counted = internal.length ? internal : p.disks;
  if (counted.length) {
    const total = counted.reduce((n, d) => n + d.sizeBytes, 0);
    const free = counted.reduce((n, d) => n + (d.freeBytes || 0), 0);
    fields.storage = `${gb(total)} (${gb(free)} free)`.slice(0, 50);
  }
  if (p.firmware) fields.firmwareVersion = p.firmware;
  const osName = p.os.edition || p.os.name;
  if (osName) fields.operatingSystem = osName;
  if (p.os.version || p.os.build) fields.osVersion = [p.os.version, p.os.build && `(${p.os.build})`].filter(Boolean).join(' ').slice(0, 50);
  const primary = p.adapters.find((a) => a.primary && a.ipv4.length) || p.adapters.find((a) => a.ipv4.length);
  if (primary) {
    fields.ipAddress = primary.ipv4[0];
    if (primary.mac) fields.macAddress = primary.mac;
  }
  return fields;
}

// The contact the signed-in user is, within the Asset's company. Never the
// placeholder, never another company's.
async function matchContact(companyId, user, transaction) {
  if (!user) return null;
  const emails = [user.upn, user.email].filter(Boolean).map((e) => e.toLowerCase());
  if (!emails.length) return null;
  const where = { companyId, email: { [Op.in]: [...new Set(emails)] }, isPlaceholder: false };
  return Contact.findOne({ where, attributes: ['id', 'departmentId'], transaction });
}

// → { changedFields, software: { added, removed } }
async function applyInventory(device, body) {
  const p = parseInventory(body);
  const result = await sequelize.transaction(async (transaction) => {
    const asset = await Asset.findByPk(device.assetId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!asset) throw new ApiError(404, 'This device has no Asset', 'NOT_FOUND');
    const fields = assetFields(p);
    const inventory = { ...(device.inventory || {}) };

    // The usual user.
    if (p.signedInUser) {
      const contact = await matchContact(asset.companyId, p.signedInUser, transaction);
      const handSet = asset.assignedToContactId && asset.assignedToContactId !== inventory.agentAssignedContactId;
      if (contact && !handSet) {
        // A new usual user brings their department with them.
        if (contact.id !== asset.assignedToContactId && contact.departmentId) fields.departmentId = contact.departmentId;
        fields.assignedToContactId = contact.id;
        inventory.agentAssignedContactId = contact.id;
      }
    }

    const changedFields = Object.keys(fields).filter((k) => (asset[k] ?? null) !== (fields[k] ?? null));
    if (changedFields.length) await asset.update(Object.fromEntries(changedFields.map((k) => [k, fields[k]])), { transaction });

    // Software: the whole list, replaced.
    const before = await AssetSoftware.findAll({ where: { assetId: asset.id }, attributes: ['name', 'version'], raw: true, transaction });
    const key = (s) => `${s.name.toLowerCase()}\u0000${(s.version || '').toLowerCase()}`;
    const beforeKeys = new Set(before.map(key));
    const afterKeys = new Set(p.software.map(key));
    await AssetSoftware.destroy({ where: { assetId: asset.id }, transaction });
    if (p.software.length) await AssetSoftware.bulkCreate(p.software.map((s) => ({ ...s, assetId: asset.id })), { transaction });

    Object.assign(inventory, {
      cpu: p.cpu, memoryBytes: p.memoryBytes, os: p.os, disks: p.disks, adapters: p.adapters, domain: p.domain, lastBootAt: p.lastBootAt,
      signedInUser: p.signedInUser,
    });
    await device.update({
      inventory, lastInventoryAt: new Date(), lastSeenAt: new Date(), scanRequestedAt: null, ...(p.hostname ? { hostname: p.hostname } : {}),
    }, { transaction });

    return {
      assetId: asset.id,
      changedFields,
      software: {
        added: [...afterKeys].filter((k) => !beforeKeys.has(k)).length,
        removed: [...beforeKeys].filter((k) => !afterKeys.has(k)).length,
      },
    };
  });
  if (result.changedFields.length) {
    await logAssetActivity(result.assetId, null, 'agent_inventory', { changed: result.changedFields });
  }
  // Ticket forms waiting on this computer's agent tick those steps (PB).
  // Lazy: the playbooks services load much of the app.
  await require('../playbooks/ticketForms').markAgentItems(result.assetId, new Date()); // eslint-disable-line global-require
  return { changedFields: result.changedFields, software: result.software };
}

// The fields the agent owns, for the edit form's "replaced at the next
// inventory" note (task 12).
const AGENT_FIELDS = ['name', 'make', 'model', 'serialNumber', 'processor', 'ram', 'storage', 'operatingSystem', 'osVersion', 'firmwareVersion', 'ipAddress', 'macAddress'];

module.exports = {
  applyInventory, parseInventory, assetFields, matchContact, AGENT_FIELDS, MAX_SOFTWARE,
};
