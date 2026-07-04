import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme, THEME_OPTIONS } from '../../context/ThemeContext';

const THRESHOLD_OPTIONS = [
  { value: 0, label: 'No minimum' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
];

// Minimal personal preferences page. Visible to all roles (requesters see only
// this under Settings). Profile fields come from the directory / account and are
// read-only here; local accounts can change their password.
export default function Preferences() {
  const { user, isStaff, refresh } = useAuth();
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

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Preferences</h1>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Appearance</h2>
        <label className="label">Theme</label>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition ${
                theme === opt.value
                  ? 'border-prism bg-prism/10 text-prism'
                  : 'border-navy-200 text-navy-700 hover:bg-navy-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-navy-400">“System” follows your operating system’s light/dark setting.</p>
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
