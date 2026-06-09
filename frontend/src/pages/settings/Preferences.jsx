import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme, THEME_OPTIONS } from '../../context/ThemeContext';

// Minimal personal preferences page. Visible to all roles (requesters see only
// this under Settings). Profile fields come from the directory / account and are
// read-only here; local accounts can change their password.
export default function Preferences() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

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
