import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme, THEME_OPTIONS } from '../../context/ThemeContext';
import { useNavStyle, NAV_STYLE_OPTIONS } from '../../context/NavStyleContext';

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
    phone: user?.phone || '',
    jobTitle: user?.jobTitle || '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
          <input className="input" value={form.phone} onChange={set('phone')} />
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
