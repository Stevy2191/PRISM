import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useSettings, applyPersonalColors } from '../../context/SettingsContext';
import { useTheme, THEME_OPTIONS } from '../../context/ThemeContext';

// Tier 1 (personal) fields — a smaller set than the admin Appearance page,
// keyed by literal CSS variable name so they can be applied/stored directly.
const PERSONAL_COLOR_FIELDS = [
  ['--color-bg', 'App background'],
  ['--color-sidebar', 'Sidebar background'],
  ['--color-card', 'Card / panel background'],
  ['--color-border', 'Border color'],
  ['--color-accent', 'Primary accent'],
  ['--color-text-primary', 'Text primary'],
  ['--color-text-secondary', 'Text secondary'],
  ['--color-success', 'Success'],
  ['--color-warning', 'Warning'],
  ['--color-danger', 'Danger'],
];

function getResolvedColor(varName) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || '#000000';
}

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

// Minimal personal preferences page. Visible to all roles (requesters see only
// this under Settings). Profile fields come from the directory / account and are
// read-only here; local accounts can change their password.
export default function Preferences() {
  const { user, isStaff, isAdmin, refresh } = useAuth();
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
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

  // ---- Personal colors (tier 1) ----
  const overridesAllowed = settings.theme?.usersCanOverrideColors !== false;
  const hasSavedColors = !!(user?.userColors && Object.keys(user.userColors).length);
  const [useOwnColors, setUseOwnColors] = useState(!!user?.userColorsEnabled);
  const [colors, setColors] = useState(() => {
    const seed = {};
    PERSONAL_COLOR_FIELDS.forEach(([varName]) => {
      seed[varName] = user?.userColors?.[varName] || getResolvedColor(varName);
    });
    return seed;
  });
  const [colorsSaving, setColorsSaving] = useState(false);
  const [colorsSaved, setColorsSaved] = useState(false);
  const [colorsError, setColorsError] = useState('');
  const saveTimer = useRef(null);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // `payload` is a partial preferences body — e.g. { userColorsEnabled: false }
  // on its own leaves userColors untouched server-side, which is what makes
  // toggling off non-destructive.
  const persistColors = async (payload) => {
    setColorsSaving(true);
    setColorsError('');
    try {
      await api.patch(`/users/${user.id}/preferences`, payload);
      await refresh();
      setColorsSaved(true);
      setTimeout(() => setColorsSaved(false), 2000);
    } catch (err) {
      setColorsError(errMessage(err));
    } finally {
      setColorsSaving(false);
    }
  };

  const handleColorChange = (varName, value) => {
    const next = { ...colors, [varName]: value };
    setColors(next);
    applyPersonalColors(user.id, next, true); // instant live preview
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistColors({ userColors: next, userColorsEnabled: true }), 500);
  };

  const handleToggleOwnColors = (checked) => {
    setUseOwnColors(checked);
    applyPersonalColors(user.id, colors, checked);
    if (checked) {
      // Turning on re-applies + re-saves whatever's currently in `colors`
      // (the previously saved values, or freshly seeded defaults the first
      // time) — nothing was ever cleared while the toggle was off.
      persistColors({ userColors: colors, userColorsEnabled: true });
    } else {
      // Flip the flag only — userColors is deliberately omitted so the
      // saved values are left untouched on the server.
      persistColors({ userColorsEnabled: false });
    }
  };

  const resetPersonalColors = () => {
    if (!confirm('This will permanently clear your personal colors. Are you sure?')) return;
    setUseOwnColors(false);
    applyPersonalColors(user.id, null, false);
    persistColors({ userColors: null, userColorsEnabled: false });
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
        <p className="mt-1 text-xs text-navy-400">
          Your theme choice applies on top of the system palette. Enable personal colors below to fully customize your experience.
        </p>
        {isAdmin && (
          <Link to="/settings/appearance" className="mt-2 inline-block text-xs text-prism hover:underline">
            Customize system-wide colors →
          </Link>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Personal Colors</h2>
          {colorsSaved && <span className="text-xs font-medium text-green-600">Saved</span>}
        </div>
        {colorsError && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{colorsError}</div>}

        {!overridesAllowed ? (
          <p className="text-sm text-navy-500">
            Your administrator has disabled personal color overrides. Everyone sees the system palette.
          </p>
        ) : (
          <>
            <label className="flex items-center justify-between">
              <span>
                <span className="block text-sm font-medium text-navy-800">Use my own colors</span>
                <span className="block text-xs text-navy-400">Override the system palette with colors only you see.</span>
              </span>
              <span className="relative inline-flex h-6 w-11 flex-shrink-0 items-center">
                <input
                  type="checkbox"
                  checked={useOwnColors}
                  disabled={colorsSaving}
                  onChange={(e) => handleToggleOwnColors(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full bg-navy-200 transition peer-checked:bg-prism" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
              </span>
            </label>

            {!useOwnColors ? (
              <div className="mt-4">
                <p className="text-sm text-navy-500">
                  You are using the {settings.theme?.mode === 'custom' ? 'system palette' : 'default theme'} colors.
                </p>
                <div className="mt-2 flex overflow-hidden rounded-md border border-navy-200" style={{ height: 28 }}>
                  {PERSONAL_COLOR_FIELDS.map(([varName]) => (
                    <span key={varName} className="flex-1" style={{ backgroundColor: getResolvedColor(varName) }} />
                  ))}
                </div>
                <p className="mt-2 text-xs text-navy-400">
                  {hasSavedColors
                    ? 'Your personal colors are saved but not active. Toggle on to restore them.'
                    : 'No personal colors saved.'}
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {PERSONAL_COLOR_FIELDS.map(([varName, label]) => (
                    <div key={varName}>
                      <label className="label">{label}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          className="h-9 w-12 rounded border border-navy-200"
                          value={colors[varName] || '#000000'}
                          onChange={(e) => handleColorChange(varName, e.target.value)}
                        />
                        <input
                          className="input font-mono text-sm"
                          value={colors[varName] || ''}
                          onChange={(e) => handleColorChange(varName, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={resetPersonalColors} className="btn-secondary" disabled={colorsSaving}>
                  Reset to system defaults
                </button>
              </div>
            )}
          </>
        )}
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

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Your profile</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" value={user?.displayName} />
          <Field label="Username" value={user?.username} />
          <Field label="Email" value={user?.email || '—'} />
          <Field label="Role" value={user?.role} />
          <Field label="Account type" value={user?.isLocalAccount ? 'Local' : 'Active Directory'} />
        </dl>
      </div>

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

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-navy-400">{label}</dt>
      <dd className="text-sm capitalize text-navy-800">{value}</dd>
    </div>
  );
}
