// Settings home (layout B, 2026-10-28): one section at a time, its pages as
// large rows (?section=<slug>). It opens on the section last used, else the
// first. On a phone with no section chosen it lists the sections instead.
// Owners also see whether sign-in and email are set up (GET /settings/status:
// booleans and counts only).
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useNarrow } from '../../hooks/useNarrow';
import { visibleGroups } from './registry';
import SettingsMenu from '../../components/settings/SettingsMenu';
import { lastSection, rememberSection, sectionIcon } from '../../components/settings/sectionIcons';

const HINT = {
  ok: { backgroundColor: 'var(--color-timer-bg)', color: 'var(--color-timer)' },
  warn: { backgroundColor: 'var(--color-waiting-bg)', color: 'var(--color-warning)' },
  off: { backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' },
};

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
  const [params] = useSearchParams();
  const narrow = useNarrow();
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!isOwner) return;
    api.get('/settings/status').then(({ data }) => setStatus(data)).catch(() => {});
  }, [isOwner]);
  const asked = params.get('section');
  const section = groups.find((g) => g.slug === asked) || null;
  useEffect(() => { if (section) rememberSection(section.slug); }, [section]);

  // No (or an unknown) section: a phone lists them; elsewhere open the last used.
  if (!section) {
    if (narrow && !asked) {
      return (
        <div className="space-y-4">
          <header>
            <h1 className="page-title">Settings</h1>
            <p className="mt-1 text-sm text-navy-500">Set up PRISM for your organization.</p>
          </header>
          <SettingsMenu big />
          <VersionFooter />
        </div>
      );
    }
    const fallback = groups.find((g) => g.slug === lastSection()) || groups[0];
    return fallback ? <Navigate to={`/settings?section=${fallback.slug}`} replace /> : null;
  }

  const hints = hintsFrom(status);
  const Icon = sectionIcon(section.icon);
  return (
    <div className="max-w-4xl space-y-5">
      {narrow && (
        <Link to="/settings" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
          <IconChevronLeft size={16} aria-hidden="true" />All settings
        </Link>
      )}
      <header className="flex items-center gap-4">
        <span aria-hidden="true" className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
          <Icon size={24} stroke={1.8} />
        </span>
        <div className="min-w-0">
          <h1 className="page-title">{section.name}</h1>
          <p className="mt-0.5 text-sm text-navy-500">{section.desc}</p>
        </div>
      </header>
      <div className="card overflow-hidden">
        <ul className="divide-y divide-navy-100">
          {section.pages.map((p) => (
            <li key={p.id}>
              <Link to={p.path} className="flex min-h-[64px] items-center gap-3 px-4 py-3.5 hover:bg-[var(--color-hover)] sm:px-5">
                <span className="min-w-0 flex-1">
                  <span data-page-name className="block text-[15px] font-semibold text-navy-900">{p.name}</span>
                  <span className="block text-[13px] text-navy-400">{p.desc}</span>
                </span>
                {hints[p.id] && (
                  <span className="flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={HINT[hints[p.id][0]]}>{hints[p.id][1]}</span>
                )}
                <IconChevronRight size={18} aria-hidden="true" className="flex-shrink-0 text-navy-400" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <VersionFooter />
    </div>
  );
}
