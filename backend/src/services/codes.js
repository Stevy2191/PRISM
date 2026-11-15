// Short codes for companies (WC) and departments (HR): suggested from a name,
// and made unique (CN). A company's code starts its ticket and project
// numbers (WC-T0042, WC-HR-P0007); a department's sits in its project numbers.

const SMALL = new Set(['of', 'the', 'and', 'for', 'a', 'an', 'at', 'in', 'on', 'to', 'inc', 'llc', 'ltd', 'co', 'corp']);
const CODE_RE = /^[A-Z0-9]+$/;

// "Washington County" → WC, "Harbor Law Group" → HLG, "Human Resources" → HR,
// "Finance" → FIN, "Acme Manufacturing" → AM. One word: its first letters.
function suggestCode(name, { max = 6, single = 4 } = {}) {
  const words = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' ').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const meaningful = words.filter((w) => !SMALL.has(w.toLowerCase()));
  const use = meaningful.length ? meaningful : words;
  let code;
  if (use.length >= 2) code = use.map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w[0])).join('');
  else code = (use[0] || 'X').slice(0, single);
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
  return code.length >= 2 ? code : `${code}X`.slice(0, Math.max(2, code.length + 1));
}

// base, base2, base3 … whichever no one in `taken` has (case-insensitive).
function uniqueCode(base, taken, max = 6) {
  const used = new Set([...taken].filter(Boolean).map((c) => String(c).toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const tail = String(n);
    const candidate = `${base.slice(0, max - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
}

function isValidCode(code, { min = 2, max = 6 } = {}) {
  return typeof code === 'string' && code.length >= min && code.length <= max && CODE_RE.test(code);
}

module.exports = { suggestCode, uniqueCode, isValidCode };
