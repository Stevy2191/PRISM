import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { IconEye, IconEyeOff, IconLayoutGrid } from '@tabler/icons-react';
import { usePortalAuth } from '../PortalAuth';
import { Brand } from '../PortalLayout';
import { errMessage, safeNext } from '../api';
import Notice from '../../components/ui/Notice';

// Why Microsoft sign-in sent someone back (?refused=, from the callback).
const NOT_SET_UP = ["Your account isn't set up for this portal", 'Ask your help desk to give this account access, or sign in with a different work account.'];
const REFUSED = {
  not_linked: NOT_SET_UP,
  not_in_groups: NOT_SET_UP,
  no_access: NOT_SET_UP,
  other_company: ['Your account is linked to another organization', 'Contact support: nothing has been changed.'],
  conflict: ['Your account needs a hand from support', 'Your email belongs to a portal account linked to a different Microsoft account. Contact support.'],
  inactive: ['Your portal access has ended', 'Contact support if this is unexpected.'],
  unavailable: ['Microsoft sign-in isn\'t available right now', 'Try again later, or sign in with email if you have a password.'],
  failed: ['Sign-in with Microsoft didn\'t finish', 'Please try again.'],
};

// Mockups Main / SignInPhone: brand panel on the left (above on a phone),
// Microsoft first when offered, then email and password.
export default function SignIn() {
  const { me, config, signIn } = usePortalAuth();
  const [params] = useSearchParams();
  const reason = params.get('refused');
  const refused = reason ? (Object.hasOwn(REFUSED, reason) ? REFUSED[reason] : REFUSED.failed) : null;
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (me) return <Navigate to={next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await signIn(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errMessage(err, 'Could not sign in. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const tagline = config?.branding?.tagline;
  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ backgroundColor: 'var(--color-bg)' }}>
      <section className="flex flex-col justify-between gap-4 border-b px-4 py-6 md:w-[46%] md:flex-none md:border-b-0 md:border-r md:px-14 md:py-11" style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <Brand config={config} to="/portal/sign-in" support={false} />
        <div>
          {tagline && <p className="max-w-[460px] text-lg font-semibold leading-snug md:text-[30px] md:leading-tight" style={{ color: 'var(--color-text-primary)' }}>{tagline}</p>}
          <p className="mt-3 hidden max-w-[440px] text-[15px] leading-relaxed md:block" style={{ color: 'var(--color-text-secondary)' }}>
            Sign in to raise a ticket, see how it&apos;s going, and find answers in the knowledge base.
          </p>
        </div>
        <span className="hidden md:block" />
      </section>
      <section className="flex flex-1 items-start justify-center px-4 py-8 md:items-center md:p-12">
        <form onSubmit={submit} className="flex w-full max-w-[380px] flex-col gap-4">
          <div>
            <h1 className="page-title">Sign in</h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Raise and follow your support tickets.</p>
          </div>
          {config && config.enabled === false && <Notice tone="warn">The support portal is switched off at the moment.</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          {refused && (
            <section aria-label="Microsoft account not allowed" className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}>
              <h2 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{refused[0]}</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{refused[1]}</p>
            </section>
          )}
          {config?.microsoft && (
            <>
              <a href="/api/v1/portal/auth/microsoft/start" className="btn-primary h-12 justify-center text-[15px]">
                <IconLayoutGrid size={16} aria-hidden="true" />Sign in with Microsoft
              </a>
              <div className="flex items-center gap-3 text-[12.5px] before:flex-1 before:border-t after:flex-1 after:border-t" style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }}>or with email</div>
            </>
          )}
          <div>
            <label htmlFor="portal-email" className="label">Email</label>
            <input id="portal-email" className="input h-12 text-[15px]" type="email" autoComplete="username" placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="portal-password" className="label">Password</label>
            <div className="relative">
              <input id="portal-password" className="input h-12 pr-12 text-[15px]" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md" style={{ color: 'var(--color-text-muted)' }}>
                {show ? <IconEyeOff size={18} aria-hidden="true" /> : <IconEye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div className="text-right text-sm"><Link to="/portal/forgot" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Forgot password?</Link></div>
          <button type="submit" disabled={busy} className={`${config?.microsoft ? 'btn-secondary' : 'btn-primary'} h-12 justify-center text-[15px]`}>
            {busy ? 'Signing in…' : 'Sign in with email'}
          </button>
          <p className="text-center text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            Work at the help desk? <Link to="/login" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Staff sign in →</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
