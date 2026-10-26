// The Settings overview (spec: Settings redesign): every group the user may
// open with its pages, a search, and — for owners — whether sign-in and
// email are set up (GET /settings/status: booleans and counts only).
import { useEffect, useMemo, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { searchPages, visibleGroups } from './registry';

const HINT = { ok: { color: 'var(--color-success)' }, warn: { color: 'var(--color-warning)' }, off: { color: 'var(--color-text-muted)' } };

function hintsFrom(s) {
  if (!s) return {};
  const dir = s.directory.connected ? ['ok', 'Connected'] : s.directory.configured ? ['warn', 'Not tested'] : ['off', 'Not set up'];
  return {
    directory: dir,
    'incoming-email': s.incomingEmail.enabled ? ['ok', 'On'] : ['off', 'Off'],
    'outgoing-email': s.outgoingEmail.configured ? ['ok', 'Set up'] : ['warn', 'Not set up'],
    'single-sign-on': s.singleSignOn.enabled ? ['ok', `${s.singleSignOn.enabled} on`] : ['off', 'Off'],
  };
}

function VersionFooter() {
  const [info, setInfo] = useState(null);
  useEffect(() => { api.get('/version').then(({ data }) => setInfo(data)).catch(() => {}); }, []);
  if (!info) return null;
  return (
    <p className="border-t border-navy-100 pt-4 font-mono text-xs text-navy-400">
      PRISM {info.version}
      {info.gitSha !== 'unknown' && <> · {info.gitSha}</>}
      {/* An untagged build says so, so a dev image is never taken for a release. */}
      {!info.release && <> · unreleased build</>}
      {' · '}<Link to="/settings/about" className="hover:text-prism hover:underline">About</Link>
    </p>
  );
}

export default function SettingsHome() {
  const { user, isOwner, hasAnyPermission } = useAuth();
  const groups = useMemo(() => visibleGroups({ role: user?.role, isOwner, hasAnyPermission }), [user, isOwner, hasAnyPermission]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!isOwner) return;
    api.get('/settings/status').then(({ data }) => setStatus(data)).catch(() => {});
  }, [isOwner]);
  const hints = hintsFrom(status);
  const matches = searchPages(query, groups.flatMap((g) => g.pages));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-navy-500">Set up PRISM for your organization.</p>
      </header>
      <label className="relative block max-w-md">
        <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
        <input type="search" className="input h-11 pl-9" aria-label="Search settings" placeholder='Find a setting — try "SLA", "logo" or "password"'
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {query.trim() ? (
        <ul className="max-w-md space-y-1">
          {matches.length ? matches.map((p) => (
            <li key={p.id}><Link to={p.path} className="block rounded-md px-2 py-1.5 hover:bg-[var(--color-hover)]">
              <span className="font-semibold text-navy-900">{p.name}</span> <span className="text-sm text-navy-400">· {p.group} · {p.desc}</span>
            </Link></li>
          )) : <li className="text-sm text-navy-400">No settings match</li>}
        </ul>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name}>
              <h2 className="eyebrow mb-1">{g.name}</h2>
              <ul>
                {g.pages.map((p) => (
                  <li key={p.id} className="border-b border-navy-100">
                    <Link to={p.path} className="group flex items-baseline justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="font-semibold text-navy-900 group-hover:underline">{p.name}</span>
                        <span className="block truncate text-xs text-navy-400">{p.desc}</span>
                      </span>
                      {hints[p.id] && <span className="flex-shrink-0 text-xs font-semibold" style={HINT[hints[p.id][0]]}>{hints[p.id][1]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <VersionFooter />
    </div>
  );
}
