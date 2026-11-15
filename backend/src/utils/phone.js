const { ApiError } = require('../middleware/error');

// Phone numbers are stored as 10 bare digits everywhere (users, contacts,
// companies, sites, contracts, devices) and shown as (XXX) XXX-XXXX (see
// frontend/src/utils/formatPhone.js, and formatPhone below for email). A
// leading country code 1 (+1 979 555 0100) is dropped.
function digitsOf(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizePhone(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = digitsOf(value);
  if (!digits) return null;
  if (digits.length !== 10) {
    throw new ApiError(400, 'Phone number must be 10 digits', 'VALIDATION_ERROR');
  }
  return digits;
}

// Best-effort variant for bulk ingestion (CSV import, AD and Microsoft 365
// sync) where one bad phone number shouldn't fail the whole row/record —
// returns null instead of throwing when it can't be made 10 digits.
function normalizePhoneLenient(value) {
  try {
    return normalizePhone(value);
  } catch {
    return null;
  }
}

// (XXX) XXX-XXXX for a 10-digit number; anything else as it is.
function formatPhone(value) {
  if (!value) return '';
  const d = digitsOf(value);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(value);
}

module.exports = { normalizePhone, normalizePhoneLenient, formatPhone };
