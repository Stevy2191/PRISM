import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Spinner from '../Spinner';
import Notice from '../ui/Notice';
import Pill from '../ui/Pill';
import PillRow from '../ui/PillRow';
import StatusChip from '../ui/StatusChip';
import { AgentStatus, shortDate, PLATFORM } from '../agent/agentFormat';
import ScanNow from '../agent/ScanNow';
import { scanState } from '../agent/scanState';
import { agentNeedsHttps, isTestCertificate } from '../agent/agentAddress';

// Mockup Main (agent-8): a company's Devices tab (8a). Installing the agent
// (enrollment keys, the install command, the installer download, for staff
// with devices.manage) and the company's computers.
const MUTED = { color: 'var(--color-text-muted)' };
const BORDER = { borderColor: 'var(--color-border)' };

function Card({ title, hint, action, children }) {
  return (
    <section aria-label={title} className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5" style={BORDER}>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-navy-900">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px]" style={MUTED}>{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const mb = (bytes) => `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

// Expiry choices for a new install key (8d): a link sent around for one-offs
// is best short-lived; a key behind Group Policy or PDQ can be Never.
const EXPIRY = [['', 'Never'], ['14', 'In 14 days'], ['30', 'In 30 days'], ['date', 'On a date…']];

function NewKey({ company, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [date, setDate] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    let expiresAt = null;
    if (expiry === 'date' && date) expiresAt = new Date(`${date}T23:59:59`).toISOString();
    else if (expiry && expiry !== 'date') expiresAt = new Date(Date.now() + Number(expiry) * 86400000).toISOString();
    try {
      const { data } = await api.post(`/companies/${company.id}/agent-keys`, {
        name: name.trim(), expiresAt, maxUses: limit ? Number(limit) : null,
      });
      onCreated(data.key, data.secret);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={create} aria-label="New install key" className="space-y-3 border-b px-5 py-4" style={BORDER}>
      {error && <Notice tone="bad">{error}</Notice>}
      <div>
        <label className="label" htmlFor="agent-key-name">Name</label>
        <input id="agent-key-name" className="input h-9 text-sm" maxLength={100} required placeholder="Office rollout, or One-off installs" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="agent-key-expiry">Expires</label>
          <select id="agent-key-expiry" className="input h-9 text-sm" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {expiry === 'date' && <input aria-label="Expiry date" type="date" className="input mt-2 h-9 text-sm" required value={date} onChange={(e) => setDate(e.target.value)} />}
        </div>
        <div>
          <label className="label" htmlFor="agent-key-limit">Computers it can add (optional)</label>
          <input id="agent-key-limit" type="number" min="1" max="100000" className="input h-9 text-sm" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary h-9 px-3 text-sm" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create key'}</button>
      </div>
    </form>
  );
}

const used = (k) => (k.maxUses ? `${k.enrolledCount} of ${k.maxUses}` : `${k.enrolledCount} computer${k.enrolledCount === 1 ? '' : 's'}`);

function keyState(k) {
  if (k.revokedAt) return <StatusChip tone="neutral">Revoked</StatusChip>;
  if (k.usedUp) return <StatusChip tone="neutral">Used up</StatusChip>;
  if (!k.usable) return <StatusChip tone="neutral">Expired</StatusChip>;
  return k.expiresAt ? `Until ${shortDate(k.expiresAt)}` : 'No expiry';
}

function Keys({
  company, keys, selectedId, onSelect, onChanged, onCreated, onRotated,
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const revoke = async (k) => {
    if (!window.confirm(`Revoke “${k.name}”? Computers already enrolled with it keep working; its install link and new installs with it stop working.`)) return;
    setError('');
    try { await api.post(`/companies/${company.id}/agent-keys/${k.id}/revoke`); onChanged(); } catch (err) { setError(errMessage(err)); }
  };
  const rotate = async (k) => {
    if (!window.confirm(`Rotate “${k.name}”? It gets a new key: the old key, its install link and push scripts stop working. Computers already enrolled keep working.`)) return;
    setError('');
    try {
      const { data } = await api.post(`/companies/${company.id}/agent-keys/${k.id}/rotate`);
      onRotated(data.key, data.secret);
    } catch (err) { setError(errMessage(err)); }
  };
  return (
    <Card
      title="Install keys"
      hint="A key adds computers to this company. One key can install as many computers as you like; copy it again any time."
      action={!adding && company.status === 'active' && <button type="button" className="btn-primary h-9 px-3 text-sm" onClick={() => setAdding(true)}>New install key</button>}
    >
      {adding && <NewKey company={company} onCancel={() => setAdding(false)} onCreated={(k, secret) => { setAdding(false); onCreated(k, secret); }} />}
      {error && <div className="px-5 pt-3"><Notice tone="bad">{error}</Notice></div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="table-th">Install key</th><th className="table-th">Used</th><th className="table-th">Status</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t" style={{ ...BORDER, ...(k.id === selectedId ? { backgroundColor: 'var(--color-accent-soft)' } : {}) }}>
                <td className="table-td">
                  <span className="font-semibold text-navy-900">{k.name}</span>
                  <span className="block text-[12.5px]" style={MUTED}>
                    {k.revokedAt ? `Revoked ${shortDate(k.revokedAt)}` : `Created ${shortDate(k.createdAt)}${k.createdBy ? ` by ${k.createdBy.displayName}` : ''}`}
                    {k.lastUsedAt && !k.revokedAt ? ` · last used ${shortDate(k.lastUsedAt)}` : ''}
                  </span>
                  {/* Under the name, so the name and dates keep the column's width. */}
                  {!k.revokedAt && (
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      {k.usable && <button type="button" className="btn-secondary h-8 px-3 text-sm" aria-pressed={k.id === selectedId} onClick={() => onSelect(k)} aria-label={`Install with ${k.name}`}>Install</button>}
                      <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => rotate(k)} aria-label={`Rotate ${k.name}`}>Rotate</button>
                      <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => revoke(k)} aria-label={`Revoke ${k.name}`}>Revoke</button>
                    </span>
                  )}
                </td>
                <td className="table-td whitespace-nowrap align-top">{used(k)}</td>
                <td className="table-td whitespace-nowrap align-top">{keyState(k)}</td>
              </tr>
            ))}
            {!keys.length && <tr><td className="table-td" colSpan={3}>No install keys yet. Create one to install the agent.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// setup.sh's test certificate (HTTPS for testing): each computer trusts the
// test authority once, before installing. Shown only when PRISM serves one.
const TRUST_STEPS = {
  windows: { label: 'As an administrator, in Command Prompt or PowerShell', command: 'certutil -addstore -f Root prism-test-ca.crt' },
  macos: { label: 'In Terminal', command: 'sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/prism-test-ca.crt' },
};

function useTestCertificate() {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/prism-test-ca.crt', { method: 'HEAD', cache: 'no-store' })
      .then((r) => { if (live) setPresent(isTestCertificate(r.status, r.headers.get('content-type'))); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return present;
}

function AddressNotice({ testCertificate, platform }) {
  const { protocol, hostname } = window.location;
  if (agentNeedsHttps(protocol, hostname)) {
    return (
      <Notice tone="warn">
        The agent connects only over HTTPS, and this command has the address you&apos;re using now
        ({window.location.origin}). Open PRISM at its https:// address and copy the command from there.
        For testing without a certificate, run <code>setup.sh</code> again and answer yes to HTTPS with a test certificate.
      </Notice>
    );
  }
  if (!testCertificate || !TRUST_STEPS[platform]) return null;
  const step = TRUST_STEPS[platform];
  return (
    <section aria-label="Test certificate" className="space-y-2 rounded-lg border px-3.5 py-3" style={BORDER}>
      <p className="m-0 text-sm text-navy-900">
        <b>This PRISM uses a test certificate.</b> First, on each computer, trust PRISM&apos;s test certificate authority (once):
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn-secondary inline-flex h-8 items-center px-3 text-sm" href="/prism-test-ca.crt" download>Download test certificate</a>
        <span className="text-[12.5px]" style={MUTED}>{step.label}, from the folder it&apos;s in:</span>
      </div>
      <pre aria-label="Trust command" className="m-0 whitespace-pre-wrap break-all rounded-lg border p-2.5 font-mono text-[12.5px] text-navy-900" style={{ ...BORDER, backgroundColor: 'var(--color-hover)' }}>{step.command}</pre>
      <p className="m-0 text-[12.5px]" style={MUTED}>For testing only. With a real certificate (e.g. a reverse proxy with Let&apos;s Encrypt) this step goes away.</p>
    </section>
  );
}

// The Linux packages, one per distribution family (8c).
const DISTROS = [
  { format: 'deb', label: 'Ubuntu, Debian', install: (f) => `sudo apt install ./${f}` },
  { format: 'rpm', label: 'Fedora, RHEL', install: (f) => `sudo dnf install ./${f}` },
  { format: 'pacman', label: 'Arch', install: (f) => `sudo pacman -U ${f}` },
];

function LinuxInstall({
  has, commandBox, copyButton, keyNote,
}) {
  const [format, setFormat] = useState('deb');
  const distro = DISTROS.find((d) => d.format === format);
  const amd = has('linux', 'amd64', format);
  const arm = has('linux', 'arm64', format);
  return (
    <>
      <div role="radiogroup" aria-label="Distribution" className="flex flex-wrap gap-2">
        {DISTROS.map((d) => (
          <label key={d.format} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-navy-900">
            <input type="radio" name="linux-distro" value={d.format} checked={format === d.format} onChange={() => setFormat(d.format)} />
            {d.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {amd ? (
          <a className="btn-primary inline-flex h-9 items-center px-3 text-sm" href={`/api/v1/devices/packages/linux/amd64?format=${format}`} download>
            Download for {distro.label} (x86_64, {mb(amd.size)})
          </a>
        ) : <span className="text-sm" style={MUTED}>No {distro.label} package in this PRISM build yet.</span>}
        {arm && <a className="text-sm text-prism hover:underline" href={`/api/v1/devices/packages/linux/arm64?format=${format}`} download>ARM version</a>}
      </div>
      <ol aria-label="Installing on Linux" className="m-0 list-decimal space-y-1.5 pl-5 text-sm text-navy-900">
        <li>
          Install the package from the folder it&apos;s in:{' '}
          <code aria-label="Install package command" className="font-mono text-[12.5px]">{distro.install((amd || arm || { file: '<package>' }).file)}</code>
        </li>
        <li>Enroll the computer with this company&apos;s key:</li>
      </ol>
      {commandBox}
      <div className="flex flex-wrap items-center gap-2">{copyButton}</div>
      <p className="m-0 text-[12.5px]" style={MUTED}>
        <b>Submit a ticket</b> is in the applications list everywhere. On GNOME the tray icon needs the AppIndicator
        extension (Ubuntu has it). Servers can install with <code className="font-mono">--no-install-recommends</code> (apt) to skip the tray&apos;s
        libraries. {keyNote}
      </p>
    </>
  );
}

// How to push the agent with the tools clients use (8d). All of them run
// the same PowerShell script, as SYSTEM.
const PUSH_TOOLS = [
  ['PDQ Deploy', 'New package → PowerShell step: paste the script (or the one-line command). Run as Deploy User with “Run as Local System”, then deploy to a collection.'],
  ['Group Policy', 'Computer Configuration → Policies → Windows Settings → Scripts → Startup → PowerShell Scripts: add the script (saved as a .ps1 in the GPO’s folder). Computers install it at their next restart.'],
  ['Intune', 'Devices → Scripts and remediations → Platform scripts → Add (Windows): upload the .ps1; run with the logged-on credentials: No; run in 64-bit PowerShell: Yes.'],
  ['An RMM', 'NinjaOne, Datto, N-able, Atera and the like: a PowerShell script run as SYSTEM, against the computers you choose.'],
];

function CodeBox({ label, children }) {
  return (
    <pre aria-label={label} className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-[12.5px] text-navy-900" style={{ ...BORDER, backgroundColor: 'var(--color-hover)' }}>{children}</pre>
  );
}

function InstallKey({
  company, selected, packages, onRevealed, onRotated,
}) {
  const testCertificate = useTestCertificate();
  const [platform, setPlatform] = useState('link');
  const [copied, setCopied] = useState(false);
  const [script, setScript] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = selected && selected.key;
  const real = selected && selected.secret;
  const secret = real || 'pk_enr_…';
  const origin = window.location.origin;
  const api1 = `${origin}/api/v1/install/${secret}`;
  const link = `${origin}/install/${secret}`;
  useEffect(() => {
    setScript('');
    if (!real) return;
    api.get(`/install/${real}/windows.ps1`, { responseType: 'text', transformResponse: (d) => d })
      .then(({ data }) => setScript(data)).catch(() => setScript(''));
  }, [real]);
  const has = (plat, arch, format) => packages.find((p) => p.platform === plat && (p.arches || [p.arch]).includes(arch) && (!format || p.format === format));
  const win = has('windows', 'amd64');
  const winArm = has('windows', 'arm64');
  const winArmOwn = winArm && (!win || winArm.file !== win.file) ? winArm : null;
  const mac = has('macos', 'arm64') || has('macos', 'amd64');
  const command = platform === 'macos' || platform === 'linux'
    ? `sudo prism-agent enroll --url ${origin} --key ${secret}`
    : `msiexec /i ${win ? win.file : 'prism-agent.msi'} /qn PRISM_URL=${origin} ENROLL_KEY=${secret}`;
  const winEnroll = `& "C:\\Program Files\\PRISM\\Agent\\prism-agent.exe" enroll --url ${origin} --key ${secret}`;
  const oneLine = `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm '${api1}/windows.ps1')"`;
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  const copyBtn = (text, label = 'Copy') => (
    <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={() => copyText(text)} disabled={!real}>{copied === text ? 'Copied' : label}</button>
  );
  const reveal = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/companies/${company.id}/agent-keys/${key.id}/reveal`);
      onRevealed(key, data.secret);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  const rotate = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/companies/${company.id}/agent-keys/${key.id}/rotate`);
      onRotated(data.key, data.secret);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  if (!key) {
    return (
      <Card title="Install the agent" hint="Create an install key first">
        <p className="m-0 px-5 py-4 text-sm" style={MUTED}>Create an install key, then come here for its install link, push scripts and install commands.</p>
      </Card>
    );
  }
  const commandBox = <CodeBox label="Command">{command}</CodeBox>;
  const copyButton = copyBtn(command);
  const keyNote = '';
  const TABS = [['link', 'Install link'], ['push', 'Push'], ['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']];
  return (
    <Card title="Install the agent" hint={`With the key “${key.name}”`}>
      <div className="space-y-3 px-5 py-4">
        {error && <Notice tone="bad">{error}</Notice>}
        {!real && (key.copyable ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5" style={BORDER}>
            <span className="text-sm text-navy-900">The key is hidden. Show it to fill in and copy the link, scripts and commands.</span>
            <button type="button" className="btn-primary h-8 px-3 text-sm" onClick={reveal} disabled={busy}>{busy ? 'Showing…' : 'Show key'}</button>
          </div>
        ) : (
          <Notice tone="info">
            This key was made before keys could be copied again, so PRISM can&apos;t show it. <b>Rotate</b> it to get one you can copy
            (the old key stops working; computers already enrolled keep working).
            {' '}<button type="button" className="btn-secondary ml-1 h-8 px-3 text-sm" onClick={rotate} disabled={busy}>Rotate</button>
          </Notice>
        ))}
        <div role="tablist" aria-label="How to install" className="inline-flex flex-wrap overflow-hidden rounded-md border" style={BORDER}>
          {TABS.map(([p, label]) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={platform === p}
              onClick={() => setPlatform(p)}
              className={`h-8 px-3 text-sm ${platform === p ? 'font-semibold' : 'font-medium text-navy-500 hover:bg-[var(--color-hover)]'}`}
              style={platform === p ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {platform !== 'linux' && <AddressNotice testCertificate={testCertificate} platform={platform === 'macos' ? 'macos' : 'windows'} />}
        {platform === 'link' && (
          <>
            <p className="m-0 text-sm text-navy-900">
              Send this link, or open it on the computer. It offers the right download for Windows, Mac or Linux; the
              installer adds the computer to {company.name} by itself.
            </p>
            <CodeBox label="Install link">{link}</CodeBox>
            <div className="flex flex-wrap items-center gap-2">
              {copyBtn(link, 'Copy link')}
              {real && <a className="text-sm text-prism hover:underline" href={link} target="_blank" rel="noreferrer">Open it</a>}
            </div>
            <p className="m-0 text-[12.5px]" style={MUTED}>
              Installing needs an administrator: on a standard user&apos;s computer, Windows or macOS asks for an administrator&apos;s
              name and password (type yours there, or over remote support). For many computers at once, use <b>Push</b>.
              Anyone with the link can add a computer to this company until the key expires, is used up, rotated or revoked.
            </p>
          </>
        )}
        {platform === 'push' && (
          <>
            <p className="m-0 text-sm text-navy-900">
              <b>Windows:</b> one PowerShell script for PDQ Deploy, Group Policy, Intune or an RMM. It runs as SYSTEM, installs
              silently and enrolls; computers that already have the agent are left as they are. Users see nothing.
            </p>
            <CodeBox label="PowerShell script">{real ? (script || 'Loading…') : '(Show the key to see the script.)'}</CodeBox>
            <div className="flex flex-wrap items-center gap-2">
              {copyBtn(script || '', 'Copy script')}
              {real && <a className="btn-secondary inline-flex h-9 items-center px-3 text-sm" href={`/api/v1/install/${real}/windows.ps1`} download="Install-PrismAgent.ps1">Download .ps1</a>}
            </div>
            <p className="m-0 text-[12.5px]" style={MUTED}>Or as one command (where a tool takes a command line rather than a script):</p>
            <CodeBox label="One-line command">{oneLine}</CodeBox>
            <div className="flex flex-wrap items-center gap-2">{copyBtn(oneLine)}</div>
            <ul aria-label="Push tools" className="m-0 list-disc space-y-1 pl-5 text-[13px] text-navy-900">
              {PUSH_TOOLS.map(([tool, how]) => <li key={tool}><b>{tool}:</b> {how}</li>)}
            </ul>
            <p className="m-0 pt-1 text-sm text-navy-900">
              <b>Mac and Linux:</b> a shell command, run as root by an RMM, a Mac MDM (Jamf, Kandji, Mosyle) or over SSH:
            </p>
            <CodeBox label="Mac command">{`curl -fsSL ${api1}/mac.sh | sudo sh`}</CodeBox>
            <div className="flex flex-wrap items-center gap-2">{copyBtn(`curl -fsSL ${api1}/mac.sh | sudo sh`)}</div>
            <CodeBox label="Linux command">{`curl -fsSL ${api1}/linux.sh | sudo sh`}</CodeBox>
            <div className="flex flex-wrap items-center gap-2">{copyBtn(`curl -fsSL ${api1}/linux.sh | sudo sh`)}</div>
          </>
        )}
        {platform === 'windows' && (
          <>
            {commandBox}
            <div className="flex flex-wrap items-center gap-2">
              {copyButton}
              {win ? (
                <a className="btn-primary inline-flex h-9 items-center px-3 text-sm" href="/api/v1/devices/packages/windows/amd64" download>
                  Download for Windows (MSI, {mb(win.size)})
                </a>
              ) : <span className="text-sm" style={MUTED}>No Windows installer in this PRISM build yet.</span>}
              {winArmOwn && <a className="text-sm text-prism hover:underline" href="/api/v1/devices/packages/windows/arm64" download>ARM version</a>}
            </div>
            <p className="m-0 text-[12.5px]" style={MUTED}>Run it as administrator in the MSI&apos;s folder. For a one-off, the <b>Install link</b> is simpler.</p>
            <details className="text-sm text-navy-900">
              <summary className="cursor-pointer text-[13px] font-medium">Installed this MSI by double-clicking it?</summary>
              <div className="mt-2 space-y-2">
                <p className="m-0 text-[12.5px]" style={MUTED}>
                  The MSI downloaded here doesn&apos;t carry the key (the install link&apos;s does), so the computer
                  doesn&apos;t appear until it&apos;s enrolled. Enroll it from PowerShell run as administrator:
                </p>
                <CodeBox label="Enroll command">{winEnroll}</CodeBox>
                <div className="flex flex-wrap items-center gap-2">{copyBtn(winEnroll)}</div>
              </div>
            </details>
          </>
        )}
        {platform === 'macos' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {mac ? (
                <a className="btn-primary inline-flex h-9 items-center px-3 text-sm" href="/api/v1/devices/packages/macos/arm64" download>
                  Download for Mac (.pkg, {mb(mac.size)})
                </a>
              ) : <span className="text-sm" style={MUTED}>No Mac package in this PRISM build yet.</span>}
              {mac && <span className="text-[12.5px]" style={MUTED}>Apple silicon and Intel · macOS 13 or later</span>}
            </div>
            <ol aria-label="Installing on a Mac" className="m-0 list-decimal space-y-1.5 pl-5 text-sm text-navy-900">
              <li>
                Open the package. The first time on each Mac, macOS stops it: go to
                {' '}<b>System Settings → Privacy &amp; Security</b> and click <b>Open Anyway</b>, then open it again.
              </li>
              <li>Install it (it asks for an administrator&apos;s password).</li>
              <li>In Terminal, enroll the Mac with this company&apos;s key (not needed with the install link&apos;s package):</li>
            </ol>
            {commandBox}
            <div className="flex flex-wrap items-center gap-2">{copyButton}</div>
            <p className="m-0 text-[12.5px]" style={MUTED}>Updates install themselves without asking.</p>
          </>
        )}
        {platform === 'linux' && <LinuxInstall has={has} commandBox={commandBox} copyButton={copyButton} keyNote={keyNote} />}
      </div>
    </Card>
  );
}

function Devices({ company, canManage, canScan }) {
  const [filter, setFilter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get(`/companies/${company.id}/devices`, { params: filter ? { status: filter } : {} })
      .then(({ data: d }) => setData(d)).catch((err) => setError(errMessage(err)));
  }, [company.id, filter]);
  useEffect(load, [load]);
  // While any computer here has a Scan now waiting, look again every 20
  // seconds so its fresh details and status show up.
  const waiting = !!data && data.devices.some((d) => scanState(d) === 'waiting');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(load, 20 * 1000);
    return () => clearInterval(t);
  }, [waiting, load]);
  const revoke = async (d) => {
    if (!window.confirm(`Revoke ${d.hostname}? PRISM will refuse it from now on. Its Asset and history stay; installing the agent again with a new key brings it back.`)) return;
    try { await api.post(`/devices/${d.id}/revoke`); load(); } catch (err) { setError(errMessage(err)); }
  };
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  const c = data.counts;
  return (
    <Card
      title="Devices"
      hint={`${c.all} computer${c.all === 1 ? '' : 's'} · ${c.online} online${c.stale ? ` · ${c.stale} not seen for 14 days` : ''}`}
      action={(
        <PillRow label="Device status" className="!mx-0 !px-0">
          {[['', 'All', c.all], ['offline', 'Offline', c.offline], ['stale', 'Stale', c.stale], ...(c.revoked ? [['revoked', 'Revoked', c.revoked]] : [])].map(([k, label, n]) => (
            <Pill key={k || 'all'} on={filter === k} onClick={() => setFilter(k)}>{label} <span className="num ml-1 opacity-70">{n}</span></Pill>
          ))}
        </PillRow>
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="table-th">Computer</th><th className="table-th">Operating system</th><th className="table-th">Usually used by</th>
              <th className="table-th">Status</th><th className="table-th">Agent</th><th className="table-th"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.devices.map((d) => (
              <tr key={d.id} className="border-t" style={BORDER}>
                <td className="table-td">
                  <span className="font-semibold text-navy-900">{d.hostname}</span>
                  {d.asset && (
                    <Link to={`/assets/${d.asset.id}`} className="block text-[12.5px] hover:underline" style={MUTED}>
                      Asset {d.asset.assetTag}{(d.asset.make || d.asset.model) ? ` · ${[d.asset.make, d.asset.model].filter(Boolean).join(' ')}` : ''}
                    </Link>
                  )}
                </td>
                <td className="table-td">{d.os || PLATFORM[d.platform]}</td>
                <td className="table-td">
                  {d.asset && d.asset.usualUser
                    ? <Link to={`/contacts/${d.asset.usualUser.id}`} className="text-prism hover:underline">{d.asset.usualUser.displayName}</Link>
                    : d.signedInAccount
                      ? <span><span className="font-mono text-[12.5px]">{d.signedInAccount}</span> <span style={MUTED}>(no contact)</span></span>
                      : <span style={MUTED}>—</span>}
                </td>
                <td className="table-td whitespace-nowrap"><AgentStatus device={d} /></td>
                <td className="table-td whitespace-nowrap">
                  <span className="font-mono text-[12.5px]">{d.agentVersion}</span>
                  {d.updatePending && <span className="block"><StatusChip tone="waiting">Update pending</StatusChip></span>}
                </td>
                <td className="table-td whitespace-nowrap text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    {canScan && <ScanNow device={d} onRequested={load} />}
                    {canManage && d.status !== 'revoked' && <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => revoke(d)}>Revoke</button>}
                  </span>
                </td>
              </tr>
            ))}
            {!data.devices.length && <tr><td className="table-td" colSpan={6}>{filter ? 'None.' : 'No computers yet. Install the agent to add them.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CompanyDevices({ company }) {
  const canManage = usePermission('devices.manage');
  const canEditAssets = usePermission('assets.edit');
  const [keys, setKeys] = useState(null);
  const [packages, setPackages] = useState([]);
  // The key the install card shows, and its secret once shown (created,
  // rotated or revealed in this visit; never kept anywhere else).
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const loadKeys = useCallback(() => {
    if (!canManage) return;
    api.get(`/companies/${company.id}/agent-keys`).then(({ data }) => {
      setKeys(data.keys);
      setSelected((cur) => {
        const still = cur && data.keys.find((k) => k.id === cur.key.id && k.usable);
        if (still) return { key: still, secret: cur.secret };
        const first = data.keys.find((k) => k.usable);
        return first ? { key: first, secret: null } : null;
      });
    }).catch((err) => setError(errMessage(err)));
    api.get('/devices/packages').then(({ data }) => setPackages(data.packages)).catch(() => setPackages([]));
  }, [company.id, canManage]);
  useEffect(loadKeys, [loadKeys]);
  const show = (key, secret) => { setSelected({ key, secret }); loadKeys(); };
  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {canManage && (keys ? (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Keys
            company={company}
            keys={keys}
            selectedId={selected && selected.key.id}
            onSelect={(k) => setSelected((cur) => (cur && cur.key.id === k.id ? cur : { key: k, secret: null }))}
            onChanged={loadKeys}
            onCreated={show}
            onRotated={show}
          />
          <InstallKey company={company} selected={selected} packages={packages} onRevealed={show} onRotated={show} />
        </div>
      ) : <Spinner />)}
      <Devices company={company} canManage={canManage} canScan={canManage || canEditAssets} />
    </div>
  );
}
