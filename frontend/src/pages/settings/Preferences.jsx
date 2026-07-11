import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme, THEME_OPTIONS } from '../../context/ThemeContext';
import { useNavStyle, NAV_STYLE_OPTIONS } from '../../context/NavStyleContext';
import { formatPhone } from '../../utils/formatPhone';

const THRESHOLD_OPTIONS = [
  { value: 0, label: 'No minimum' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
];

// Fixed preview colors — these swatches must show what each theme actually
// looks like regardless of which theme is currently active, so they're
// literal values rather than the live --color-* variables.
const THEME_PREVIEWS = {
  light: { bg: '#f8fafc', card: '#ffffff', accent: '#2563eb', border: '#e2e8f0' },
  dark: { bg: '#080b12', card: '#0d1120', accent: '#3b82f6', border: '#161c2d' },
};

function ThemeSwatch({ value }) {
  if (value === 'system') {
    return (
      <span className="flex h-9 w-16 overflow-hidden rounded border border-navy-200">
        {['light', 'dark'].map((half) => (
          <span key={half} className="flex-1" style={{ backgroundColor: THEME_PREVIEWS[half].bg }}>
            <span className="block h-2.5 w-full" style={{ backgroundColor: THEME_PREVIEWS[half].accent }} />
            <span className="m-1 block h-3 rounded-sm" style={{ backgroundColor: THEME_PREVIEWS[half].card, border: `1px solid ${THEME_PREVIEWS[half].border}` }} />
          </span>
        ))}
      </span>
    );
  }
  const p = THEME_PREVIEWS[value];
  return (
    <span className="block h-9 w-16 overflow-hidden rounded border border-navy-200" style={{ backgroundColor: p.bg }}>
      <span className="block h-2.5 w-full" style={{ backgroundColor: p.accent }} />
      <span className="m-1 block h-3 rounded-sm" style={{ backgroundColor: p.card, border: `1px solid ${p.border}` }} />
    </span>
  );
}

// Miniature top-bar vs. compact-sidebar previews, using the same fixed
// light-mode swatch colors as ThemeSwatch.
function NavStyleSwatch({ value }) {
  const p = THEME_PREVIEWS.light;
  if (value === 'sidebar') {
    return (
      <span className="flex h-9 w-16 overflow-hidden rounded border border-navy-200" style={{ backgroundColor: p.bg }}>
        <span className="h-full w-3" style={{ backgroundColor: p.card, borderRight: `1px solid ${p.border}` }} />
        <span className="m-1 flex-1 rounded-sm" style={{ backgroundColor: p.card, border: `1px solid ${p.border}` }} />
      </span>
    );
  }
  return (
    <span className="block h-9 w-16 overflow-hidden rounded border border-navy-200" style={{ backgroundColor: p.bg }}>
      <span className="block h-2.5 w-full" style={{ backgroundColor: p.card, borderBottom: `1px solid ${p.border}` }} />
      <span className="m-1 block h-3 rounded-sm" style={{ backgroundColor: p.card, border: `1px solid ${p.border}` }} />
    </span>
  );
}

// Minimal personal preferences page. Profile fields come from the directory /
// account and are read-only here; local accounts can change their password.
export default function Preferences() {
  const { user, isStaff, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const { navStyle, setNavStyle } = useNavStyle();
  const [timerMode, setTimerMode] = useState(user?.timerMode || 'manual');
  const [timerMinThreshold, setTimerMinThreshold] = useState(user?.timerMinThreshold ?? 0);
  const [timerPromptBeforeLog, setTimerPromptBeforeLog] = useState(user?.timerPromptBeforeLog ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const saveTimerPrefs = async (next) => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.patch(`/users/${user.id}/preferences`, {
        timerMode,
        timerMinThreshold,
        timerPromptBeforeLog,
        ...next,
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Preferences</h1>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Appearance</h2>
        <label className="label">Theme</label>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-center transition ${
                theme === opt.value
                  ? 'border-prism bg-prism/10 text-prism'
                  : 'border-navy-200 text-navy-700 hover:bg-navy-100'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={opt.value}
                checked={theme === opt.value}
                onChange={() => setTheme(opt.value)}
                className="sr-only"
              />
              <ThemeSwatch value={opt.value} />
              <span className="text-sm font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-navy-400">“System” follows your operating system’s light/dark setting. Your choice applies immediately and is saved on this device.</p>

        <label className="label mt-5">Navigation style</label>
        <div className="grid grid-cols-2 gap-3">
          {NAV_STYLE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-center transition ${
                navStyle === opt.value
                  ? 'border-prism bg-prism/10 text-prism'
                  : 'border-navy-200 text-navy-700 hover:bg-navy-100'
              }`}
            >
              <input
                type="radio"
                name="navStyle"
                value={opt.value}
                checked={navStyle === opt.value}
                onChange={() => setNavStyle(opt.value)}
                className="sr-only"
              />
              <NavStyleSwatch value={opt.value} />
              <span className="text-sm font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-navy-400">Top bar gives pages full width. Side bar shows a compact icon-only rail with tooltips. Saved on this device.</p>
      </div>

      {isStaff && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Timer Behavior</h2>
            {saved && <span className="text-xs font-medium text-green-600">Saved</span>}
          </div>
          {error && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <label className="label">Timer mode</label>
          <div className="mb-4 flex gap-4">
            {[
              { value: 'manual', label: 'Manual', hint: 'You control start/stop.' },
              { value: 'automatic', label: 'Automatic', hint: 'Starts when a ticket opens, stops when you leave.' },
            ].map((opt) => (
              <label key={opt.value} className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-navy-200 p-3 text-sm">
                <input
                  type="radio"
                  name="timerMode"
                  checked={timerMode === opt.value}
                  onChange={() => { setTimerMode(opt.value); saveTimerPrefs({ timerMode: opt.value }); }}
                  className="mt-0.5"
                  disabled={saving}
                />
                <span>
                  <span className="block font-medium text-navy-800">{opt.label}</span>
                  <span className="block text-xs text-navy-400">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="label">Minimum log threshold</label>
          <select
            className="input mb-4"
            value={timerMinThreshold}
            disabled={saving}
            onChange={(e) => {
              const val = Number(e.target.value);
              setTimerMinThreshold(val);
              saveTimerPrefs({ timerMinThreshold: val });
            }}
          >
            {THRESHOLD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="-mt-3 mb-4 text-xs text-navy-400">
            In automatic mode, entries shorter than this are discarded silently.
          </p>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm font-medium text-navy-800">Prompt before logging</span>
              <span className="block text-xs text-navy-400">
                When off, automatic mode saves silently instead of showing the log-time modal.
              </span>
            </span>
            <input
              type="checkbox"
              checked={timerPromptBeforeLog}
              disabled={saving}
              onChange={(e) => {
                setTimerPromptBeforeLog(e.target.checked);
                saveTimerPrefs({ timerPromptBeforeLog: e.target.checked });
              }}
              className="h-5 w-5 flex-shrink-0 rounded border-navy-300 text-prism"
            />
          </label>
        </div>
      )}

      <ProfileSection user={user} onSaved={refresh} />

      <CalendarIntegrationsSection />

      {user?.isLocalAccount && (
        <div className="card flex items-center justify-between p-5">
          <div>
            <p className="font-medium text-navy-900">Password</p>
            <p className="text-sm text-navy-500">Change the password for your local account.</p>
          </div>
          <Link to="/change-password" className="btn-secondary">Change password</Link>
        </div>
      )}
    </div>
  );
}

// Self-service profile fields — first/last name combine to form the display
// name shown throughout the app (see backend computeDisplayName). Department
// is admin-only, managed from Settings -> Users instead.
function ProfileSection({ user, onSaved }) {
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: formatPhone(user?.phone || ''),
    jobTitle: user?.jobTitle || '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setPhone = (e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.patch(`/users/${user.id}`, {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">Your profile</h2>
        {saved && <span className="text-xs font-medium text-green-600">Saved</span>}
      </div>
      {error && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">First name</label>
          <input className="input" value={form.firstName} onChange={set('firstName')} />
        </div>
        <div>
          <label className="label">Last name</label>
          <input className="input" value={form.lastName} onChange={set('lastName')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={setPhone} placeholder="(555) 123-4567" inputMode="tel" />
        </div>
        <div>
          <label className="label">Job title</label>
          <input className="input" value={form.jobTitle} onChange={set('jobTitle')} />
        </div>
        <div>
          <label className="label">Username</label>
          <p className="input flex items-center !bg-navy-50 text-navy-500">{user?.username}</p>
        </div>
        <div className="sm:col-span-2 flex items-center justify-between border-t border-navy-100 pt-4">
          <span className="text-xs text-navy-400">
            Role: {user?.primaryRole?.name || 'No role assigned'} · {user?.isLocalAccount ? 'Local account' : 'Active Directory'}
          </span>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// ---- Calendar integrations ----

const PROVIDER_META = {
  google: { label: 'Google', badgeClass: 'bg-red-50 text-red-700' },
  microsoft: { label: 'Microsoft', badgeClass: 'bg-sky-50 text-sky-700' },
  ical: { label: 'iCal', badgeClass: 'bg-navy-100 text-navy-600' },
};

function relativeSync(lastSynced) {
  if (!lastSynced) return 'Never synced';
  const diffMs = Date.now() - new Date(lastSynced).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.round(hours / 24)}d ago`;
}

function CalendarIntegrationsSection() {
  const { settings } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [pickCalendarFor, setPickCalendarFor] = useState(null); // integration id awaiting calendar selection

  const load = () => {
    api.get('/calendar/integrations')
      .then(({ data }) => setIntegrations(data.integrations))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Handle the redirect back from a Google/Microsoft OAuth callback.
  useEffect(() => {
    const connected = searchParams.get('calendarConnected');
    const integrationId = searchParams.get('integrationId');
    const oauthError = searchParams.get('calendarError');
    if (!connected && !oauthError) return;
    if (oauthError) {
      setError(`Couldn't connect calendar: ${oauthError}`);
    } else if (connected) {
      setNotice(`${PROVIDER_META[connected]?.label || connected} connected — choose which calendar to sync below.`);
      load();
      if (integrationId) setPickCalendarFor(Number(integrationId));
    }
    setSearchParams((sp) => { sp.delete('calendarConnected'); sp.delete('integrationId'); sp.delete('calendarError'); return sp; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleActive = async (integ) => {
    try {
      const { data } = await api.patch(`/calendar/integrations/${integ.id}`, { isActive: !integ.isActive });
      setIntegrations((list) => list.map((i) => (i.id === integ.id ? data.integration : i)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const toggleSyncEnabled = async (integ) => {
    try {
      const { data } = await api.patch(`/calendar/integrations/${integ.id}`, { syncEnabled: !integ.syncEnabled });
      setIntegrations((list) => list.map((i) => (i.id === integ.id ? data.integration : i)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const disconnect = async (integ) => {
    if (!confirm(`Disconnect "${integ.name}"? Its cached events will be removed from your calendar.`)) return;
    try {
      await api.delete(`/calendar/integrations/${integ.id}`);
      setIntegrations((list) => list.filter((i) => i.id !== integ.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">Calendar integrations</h2>
        <button type="button" className="btn-secondary" onClick={() => setConnectOpen(true)}>+ Connect calendar</button>
      </div>
      <p className="mb-3 text-sm text-navy-500">
        Overlay your Google Calendar, Outlook, or any iCal feed on the PRISM Calendar page. Connected calendars are read-only in PRISM.
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{notice}</div>}

      {loading ? (
        <p className="text-sm text-navy-400">Loading…</p>
      ) : integrations.length === 0 ? (
        <p className="text-sm text-navy-400">No calendars connected yet.</p>
      ) : (
        <div className="divide-y divide-navy-100">
          {integrations.map((integ) => (
            <div key={integ.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: integ.color }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-navy-800">{integ.name}</p>
                    <span className={`badge ${PROVIDER_META[integ.provider]?.badgeClass}`}>{PROVIDER_META[integ.provider]?.label}</span>
                    {integ.needsReconnect && <span className="badge bg-red-100 text-red-700">Reconnect needed</span>}
                  </div>
                  <p className="text-xs text-navy-400">{relativeSync(integ.lastSynced)}</p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                {integ.provider !== 'ical' && (
                  <label className="flex items-center gap-1.5 text-xs text-navy-500" title="Push PRISM ticket/project due dates to this calendar">
                    <input type="checkbox" checked={integ.syncEnabled} onChange={() => toggleSyncEnabled(integ)} />
                    Sync PRISM events
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => toggleActive(integ)}
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full transition ${integ.isActive ? 'bg-prism' : 'bg-navy-200'}`}
                  title={integ.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${integ.isActive ? 'left-4' : 'left-0.5'}`} />
                </button>
                <button type="button" onClick={() => disconnect(integ)} className="text-xs text-red-500 hover:underline">Disconnect</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {connectOpen && (
        <ConnectCalendarModal
          settings={settings}
          onClose={() => setConnectOpen(false)}
          onCreated={(integ) => { setIntegrations((list) => [...list, integ]); setConnectOpen(false); }}
        />
      )}
      {pickCalendarFor && (
        <PickCalendarModal
          integrationId={pickCalendarFor}
          onClose={() => setPickCalendarFor(null)}
          onPicked={(integ) => { setIntegrations((list) => list.map((i) => (i.id === integ.id ? integ : i))); setPickCalendarFor(null); }}
        />
      )}
    </div>
  );
}

function ConnectCalendarModal({ settings, onClose, onCreated }) {
  const [icalMode, setIcalMode] = useState(false);
  const [icalName, setIcalName] = useState('');
  const [icalUrl, setIcalUrl] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const googleConfigured = !!settings?.integrations?.googleConfigured;
  const microsoftConfigured = !!settings?.integrations?.microsoftConfigured;

  const startOAuth = async (provider) => {
    setError('');
    try {
      const { data } = await api.get(`/calendar/integrations/${provider}/auth-url`);
      window.location.href = data.url;
    } catch (err) {
      setError(errMessage(err));
    }
  };

  const testUrl = async () => {
    if (!icalUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/calendar/integrations/ical/test', { icalUrl });
      setTestResult(data);
    } catch (err) {
      setTestResult({ valid: false, error: errMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const submitIcal = async (e) => {
    e.preventDefault();
    if (!icalName.trim() || !icalUrl.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/calendar/integrations', { provider: 'ical', name: icalName.trim(), icalUrl: icalUrl.trim() });
      onCreated(data.integration);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="card max-h-[100dvh] w-full overflow-y-auto rounded-none p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-navy-900">Connect calendar</h3>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {!icalMode ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => startOAuth('google')}
              disabled={!googleConfigured}
              className="flex w-full flex-col items-start rounded-md border border-navy-200 px-4 py-3 text-left hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="font-medium text-navy-800">Google Calendar</span>
              {!googleConfigured && <span className="mt-0.5 text-xs text-navy-400">Configure OAuth credentials in Settings → Calendar Integration first</span>}
            </button>
            <button
              type="button"
              onClick={() => startOAuth('microsoft')}
              disabled={!microsoftConfigured}
              className="flex w-full flex-col items-start rounded-md border border-navy-200 px-4 py-3 text-left hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="font-medium text-navy-800">Microsoft Outlook / Office 365</span>
              {!microsoftConfigured && <span className="mt-0.5 text-xs text-navy-400">Configure OAuth credentials in Settings → Calendar Integration first</span>}
            </button>
            <button
              type="button"
              onClick={() => setIcalMode(true)}
              className="flex w-full flex-col items-start rounded-md border border-navy-200 px-4 py-3 text-left hover:bg-navy-50"
            >
              <span className="font-medium text-navy-800">iCal / CalDAV URL</span>
              <span className="mt-0.5 text-xs text-navy-400">Any calendar that publishes a public .ics feed link</span>
            </button>
            <div className="flex justify-end pt-2">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitIcal} className="space-y-4">
            <div>
              <label className="label">Calendar name</label>
              <input className="input" value={icalName} onChange={(e) => setIcalName(e.target.value)} placeholder="e.g. Work Calendar" required autoFocus />
            </div>
            <div>
              <label className="label">iCal URL</label>
              <input
                className="input"
                value={icalUrl}
                onChange={(e) => { setIcalUrl(e.target.value); setTestResult(null); }}
                placeholder="https://... or webcal://..."
                required
              />
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="btn-secondary" onClick={testUrl} disabled={testing || !icalUrl.trim()}>
                  {testing ? 'Testing…' : 'Test URL'}
                </button>
                {testResult?.valid && <span className="text-xs text-green-600">Valid feed — found {testResult.eventCount} event(s)</span>}
                {testResult && !testResult.valid && <span className="text-xs text-red-600">{testResult.error}</span>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setIcalMode(false)}>Back</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PickCalendarModal({ integrationId, onClose, onPicked }) {
  const [calendars, setCalendars] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/calendar/integrations/${integrationId}/available-calendars`)
      .then(({ data }) => setCalendars(data.calendars))
      .catch((err) => setError(errMessage(err)));
  }, [integrationId]);

  const pick = async (calendarId) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.patch(`/calendar/integrations/${integrationId}`, { calendarId });
      onPicked(data.integration);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="card max-h-[100dvh] w-full overflow-y-auto rounded-none p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-navy-900">Which calendar should PRISM sync?</h3>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {!calendars ? (
          <p className="text-sm text-navy-400">Loading your calendars…</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {calendars.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => pick(c.id)}
                className="flex w-full items-center justify-between rounded-md border border-navy-100 px-3 py-2 text-left text-sm hover:bg-navy-50"
              >
                <span>{c.name}</span>
                {c.primary && <span className="badge bg-navy-100 text-navy-600">Primary</span>}
              </button>
            ))}
            {calendars.length === 0 && <p className="text-sm text-navy-400">No calendars found on this account.</p>}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
