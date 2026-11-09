import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Notice from '../ui/Notice';
import StatusChip from '../ui/StatusChip';
import {
  ago, dateTime, gb, shortDate, PLATFORM,
} from '../agent/agentFormat';

// Mockup AssetDevice: the computer as the PRISM agent reports it (8a). The
// main hardware information only; installed software has its own tab
// (owner, 2026-11-03).
const MUTED = { color: 'var(--color-text-muted)' };
const BORDER = { borderColor: 'var(--color-border)' };

function Card({ title, hint, children }) {
  return (
    <section aria-label={title} className="card overflow-hidden">
      <div className="border-b px-5 py-3.5" style={BORDER}>
        <h2 className="text-[15px] font-semibold text-navy-900">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px]" style={MUTED}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function KV({ rows }) {
  return (
    <dl className="grid gap-x-4 gap-y-2.5 px-5 py-4 text-sm sm:grid-cols-[150px_minmax(0,1fr)]">
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k} className="contents">
          <dt style={MUTED}>{k}</dt>
          <dd className="min-w-0 break-words text-navy-900 max-sm:mb-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const KIND = {
  usb: 'USB', external: 'External', removable: 'Removable', fixed: 'Internal', nvme: 'NVMe',
};

function uptime(lastBootAt) {
  if (!lastBootAt) return null;
  const h = Math.floor((Date.now() - new Date(lastBootAt).getTime()) / 3600000);
  return h < 48 ? `up ${h} hours` : `up ${Math.floor(h / 24)} days`;
}

export default function AssetDevice({ assetId, asset }) {
  const [device, setDevice] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/assets/${assetId}/device`).then(({ data }) => setDevice(data.device)).catch((err) => setError(errMessage(err)));
  }, [assetId]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!device) return <Spinner />;

  const os = device.os || {};
  const cpu = device.cpu || {};
  const osText = [os.edition || os.name, os.version].filter(Boolean).join(' ') + (os.build ? ` · build ${os.build}` : '');
  const internal = device.disks.filter((d) => !/^(usb|external|removable)$/i.test(d.kind || ''));
  const counted = internal.length ? internal : device.disks;
  const total = counted.reduce((n, d) => n + (d.sizeBytes || 0), 0);
  const free = counted.reduce((n, d) => n + (d.freeBytes || 0), 0);
  const signedIn = device.signedInUser && device.signedInUser.account;

  return (
    <div className="space-y-5">
      {device.revokedAt && <Notice tone="bad">This computer was revoked on {shortDate(device.revokedAt)}: PRISM refuses it until it is enrolled again.</Notice>}
      <div className="flex gap-2.5 rounded-[10px] border p-3 text-[13px]" style={{ ...BORDER, backgroundColor: 'var(--color-surface-2, var(--color-hover))', color: 'var(--color-text-secondary)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>
        <p className="m-0">
          Hardware, operating system and network come from the PRISM agent and are replaced at each inventory. Location, purchase, warranty and notes stay yours.
          {' '}Last inventory <b>{ago(device.lastInventoryAt)}</b> · last check-in <b>{ago(device.lastSeenAt)}</b>.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Hardware and OS">
          <KV rows={[
            ['Make and model', [asset && asset.make, asset && asset.model].filter(Boolean).join(' ') || null],
            ['Serial number', asset && asset.serialNumber ? <span className="font-mono text-[12.5px]">{asset.serialNumber}</span> : null],
            ['Processor', cpu.model ? `${cpu.model}${cpu.cores ? ` · ${cpu.cores} cores` : ''}` : null],
            ['Memory', device.memoryBytes ? `${Math.round(device.memoryBytes / 1024 ** 3)} GB` : null],
            ['Firmware', asset && asset.firmwareVersion ? asset.firmwareVersion : null],
            ['Operating system', osText || PLATFORM[device.platform]],
            {
              macos: ['Directory', device.domain ? `${device.domain} (Active Directory, bound)` : 'Not bound to a directory'],
              linux: ['Realm', device.domain ? `${device.domain} (joined with realmd)` : 'Not joined to a realm'],
            }[device.platform]
              || ['Joined to', device.domain ? `${device.domain} (Active Directory domain)` : 'Not joined to a domain'],
            ['Last boot', device.lastBootAt ? `${dateTime(device.lastBootAt)} · ${uptime(device.lastBootAt)}` : null],
            ['Signed in now', signedIn ? (
              <span>
                <span className="font-mono text-[12.5px]">{signedIn}</span>
                {device.signedInContact && <> → <Link to={`/contacts/${device.signedInContact.id}`} className="text-prism hover:underline">{device.signedInContact.displayName}</Link></>}
              </span>
            ) : 'Nobody'],
            ['Agent', (
              <span>
                {device.agentVersion} · enrolled {shortDate(device.enrolledAt)}{device.enrollmentKey ? ` with “${device.enrollmentKey.name}”` : ''}
                {device.updatePending && <> <StatusChip tone="waiting">Update pending</StatusChip></>}
              </span>
            )],
          ]}
          />
        </Card>

        <div className="space-y-5">
          <Card title="Disks" hint={counted.length ? `${gb(total)} total · ${gb(free)} free` : 'None reported'}>
            {device.disks.map((d) => {
              const used = Math.max(0, (d.sizeBytes || 0) - (d.freeBytes || 0));
              const pct = d.sizeBytes ? Math.round((100 * used) / d.sizeBytes) : 0;
              return (
                <div key={d.name} className="flex flex-col gap-2 border-b px-5 py-3.5 last:border-b-0" style={BORDER}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span><b className="text-navy-900">{d.name}</b> <span style={MUTED}>{[KIND[(d.kind || '').toLowerCase()] || d.kind, d.label].filter(Boolean).join(' · ')}</span></span>
                    <span style={MUTED}>{gb(used)} used of {gb(d.sizeBytes)}</span>
                  </div>
                  <div role="meter" aria-label={`${d.name} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-navy-100">
                    <i className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? 'var(--color-danger)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-accent)' }} />
                  </div>
                </div>
              );
            })}
          </Card>

          <Card title="Network">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr><th className="table-th">Adapter</th><th className="table-th">IPv4</th><th className="table-th">MAC address</th></tr></thead>
                <tbody>
                  {device.adapters.map((a) => (
                    <tr key={`${a.name}-${a.mac}`} className="border-t" style={BORDER}>
                      <td className="table-td">
                        <span className="font-medium text-navy-900">{a.name}</span>
                        {a.primary && <> <StatusChip tone="info">Primary</StatusChip></>}
                        {!a.ipv4.length && <span style={MUTED}> · not connected</span>}
                      </td>
                      <td className="table-td font-mono text-[12.5px]">{a.ipv4.join(', ') || '—'}</td>
                      <td className="table-td font-mono text-[12.5px]">{a.mac || '—'}</td>
                    </tr>
                  ))}
                  {!device.adapters.length && <tr><td className="table-td" colSpan={3}>None reported.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
