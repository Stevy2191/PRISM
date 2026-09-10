// AES-256-GCM encryption for OAuth tokens at rest (UserCalendarIntegration
// .accessToken/.refreshToken). Reuses SESSION_SECRET rather than requiring a
// brand-new env var for existing deployments — it's already a required,
// server-only secret (see backend/src/index.js's startup warning).
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

// Encryption key resolution, most specific first:
//
//   1. ENCRYPTION_KEY — a dedicated secret. Use this. It decouples data at
//      rest from the cookie-signing secret, so SESSION_SECRET can be rotated
//      (which is routine, and logs everyone out) without destroying the
//      stored LDAP bind password, license keys and OAuth tokens.
//   2. SESSION_SECRET — the original behaviour, kept so existing installs
//      keep working on upgrade. Rotating it makes previously stored
//      ciphertext undecryptable.
//
// There is deliberately no fallback default: index.js validates that one of
// these is present and refuses to boot otherwise, so reaching here without a
// key is a programming error rather than something to paper over.
function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY (or SESSION_SECRET) must be set to encrypt or decrypt stored credentials');
  }
  // The secret can be any length/format — derive a fixed 32-byte key.
  return crypto.createHash('sha256').update(secret).digest();
}

// True when the deployment is still deriving its data-at-rest key from
// SESSION_SECRET, which couples credential storage to cookie signing.
function usingSessionSecretForEncryption() {
  return !process.env.ENCRYPTION_KEY && !!process.env.SESSION_SECRET;
}

// Returns "iv:authTag:ciphertext" (all hex) — a single string, storable
// directly in a TEXT column. Returns null for null/undefined input so
// callers can pass through optional fields unchanged.
function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptToken(stored) {
  if (stored === null || stored === undefined) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 3) return null; // not our format — corrupt/legacy, fail closed
  const [ivHex, authTagHex, ciphertextHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    // Almost always means the encryption key changed under existing data
    // (typically a SESSION_SECRET rotation while ENCRYPTION_KEY is unset).
    // Silence here surfaced as "AD login just stopped working" with nothing
    // in the logs, so say so plainly. The value itself is never logged.
    console.error(
      '[crypto] could not decrypt a stored value — the encryption key has probably changed. '
      + 'If SESSION_SECRET was rotated, set ENCRYPTION_KEY to the previous value, or re-enter '
      + 'the affected credentials in Settings.',
      err.message
    );
    return null; // wrong key / tampered ciphertext
  }
}

module.exports = { encryptToken, decryptToken, usingSessionSecretForEncryption };
