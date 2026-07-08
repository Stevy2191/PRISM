const { ApiError } = require('../middleware/error');

// Strips a phone number down to raw digits — the DB only ever stores clean
// 10-digit strings; (XXX) XXX-XXXX formatting is purely a frontend
// display/input concern (see frontend/src/utils/formatPhone.js).
function normalizePhone(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 10) {
    throw new ApiError(400, 'Phone number must be 10 digits', 'VALIDATION_ERROR');
  }
  return digits;
}

// Best-effort variant for bulk ingestion (CSV import, AD sync) where one bad
// phone number shouldn't fail the whole row/record — returns null instead of
// throwing when the value can't be normalized to exactly 10 digits.
function normalizePhoneLenient(value) {
  try {
    return normalizePhone(value);
  } catch {
    return null;
  }
}

module.exports = { normalizePhone, normalizePhoneLenient };
