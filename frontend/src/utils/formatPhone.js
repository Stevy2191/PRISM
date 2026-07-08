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

export default formatPhone;
