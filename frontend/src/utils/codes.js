// Suggested short codes (CN), the same rule as the server's services/codes.js:
// "Washington County" → WC, "Human Resources" → HR, "Finance" → FIN.
const SMALL = new Set(['of', 'the', 'and', 'for', 'a', 'an', 'at', 'in', 'on', 'to', 'inc', 'llc', 'ltd', 'co', 'corp']);

export function suggestCode(name, { max = 6, single = 4 } = {}) {
  const words = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' ').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const meaningful = words.filter((w) => !SMALL.has(w.toLowerCase()));
  const use = meaningful.length ? meaningful : words;
  let code = use.length >= 2 ? use.map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w[0])).join('') : (use[0] || '').slice(0, single);
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
  return code;
}

// A code as it is typed: letters and digits, upper case, at most `max`.
export const cleanCode = (value, max = 6) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
