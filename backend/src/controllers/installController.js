// Install links (8d, Task 2): public, the install key in the path is the
// credential. GET /install/:key answers what the page shows; the others hand
// out the signed installers (renamed so they enroll themselves) and the
// install scripts. A link that doesn't work (unknown, revoked, expired, used
// up, or the company made inactive) gets the same 404 everywhere.
const path = require('path');
const { Company } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { latestPackage, FORMATS } = require('../services/agent/updates');
const {
  baseUrl, setupFileName, usableKey, linuxScript, macScript, windowsScript,
} = require('../services/agent/installLinks');

const ARCHES = ['amd64', 'arm64'];
const notWorking = () => new ApiError(404, 'This install link no longer works. Ask your IT team for a new one.', 'INSTALL_LINK_INVALID');

async function loadLink(req) {
  const key = await usableKey(req.params.key);
  if (!key) throw notWorking();
  const company = await Company.findByPk(key.companyId, { attributes: ['id', 'name', 'status'] });
  if (!company || company.status !== 'active') throw notWorking();
  return { key, company };
}

const pkgOrNull = (platform, arch, format) => {
  try { return latestPackage(platform, arch, format); } catch (err) { return null; }
};
const summary = (pkg) => (pkg ? { version: pkg.version, size: pkg.size } : null);

// GET /install/:key → { company: { name }, url, windows, macos, linux: { deb: { amd64, arm64 }, ... } }
const getLink = asyncHandler(async (req, res) => {
  const { company } = await loadLink(req);
  const linux = {};
  for (const format of FORMATS.linux) {
    linux[format] = {};
    for (const arch of ARCHES) linux[format][arch] = summary(pkgOrNull('linux', arch, format));
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    company: { name: company.name },
    url: baseUrl(req),
    windows: summary(pkgOrNull('windows', 'amd64', 'msi')),
    macos: summary(pkgOrNull('macos', 'arm64', 'pkg') || pkgOrNull('macos', 'amd64', 'pkg')),
    linux,
  });
});

async function send(req, res, { key, platform, arch, format }, fileName) {
  const pkg = pkgOrNull(platform, arch, format);
  if (!pkg) throw new ApiError(404, 'No installer for that system yet', 'NOT_FOUND');
  await writeAudit({ user: null }, 'agent.install_link_download', 'Company', key.companyId, {
    keyId: key.id, platform, arch, format, version: pkg.version, ip: req.ip,
  });
  res.set('X-Prism-Sha256', pkg.sha256);
  res.set('Cache-Control', 'no-store');
  await new Promise((resolve, reject) => {
    res.download(pkg.file, fileName || path.basename(pkg.file), { dotfiles: 'deny' }, (err) => (err && !res.headersSent ? reject(err) : resolve()));
  });
}

// GET /install/:key/windows → the MSI, named so a double-click enrolls.
const windows = asyncHandler(async (req, res) => {
  const { key } = await loadLink(req);
  await send(req, res, {
    key, platform: 'windows', arch: 'amd64', format: 'msi',
  }, setupFileName(baseUrl(req), req.params.key, 'msi'));
});

// GET /install/:key/mac → the universal .pkg, named so it enrolls.
const mac = asyncHandler(async (req, res) => {
  const { key } = await loadLink(req);
  const arch = pkgOrNull('macos', 'arm64', 'pkg') ? 'arm64' : 'amd64';
  await send(req, res, {
    key, platform: 'macos', arch, format: 'pkg',
  }, setupFileName(baseUrl(req), req.params.key, 'pkg'));
});

// GET /install/:key/linux/:format/:arch → a Linux package (the script's
// download; Linux packages can't read their own name).
const linuxPackage = asyncHandler(async (req, res) => {
  const { key } = await loadLink(req);
  const { format, arch } = req.params;
  if (!FORMATS.linux.includes(format) || !ARCHES.includes(arch)) throw new ApiError(404, 'No such installer', 'NOT_FOUND');
  await send(req, res, {
    key, platform: 'linux', arch, format,
  });
});

const script = (make, type) => asyncHandler(async (req, res) => {
  await loadLink(req);
  res.set('Content-Type', `${type}; charset=utf-8`);
  res.set('Cache-Control', 'no-store');
  res.send(make(baseUrl(req), req.params.key));
});

module.exports = {
  getLink,
  windows,
  mac,
  linuxPackage,
  linuxScript: script(linuxScript, 'text/x-shellscript'),
  macScript: script(macScript, 'text/x-shellscript'),
  windowsScript: script(windowsScript, 'text/plain'),
};
