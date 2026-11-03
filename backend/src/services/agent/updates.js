// Signed agent updates (8a, task 6).
//
// Each PRISM install has its own update signing key (Ed25519), created on
// first use and kept encrypted in SystemSettings ('agent.updateKey', never
// returned by any settings endpoint). Agents receive its public half at
// enrolment and install only builds whose signature verifies with it, so a
// package swapped on the way, or served by anyone else, is refused.
//
// The packages come from the CI build, in AGENT_DIST_DIR (default
// /app/agent-dist) with a manifest.json:
//   [{ "platform": "windows", "arch": "amd64", "version": "0.6.0",
//      "file": "prism-agent-0.6.0-windows-amd64.msi", "sha256": "…" }]
// PRISM signs `platform|arch|version|sha256` only after checking the file
// on disk has that sha256, so a manifest that lies gets nothing signed.
// Downloads are signed device requests too: no package is public.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UniqueConstraintError } = require('sequelize');
const { SystemSettings } = require('../../models');
const { encryptToken, decryptToken } = require('../../utils/tokenCrypto');
const { ApiError } = require('../../middleware/error');

const KEY_SETTING = 'agent.updateKey';
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

const distDir = () => path.resolve(process.env.AGENT_DIST_DIR || '/app/agent-dist');

function keyFromSeed(seed) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicKeyB64 = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  return {
    publicKeyB64,
    sign: (buf) => crypto.sign(null, Buffer.from(buf), privateKey).toString('base64'),
  };
}

// The install's update key: { publicKeyB64, sign(buf) → base64 }. Created
// once; two first uses at the same moment agree on whichever was stored.
async function updateKey() {
  let row = await SystemSettings.findByPk(KEY_SETTING);
  if (!row) {
    const seed = crypto.randomBytes(32);
    try {
      row = await SystemSettings.create({ key: KEY_SETTING, value: encryptToken(seed.toString('base64')) });
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      row = await SystemSettings.findByPk(KEY_SETTING);
    }
  }
  const seedB64 = decryptToken(row.value);
  const seed = seedB64 ? Buffer.from(seedB64, 'base64') : null;
  if (!seed || seed.length !== 32) throw new Error('The agent update key cannot be read (was ENCRYPTION_KEY changed?)');
  return keyFromSeed(seed);
}

// Version order: numeric major.minor.patch; a pre-release sorts before its
// release (0.6.0-rc.1 < 0.6.0). Anything unreadable sorts lowest.
function compareVersions(a, b) {
  const parse = (v) => {
    if (typeof v !== 'string' || !VERSION.test(v)) return null;
    const [core, pre] = v.split(/-(.*)/s);
    return { nums: core.split('.').map(Number), pre: pre || null };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i += 1) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function readManifest() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(distDir(), 'manifest.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

// The file's real sha256, cached by path, size and modification time.
const hashCache = new Map();
function fileSha256(file) {
  const st = fs.statSync(file);
  const stamp = `${st.size}:${st.mtimeMs}`;
  const hit = hashCache.get(file);
  if (hit && hit.stamp === stamp) return { sha256: hit.sha256, size: st.size };
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  hashCache.set(file, { stamp, sha256 });
  return { sha256, size: st.size };
}

// The newest package for a platform and arch, checked on disk; null when
// none is listed. Listed but missing, or not the bytes the manifest says,
// is a 404: nothing is signed for it.
function latestPackage(platform, arch) {
  const candidates = readManifest().filter((e) => e && e.platform === platform && e.arch === arch
    && typeof e.file === 'string' && FILE_NAME.test(e.file) && VERSION.test(e.version || '') && SHA256.test(e.sha256 || ''));
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  if (!best) return null;
  const file = path.join(distDir(), best.file);
  let actual;
  const unavailable = () => new ApiError(404, 'The agent package is not available', 'NOT_FOUND');
  try {
    actual = fileSha256(file);
  } catch (err) {
    throw unavailable();
  }
  if (actual.sha256 !== best.sha256) throw unavailable();
  return {
    platform, arch, version: best.version, sha256: best.sha256, size: actual.size, file,
  };
}

const signedText = (p) => `${p.platform}|${p.arch}|${p.version}|${p.sha256}`;

// The update offer for a device, or null when it is up to date (or there is
// nothing to offer): { version, sha256, size, signature }.
async function updateFor(device) {
  const pkg = latestPackage(device.platform, device.arch);
  if (!pkg || compareVersions(pkg.version, device.agentVersion) <= 0) return null;
  const key = await updateKey();
  return {
    version: pkg.version, sha256: pkg.sha256, size: pkg.size, signature: key.sign(signedText(pkg)),
  };
}

module.exports = {
  updateKey, updateFor, latestPackage, compareVersions, signedText, KEY_SETTING,
};
