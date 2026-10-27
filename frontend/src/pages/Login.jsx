import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api, { errMessage } from '../api/api';
import Notice from '../components/ui/Notice';
import ServiceConsolePanel from '../components/ServiceConsolePanel';

const DEFAULT_BULLETS = ['Ticket & project tracking', 'Time logging & reports', 'AD & local auth', 'API access'];
export default function Login() {
  const { user, login, loading } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ssoProviders, setSsoProviders] = useState([]);

  // Configured sign-on providers, if any. A failure here is not worth
  // surfacing — the password form still works, so it just means no buttons.
  useEffect(() => {
    let cancelled = false;
    api.get('/sso/providers')
      .then(({ data }) => { if (!cancelled) setSsoProviders(data.providers || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A failed sign-on redirects back here with the reason in the query string
  // (the callback cannot render an error itself — it is an API route).
  useEffect(() => {
    const ssoError = new URLSearchParams(location.search).get('ssoError');
    if (ssoError) setError(ssoError);
  }, [location.search]);

  if (!loading && user) {
    const dest = location.state?.from?.pathname || '/dashboard';
    return <Navigate to={dest} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const loggedIn = await login(username, password);
      if (loggedIn.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      // Rely on the declarative <Navigate> render guard above rather than
      // calling navigate() here — avoids a race where ProtectedRoute renders
      // before setUser() propagates and bounces the user back to /login.
    } catch (err) {
      setError(errMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const detectCaps = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const wordmark = settings.appName || settings.branding?.appName || 'PRISM';
  const tagline = settings.branding?.tagline || 'Project & Request Integrated Service Manager';
  const bullets = settings.branding?.loginBullets?.length ? settings.branding.loginBullets : DEFAULT_BULLETS;

  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* The service console (brand, bullet points, tagline). */}
      <ServiceConsolePanel wordmark={wordmark} logoUrl={settings.logoUrl} tagline={tagline} bullets={bullets} />

      {/* Sign-in form */}
      <main className="flex flex-1 items-start justify-center px-5 py-8 md:items-center md:px-12">
        <div className="w-full max-w-[380px]">
          <h1 className="mb-6 text-[28px] font-semibold tracking-tight text-navy-900">Sign in to {wordmark}</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Notice tone="bad">{error}</Notice>}

            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-navy-700">Username or email</label>
              <input
                id="username"
                className="input h-11 text-[15px]"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username or email address"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-navy-700">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input h-11 pr-12 text-[15px]"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={detectCaps}
                  onKeyDown={detectCaps}
                  onBlur={() => setCapsLock(false)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-navy-400 hover:text-navy-700"
                >
                  {showPassword ? <IconEyeOff size={18} stroke={1.8} /> : <IconEye size={18} stroke={1.8} />}
                </button>
              </div>
              {capsLock && (
                <p className="mt-1.5 text-xs font-semibold" style={{ color: 'var(--color-warning)' }}>Caps Lock is on</p>
              )}
            </div>

            <button type="submit" disabled={submitting} className="btn-primary h-11 w-full justify-center text-[15px] disabled:opacity-70">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            {ssoProviders.length > 0 && (
              <>
                <div className="flex items-center gap-3 pt-1 text-xs text-navy-400">
                  <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-border)' }} />
                  or
                  <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-border)' }} />
                </div>
                <div className="flex flex-col gap-2">
                  {ssoProviders.map((p) => (
                    // A full page navigation, not fetch: the browser has to
                    // follow the redirect to the identity provider itself.
                    <a
                      key={p.slug}
                      href={`/api/v1/sso/${encodeURIComponent(p.slug)}/start?returnTo=${encodeURIComponent(location.state?.from?.pathname || '/dashboard')}`}
                      className="flex h-11 w-full items-center justify-center rounded-md border border-navy-100 bg-surface text-sm font-semibold text-navy-900 hover:bg-[var(--color-hover)]"
                    >
                      {p.label}
                    </a>
                  ))}
                </div>
              </>
            )}

            <p className="pt-2 text-center text-xs text-navy-400">Secure session · enter your {wordmark} credentials</p>
          </form>
        </div>
      </main>
    </div>
  );
}
