// Install links and push scripts (8d, Task 2). An install key's secret is
// the credential: https://<PRISM>/install/<key> is a page anyone with the
// link can open, and the routes under /api/v1/install/<key>/ hand out the
// signed installers and the scripts that install them. Nothing here says
// anything about a key that isn't usable: unknown, revoked, expired and
// used-up keys all look the same.

const { findKeyBySecret, KEY_PREFIX } = require('./enrollment');

// The address computers reach PRISM at: PUBLIC_APP_URL, else what this
// request came in on (the proxy's scheme and host).
function baseUrl(req) {
  const configured = (process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/\s]+$/i.test(configured)) return configured;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim() === 'http' ? 'http' : 'https';
  return `${proto}://${req.get('host')}`;
}

// The installer's file name carries the enrollment, so double-clicking it
// enrolls (Task 3): PRISM-Agent-Setup_<host>_<key>.<ext>. A port is written
// with "+" (a colon isn't allowed in a Windows file name).
function setupFileName(base, secret, ext) {
  const host = new URL(base).host.replace(':', '+');
  return `PRISM-Agent-Setup_${host}_${secret}.${ext}`;
}

// A secret that could be a key (the shape only): anything else is refused
// before the database is asked.
const KEY_SHAPE = /^pk_enr_[A-Za-z0-9_-]{43}$/;

// The key behind a link, or null when the link doesn't work (for whatever
// reason: callers answer the same in every case).
async function usableKey(secret) {
  if (typeof secret !== 'string' || !KEY_SHAPE.test(secret)) return null;
  const key = await findKeyBySecret(secret);
  if (!key || !key.isUsable()) return null;
  return key;
}

// Single quotes in sh and PowerShell: the values are an https URL and a
// key of [A-Za-z0-9_-], checked above, so they never contain one.
const shq = (v) => `'${String(v).replace(/'/g, '')}'`;

function linuxScript(base, secret) {
  const api = `${base}/api/v1/install/${secret}`;
  return `#!/bin/sh
# Installs and enrolls the PRISM agent on this Linux computer. Run as root:
#   curl -fsSL ${api}/linux.sh | sudo sh
set -eu
URL=${shq(base)}
KEY=${shq(secret)}
API=${shq(api)}

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (sudo sh)." >&2; exit 1; fi
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "The PRISM agent isn't built for $(uname -m)." >&2; exit 1 ;;
esac
if command -v apt-get >/dev/null 2>&1; then FORMAT=deb; EXT=deb
elif command -v dnf >/dev/null 2>&1; then FORMAT=rpm; EXT=rpm
elif command -v pacman >/dev/null 2>&1; then FORMAT=pacman; EXT=pkg.tar.zst
else echo "No apt, dnf or pacman here: install the PRISM agent by hand." >&2; exit 1
fi

if ! command -v prism-agent >/dev/null 2>&1; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  FILE="$TMP/prism-agent.$EXT"
  echo "Downloading the PRISM agent ($FORMAT, $ARCH)..."
  curl -fsSL --proto '=https' -o "$FILE" "$API/linux/$FORMAT/$ARCH"
  case "$FORMAT" in
    deb) DEBIAN_FRONTEND=noninteractive apt-get install -y "$FILE" ;;
    rpm) dnf install -y "$FILE" ;;
    pacman) pacman -U --noconfirm "$FILE" ;;
  esac
fi
# Already enrolled with this PRISM: says so and changes nothing.
prism-agent enroll --url "$URL" --key "$KEY"
`;
}

function macScript(base, secret) {
  const api = `${base}/api/v1/install/${secret}`;
  return `#!/bin/sh
# Installs and enrolls the PRISM agent on this Mac. Run as root:
#   curl -fsSL ${api}/mac.sh | sudo sh
set -eu
URL=${shq(base)}
KEY=${shq(secret)}
API=${shq(api)}
AGENT='/Library/Application Support/PRISM/bin/prism-agent'

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (sudo sh)." >&2; exit 1; fi
if [ ! -x "$AGENT" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  echo "Downloading the PRISM agent..."
  curl -fsSL --proto '=https' -o "$TMP/prism-agent.pkg" "$API/mac"
  installer -pkg "$TMP/prism-agent.pkg" -target /
fi
# Already enrolled with this PRISM: says so and changes nothing.
"$AGENT" enroll --url "$URL" --key "$KEY"
`;
}

// One PowerShell script for PDQ Deploy, a Group Policy startup script,
// Intune and any RMM: runs as SYSTEM (or an administrator), installs
// silently, exits with msiexec's code (0, or 3010 for "restart needed").
function windowsScript(base, secret) {
  const api = `${base}/api/v1/install/${secret}`;
  return `# Installs and enrolls the PRISM agent on this Windows computer.
# Run as SYSTEM or an administrator (PDQ Deploy, Group Policy, Intune, an RMM).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the progress bar slows Windows PowerShell's downloads badly
$Url = ${shq(base)}
$Key = ${shq(secret)}
$Api = ${shq(api)}
# 64-bit Program Files even from a 32-bit PowerShell (some tools run one).
$ProgramFiles64 = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$Agent = Join-Path $ProgramFiles64 'PRISM\\Agent\\prism-agent.exe'

if ((Get-Service -Name PRISMAgent -ErrorAction SilentlyContinue) -and (Test-Path $Agent)) {
  # Installed already: enroll if it isn't (otherwise this changes nothing).
  & $Agent enroll --url $Url --key $Key
  exit $LASTEXITCODE
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Msi = Join-Path $env:TEMP ('prism-agent-' + [guid]::NewGuid().ToString('N') + '.msi')
try {
  Invoke-WebRequest -Uri "$Api/windows" -OutFile $Msi -UseBasicParsing
  $p = Start-Process -FilePath msiexec.exe -Wait -PassThru -ArgumentList @('/i', ('"' + $Msi + '"'), '/qn', '/norestart', "PRISM_URL=$Url", "ENROLL_KEY=$Key")
  exit $p.ExitCode
} finally {
  Remove-Item -LiteralPath $Msi -Force -ErrorAction SilentlyContinue
}
`;
}

module.exports = {
  baseUrl, setupFileName, usableKey, linuxScript, macScript, windowsScript, KEY_SHAPE, KEY_PREFIX,
};
