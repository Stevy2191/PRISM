// Formats a phone number (raw digits or already-formatted) as (XXX) XXX-XXXX.
// Used both as a live onChange formatter for phone inputs and as a display
// formatter for stored values — strip-then-reformat guarantees consistent
// output regardless of how the value currently looks.
export function formatPhone(value) {
  // Strip everything except digits
  const digits = (value || '').replace(/\D/g, '');
  // Format as (XXX) XXX-XXXX
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// For showing a stored number: (XXX) XXX-XXXX when it is 10 digits (or 11
// starting with 1), otherwise as it is, so nothing is ever cut off.
export function showPhone(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? formatPhone(digits) : String(value);
}

export default formatPhone;
