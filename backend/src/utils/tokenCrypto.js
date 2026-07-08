// AES-256-GCM encryption for OAuth tokens at rest (UserCalendarIntegration
// .accessToken/.refreshToken). Reuses SESSION_SECRET rather than requiring a
// brand-new env var for existing deployments — it's already a required,
// server-only secret (see backend/src/index.js's startup warning).
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKey() {
  const secret = process.env.SESSION_SECRET || 'changeme';
  // SESSION_SECRET can be any length/format — derive a fixed 32-byte key.
  return crypto.createHash('sha256').update(secret).digest();
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
  } catch {
    return null; // wrong key / tampered ciphertext
  }
}

module.exports = { encryptToken, decryptToken };
