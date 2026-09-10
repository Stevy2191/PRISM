// Password policy for local accounts.
//
// The previous rule was "at least 8 characters", which accepts "password",
// "12345678" and the account's own username. PRISM local accounts are the
// break-glass path into an installation — including the bootstrap
// administrator — so they get a policy proportionate to that.
//
// Deliberately not implemented here: forced periodic rotation. Current NIST
// guidance (SP 800-63B) recommends against expiry in favour of length and
// screening, and rotation reliably produces Summer2026! style passwords.

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200; // bcrypt truncates past 72 bytes; reject absurd input early

// Lowercased. Short, high-frequency list — this is a guard against the
// obvious, not a substitute for a breach-corpus check.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'welcome1', 'admin', 'administrator',
  'changeme', 'change-me', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'sunshine', 'princess', 'trustno1', 'abc123', 'abcd1234', 'test1234', 'temp1234',
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000',
  'helpdesk', 'service', 'support', 'prism', 'prism123',
]);

// Reduces "Passw0rd!!!" style padding and keyboard runs to something the
// common-password check can actually match.
function normalize(password) {
  return String(password).trim().toLowerCase();
}

function hasSequentialRun(password, length = 4) {
  const s = password.toLowerCase();
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < s.length; i += 1) {
    const delta = s.charCodeAt(i) - s.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= length || descending >= length) return true;
  }
  return false;
}

// `identity` carries the values a password must not simply restate — the
// username, display name and email of the account it belongs to.
function validatePassword(password, identity = {}) {
  const problems = [];
  const value = password === null || password === undefined ? '' : String(password);

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    problems.push(`be no longer than ${MAX_PASSWORD_LENGTH} characters`);
  }

  // Three of four character classes, rather than all four: it keeps long
  // passphrases usable while still ruling out single-class passwords.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes < 3) {
    problems.push('include at least three of: lowercase, uppercase, numbers, symbols');
  }

  const normalized = normalize(value);
  if (COMMON_PASSWORDS.has(normalized)) {
    problems.push('not be a commonly used password');
  }

  if (/^(.)\1+$/.test(value)) {
    problems.push('not be a single repeated character');
  }

  if (hasSequentialRun(value)) {
    problems.push('not contain long runs of sequential characters (e.g. "abcd", "4321")');
  }

  // A password that contains the account name is trivially guessable by
  // anyone who can see the user list.
  const identityParts = [identity.username, identity.displayName, identity.firstName, identity.lastName]
    .filter(Boolean)
    .map((part) => String(part).toLowerCase())
    .filter((part) => part.length >= 3);
  const emailLocal = identity.email ? String(identity.email).split('@')[0].toLowerCase() : null;
  if (emailLocal && emailLocal.length >= 3) identityParts.push(emailLocal);

  if (identityParts.some((part) => normalized.includes(part))) {
    problems.push('not contain your username, name or email address');
  }

  return { ok: problems.length === 0, problems };
}

// Single sentence suitable for an API error message.
function describeProblems(problems) {
  if (!problems.length) return '';
  return `Password must ${problems.join(', and must ')}.`;
}

module.exports = {
  validatePassword,
  describeProblems,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
};
