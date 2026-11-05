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
// (enrolment keys, the install command, the installer download, for staff
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

function NewKey({ company, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/companies/${company.id}/agent-keys`, {
        name: name.trim(), expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      onCreated(data.key, data.secret);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={create} aria-label="New enrolment key" className="space-y-3 border-b px-5 py-4" style={BORDER}>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <label className="label" htmlFor="agent-key-name">Name</label>
          <input id="agent-key-name" className="input h-9 text-sm" maxLength={100} required placeholder="Clinic rollout" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="agent-key-expiry">Expires (optional)</label>
          <input id="agent-key-expiry" type="date" className="input h-9 text-sm" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary h-9 px-3 text-sm" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create key'}</button>
      </div>
    </form>
  );
}

function Keys({ company, keys, onChanged, onCreated }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const revoke = async (k) => {
    if (!window.confirm(`Revoke “${k.name}”? Computers already enrolled with it keep working; new installs with it are refused.`)) return;
    setError('');
    try { await api.post(`/companies/${company.id}/agent-keys/${k.id}/revoke`); onChanged(); } catch (err) { setError(errMessage(err)); }
  };
  return (
    <Card
      title="Install the agent"
      hint="Every computer it's installed on becomes an Asset of this company and keeps its details current."
      action={!adding && company.status === 'active' && <button type="button" className="btn-primary h-9 px-3 text-sm" onClick={() => setAdding(true)}>New enrolment key</button>}
    >
      {adding && <NewKey company={company} onCancel={() => setAdding(false)} onCreated={(k, secret) => { setAdding(false); onCreated(k, secret); }} />}
      {error && <div className="px-5 pt-3"><Notice tone="bad">{error}</Notice></div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="table-th">Enrolment key</th><th className="table-th">Used</th><th className="table-th">Expires</th><th className="table-th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t" style={BORDER}>
                <td className="table-td">
                  <span className="font-semibold text-navy-900">{k.name}</span>
                  <span className="block text-[12.5px]" style={MUTED}>
                    {k.revokedAt ? `Revoked ${shortDate(k.revokedAt)}` : `Created ${shortDate(k.createdAt)}${k.createdBy ? ` by ${k.createdBy.displayName}` : ''}`}
                  </span>
                </td>
                <td className="table-td whitespace-nowrap">{k.enrolledCount} computer{k.enrolledCount === 1 ? '' : 's'}</td>
                <td className="table-td whitespace-nowrap">{k.revokedAt ? <StatusChip tone="neutral">Revoked</StatusChip> : (k.expiresAt ? shortDate(k.expiresAt) : 'Never')}</td>
                <td className="table-td text-right">
                  {!k.revokedAt && <button type="button" className="btn-secondary h-8 px-3 text-sm" onClick={() => revoke(k)}>Revoke</button>}
                </td>
              </tr>
            ))}
            {!keys.length && <tr><td className="table-td" colSpan={4}>No enrolment keys yet. Create one to install the agent.</td></tr>}
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

function InstallCommand({ fresh, keys, packages }) {
  const testCertificate = useTestCertificate();
  const [platform, setPlatform] = useState('windows');
  const [copied, setCopied] = useState(false);
  const usable = keys.filter((k) => k.usable);
  const keyName = fresh ? fresh.key.name : (usable[0] && usable[0].name);
  const secret = fresh ? fresh.secret : 'pk_enr_…';
  const has = (plat, arch) => packages.find((p) => p.platform === plat && (p.arches || [p.arch]).includes(arch));
  const win = has('windows', 'amd64');
  const winArm = has('windows', 'arm64');
  const winArmOwn = winArm && (!win || winArm.file !== win.file) ? winArm : null;
  const mac = has('macos', 'arm64') || has('macos', 'amd64');
  const origin = window.location.origin;
  // Windows: one silent command (GPO, Intune). Mac: the package can't take
  // settings, so enrolment is a command after installing (spec, decision 7).
  const command = platform === 'macos'
    ? `sudo prism-agent enroll --url ${origin} --key ${secret}`
    : `msiexec /i ${win ? win.file : 'prism-agent.msi'} /qn PRISM_URL=${origin} ENROLL_KEY=${secret}`;
  // An MSI installed by double-clicking isn't enrolled: enrol it afterwards.
  const winEnroll = `& "C:\\Program Files\\PRISM\\Agent\\prism-agent.exe" enroll --url ${origin} --key ${secret}`;
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  const copy = () => copyText(command);
  const commandBox = (
    <>
      {fresh && <Notice tone="info">This is the only time the full key is shown. Copy the command now; PRISM keeps only a fingerprint of the key.</Notice>}
      <pre aria-label="Command" className="m-0 whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-[12.5px] text-navy-900" style={{ ...BORDER, backgroundColor: 'var(--color-hover)' }}>{command}</pre>
    </>
  );
  const copyButton = <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={copy} disabled={!fresh}>{copied === command ? 'Copied' : 'Copy'}</button>;
  const keyNote = fresh ? '' : 'The key is shown in full once, when it\'s created: create a new one to copy a complete command.';
  return (
    <Card title="Install command" hint={keyName ? `With the key “${keyName}”` : 'Create an enrolment key first'}>
      <div className="space-y-3 px-5 py-4">
        <div role="tablist" aria-label="Platform" className="inline-flex overflow-hidden rounded-md border" style={BORDER}>
          {['windows', 'macos', 'linux'].map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={platform === p}
              onClick={() => setPlatform(p)}
              className={`h-8 px-3 text-sm ${platform === p ? 'font-semibold' : 'font-medium text-navy-500 hover:bg-[var(--color-hover)]'}`}
              style={platform === p ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
            >
              {PLATFORM[p]}
            </button>
          ))}
        </div>
        {platform !== 'linux' && <AddressNotice testCertificate={testCertificate} platform={platform} />}
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
            <p className="m-0 text-[12.5px]" style={MUTED}>Works from Group Policy, Intune or by hand. {keyNote}</p>
            <details className="text-sm text-navy-900">
              <summary className="cursor-pointer text-[13px] font-medium">Installed it by double-clicking the MSI?</summary>
              <div className="mt-2 space-y-2">
                <p className="m-0 text-[12.5px]" style={MUTED}>
                  Opening the MSI installs the agent but can&apos;t enrol it (the key goes on the command line), so the computer
                  doesn&apos;t appear here. Enrol it from PowerShell run as administrator:
                </p>
                <pre aria-label="Enrol command" className="m-0 whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-[12.5px] text-navy-900" style={{ ...BORDER, backgroundColor: 'var(--color-hover)' }}>{winEnroll}</pre>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={() => copyText(winEnroll)} disabled={!fresh}>{copied === winEnroll ? 'Copied' : 'Copy'}</button>
                </div>
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
              <li>In Terminal, enrol the Mac with this company&apos;s key:</li>
            </ol>
            {commandBox}
            <div className="flex flex-wrap items-center gap-2">{copyButton}</div>
            <p className="m-0 text-[12.5px]" style={MUTED}>
              Macs are installed by hand for now (no Apple Developer ID); updates install themselves without asking. {keyNote}
            </p>
          </>
        )}
        {platform === 'linux' && (
          <p className="m-0 text-sm" style={MUTED}>The Linux agent (Ubuntu, Fedora and Arch) is coming in 8c.</p>
        )}
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
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState('');
  const loadKeys = useCallback(() => {
    if (!canManage) return;
    api.get(`/companies/${company.id}/agent-keys`).then(({ data }) => setKeys(data.keys)).catch((err) => setError(errMessage(err)));
    api.get('/devices/packages').then(({ data }) => setPackages(data.packages)).catch(() => setPackages([]));
  }, [company.id, canManage]);
  useEffect(loadKeys, [loadKeys]);
  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {canManage && (keys ? (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Keys company={company} keys={keys} onChanged={loadKeys} onCreated={(key, secret) => { setFresh({ key, secret }); loadKeys(); }} />
          <InstallCommand fresh={fresh} keys={keys} packages={packages} />
        </div>
      ) : <Spinner />)}
      <Devices company={company} canManage={canManage} canScan={canManage || canEditAssets} />
    </div>
  );
}
