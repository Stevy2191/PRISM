// Management and cellular details on a device (Playbooks, PB, task 3).
//   Management: managed yes/no, which MDM (from the install's own list) and
//   the device's id there.
//   Cellular:   any device may have a line: IMEI, phone number, carrier (a
//               vendor company).
//   Hold:       an on_hold device says why.
// Each resolve* takes the request body and the record (null on create) and
// returns the columns to set; anything not sent is left as it is.
const { Op } = require('sequelize');
const { Asset, Mdm } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { normalizePhone } = require('../../utils/phone');
const { resolveVendorCompany } = require('../companyService');
const { parseRecordId } = require('../permissionService');

const bad = (message) => new ApiError(400, message, 'VALIDATION_ERROR');
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// An MDM's console address: http(s) only, so a stored link can never run
// script when it's clicked. {id} is where the device's MDM id goes.
function cleanConsoleUrl(raw) {
  if (blank(raw)) return null;
  const text = String(raw).trim();
  if (text.length > 500) throw bad('The console address is too long');
  let url;
  try { url = new URL(text.replace(/\{id\}/g, 'ID')); } catch { throw bad('The console address must be a web address'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('The console address must start with https:// or http://');
  return text;
}

// → the link to a device in its MDM's console, or null.
function mdmLink(mdm, mdmDeviceId) {
  if (!mdm || !mdm.consoleUrl || blank(mdmDeviceId)) return null;
  return mdm.consoleUrl.replace(/\{id\}/g, encodeURIComponent(String(mdmDeviceId).trim()));
}

// 15 digits with a valid check digit (the Luhn check every IMEI carries).
function normalizeImei(raw) {
  const digits = String(raw).replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(digits)) throw bad('An IMEI is 15 digits');
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let d = Number(digits[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  if (sum % 10 !== 0) throw bad("That IMEI isn't valid: check the digits");
  return digits;
}

async function resolveManagement(body, record) {
  const sent = ['isManaged', 'mdmId', 'mdmDeviceId'].some((f) => body[f] !== undefined);
  if (!sent) return {};
  const managed = body.isManaged !== undefined ? bool(body.isManaged) : !!(record && record.isManaged);
  if (!managed) return { isManaged: false, mdmId: null, mdmDeviceId: null };
  const out = { isManaged: true };
  const rawMdm = body.mdmId !== undefined ? body.mdmId : record && record.mdmId;
  const mdmId = parseRecordId(rawMdm);
  if (!mdmId) throw bad('Choose the MDM that manages this device');
  if (!record || record.mdmId !== mdmId) {
    // A retired MDM stays on the devices that have it, but isn't picked anew.
    const mdm = await Mdm.findByPk(mdmId);
    if (!mdm || !mdm.isActive) throw bad('Unknown MDM');
  }
  out.mdmId = mdmId;
  if (body.mdmDeviceId !== undefined) {
    out.mdmDeviceId = blank(body.mdmDeviceId) ? null : String(body.mdmDeviceId).trim().slice(0, 150);
  }
  return out;
}

async function resolveCellular(user, body, record, category) {
  const sent = ['hasCellular', 'imei', 'phoneNumber', 'carrierCompanyId'].some((f) => body[f] !== undefined);
  // A new device in a "cellular by default" category starts with a line.
  const fallback = record ? record.hasCellular : !!(category && category.cellularByDefault);
  const cellular = body.hasCellular !== undefined ? bool(body.hasCellular) : fallback;
  if (!sent && record) return {};
  if (!cellular) return { hasCellular: false, imei: null, phoneNumber: null, carrierCompanyId: null };
  const out = { hasCellular: true };
  const imei = body.imei !== undefined ? body.imei : record && record.imei;
  if (blank(imei)) throw bad('Enter the IMEI of a device with cellular service');
  out.imei = normalizeImei(imei);
  if (body.phoneNumber !== undefined) out.phoneNumber = normalizePhone(blank(body.phoneNumber) ? null : body.phoneNumber);
  if (body.carrierCompanyId !== undefined) {
    if (blank(body.carrierCompanyId)) out.carrierCompanyId = null;
    else if (!record || parseRecordId(body.carrierCompanyId) !== record.carrierCompanyId) {
      out.carrierCompanyId = (await resolveVendorCompany(user, body.carrierCompanyId)).id;
    }
  }
  return out;
}

function resolveHold(body, record) {
  const status = body.status !== undefined ? body.status : record && record.status;
  if (status !== 'on_hold') return body.status !== undefined || body.holdReason !== undefined ? { holdReason: null } : {};
  const reason = body.holdReason !== undefined ? body.holdReason : record && record.holdReason;
  if (blank(reason)) throw bad('Say why the device is on hold');
  return { holdReason: String(reason).trim().slice(0, 255) };
}

// → ['IMEI_IN_USE', 'PHONE_IN_USE']: another device still in use has the
// same line. A warning only; retired and lost devices don't count.
async function duplicateWarnings(asset) {
  if (!asset.hasCellular) return [];
  const others = { id: { [Op.ne]: asset.id }, status: { [Op.notIn]: ['retired', 'lost'] } };
  const warnings = [];
  if (asset.imei && await Asset.count({ where: { ...others, imei: asset.imei } })) warnings.push('IMEI_IN_USE');
  if (asset.phoneNumber && await Asset.count({ where: { ...others, phoneNumber: asset.phoneNumber } })) warnings.push('PHONE_IN_USE');
  return warnings;
}

module.exports = {
  cleanConsoleUrl, mdmLink, normalizeImei, resolveManagement, resolveCellular, resolveHold, duplicateWarnings,
};
