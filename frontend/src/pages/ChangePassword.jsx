import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errMessage } from '../api/api';

// Used both for the forced first-login change (mustChangePassword) and for a
// voluntary password change. When forced, the current password is not required.
export default function ChangePassword() {
  const { user, mustChangePassword, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const forced = mustChangePassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(forced ? undefined : currentPassword, newPassword);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-2xl font-bold tracking-wide text-white">PRISM</h1>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">
              {forced ? 'Set a new password' : 'Change password'}
            </h2>
            {forced && (
              <p className="mt-1 text-sm text-navy-500">
                Your account requires a password change before you can continue
                {user?.username ? ` (${user.username})` : ''}.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {!forced && (
            <div>
              <label className="label">Current password</label>
              <input
                type="password"
                className="input"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          )}

          <div>
            <label className="label">New password</label>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-navy-400">At least 8 characters.</p>
          </div>

          <div>
            <label className="label">Confirm new password</label>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Saving…' : 'Update password'}
          </button>

          <button type="button" onClick={handleSignOut} className="w-full text-center text-xs text-navy-400 hover:text-navy-600">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
