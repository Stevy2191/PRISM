// Fail-closed startup configuration validation.
//
// PRISM is deployed into environments where a silently-insecure default is
// worse than a refused boot: a guessable SESSION_SECRET lets anyone forge a
// session cookie for any user, and the same secret derives the AES key that
// protects the LDAP bind password, license keys and OAuth tokens at rest
// (see utils/tokenCrypto.js). Historically these only produced a warning —
// and only when NODE_ENV happened to be exactly "production" — so an install
// that never set NODE_ENV ran on the published placeholder secret with no
// indication anything was wrong.
//
// Every problem is reported at once with the exact remedy, so an operator
// fixes one .env and boots, rather than discovering issues one restart at a
// time.

// Placeholders shipped in .env.example / setup.sh. Anything appearing here is
// public knowledge and must never reach a running instance.
const PLACEHOLDERS = new Set(['changeme', 'rootchangeme', 'change-me', 'secret', 'password']);

const MIN_SECRET_LENGTH = 32;

function isPlaceholder(value) {
  return value !== undefined && PLACEHOLDERS.has(String(value).trim().toLowerCase());
}

// Collects problems rather than throwing on the first one.
function collectProblems(env) {
  const problems = [];
  const secret = env.SESSION_SECRET;

  if (!secret || !String(secret).trim()) {
    problems.push(
      'SESSION_SECRET is not set.\n' +
      '    It signs session cookies and derives the encryption key for stored\n' +
      '    credentials. Generate one with:  openssl rand -hex 32'
    );
  } else if (isPlaceholder(secret)) {
    problems.push(
      `SESSION_SECRET is still the placeholder "${secret}" from .env.example.\n` +
      '    Anyone can forge a session cookie for any user with this value.\n' +
      '    Generate a real one with:  openssl rand -hex 32'
    );
  } else if (String(secret).length < MIN_SECRET_LENGTH) {
    problems.push(
      `SESSION_SECRET is only ${String(secret).length} characters; ` +
      `${MIN_SECRET_LENGTH} or more are required.\n` +
      '    Generate one with:  openssl rand -hex 32'
    );
  }

  if (isPlaceholder(env.DB_PASSWORD)) {
    problems.push(
      `DB_PASSWORD is still the placeholder "${env.DB_PASSWORD}".\n` +
      '    Set a real database password in .env (and in your database server).'
    );
  }

  if (isPlaceholder(env.BOOTSTRAP_LOCAL_PASSWORD)) {
    problems.push(
      `BOOTSTRAP_LOCAL_PASSWORD is still the placeholder "${env.BOOTSTRAP_LOCAL_PASSWORD}".\n` +
      '    This is the first administrator password — set a strong unique value,\n' +
      '    or remove the variable entirely if the admin account already exists.'
    );
  }

  // A Secure cookie is never sent over plain HTTP, so requiring it blindly
  // would lock operators out of legitimate internal HTTP deployments. Only
  // insist on it when the instance advertises itself over HTTPS.
  const publicUrl = env.PUBLIC_APP_URL;
  if (publicUrl && /^https:/i.test(publicUrl) && env.COOKIE_SECURE !== 'true') {
    problems.push(
      'PUBLIC_APP_URL is an https:// address but COOKIE_SECURE is not "true".\n' +
      '    Session cookies would be transmitted without the Secure flag.\n' +
      '    Set COOKIE_SECURE=true in .env.'
    );
  }

  // TRUST_PROXY decides whether X-Forwarded-For is believed. Believing it when
  // the backend is reachable directly lets a client forge its own source IP and
  // walk straight past the login rate limiter, so the value is explicit rather
  // than assumed.
  const trustProxy = env.TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy !== '' && parseTrustProxy(trustProxy) === null) {
    problems.push(
      `TRUST_PROXY="${trustProxy}" is not a valid value.\n` +
      '    Use "false" (backend reachable directly), a hop count such as "1"\n' +
      '    (behind the bundled nginx), or a comma-separated list of trusted\n' +
      '    proxy IPs/CIDRs.'
    );
  }

  return problems;
}

// Express's trust proxy setting accepts several shapes; normalize the env
// string into one of them. Returns null when the value is unusable.
function parseTrustProxy(raw) {
  const value = String(raw).trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  // Comma-separated IPs / CIDRs / named presets (loopback, linklocal, uniquelocal).
  const list = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  return null;
}

// Default: do not trust proxy headers. The bundled Docker Compose stack puts
// nginx in front of the backend, so those deployments set TRUST_PROXY=1 — but
// an install that publishes the backend port directly must not believe
// X-Forwarded-For, and silence should mean the safe choice.
function resolveTrustProxy(env) {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw === '') return false;
  const parsed = parseTrustProxy(raw);
  return parsed === null ? false : parsed;
}

function validateEnv(env = process.env, { exitOnFailure = true } = {}) {
  const problems = collectProblems(env);
  if (!problems.length) return { ok: true, problems: [] };

  const message =
    '\n[prism] Refusing to start — insecure or incomplete configuration:\n\n' +
    problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n\n') +
    '\n\n  Fix the values above in your .env file, then start PRISM again.\n' +
    '  See UPGRADING.md for details on these requirements.\n';

  if (exitOnFailure) {
    console.error(message);
    process.exit(1);
  }
  return { ok: false, problems, message };
}

module.exports = { validateEnv, resolveTrustProxy, parseTrustProxy, collectProblems, MIN_SECRET_LENGTH };
