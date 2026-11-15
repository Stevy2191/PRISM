import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { IconCircleCheck } from '@tabler/icons-react';
import { plainApi } from '../api';
import Notice from '../../components/ui/Notice';

// The plain /portal address (CS). Each company has its own portal; nobody
// signs in here. With only your own company it goes straight to its portal;
// otherwise it asks for the company's link, and can email it.
export default function PortalHome() {
  const [home, setHome] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [params] = useSearchParams();
  useEffect(() => {
    plainApi.get('/home').then(({ data }) => setHome(data)).catch(() => setHome({ slug: null, branding: {} }));
  }, []);

  if (!home) return null;
  if (home.slug) return <Navigate to={`/portal/${encodeURIComponent(home.slug)}`} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await plainApi.post('/link', { email: email.trim() }); } catch { /* same answer either way */ }
    setBusy(false);
    setSent(true);
  };
  const name = home.branding?.appName || 'PRISM';
  return (
    <div className="min-h-screen px-4 py-6 sm:py-12" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="mx-auto flex max-w-[440px] flex-col gap-6">
        <div className="flex min-w-0 items-center gap-2.5 text-[17px] font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {home.branding?.logoUrl ? <img src={home.branding.logoUrl} alt="" className="h-7 w-7 flex-shrink-0 object-contain" /> : (
            <span aria-hidden="true" className="h-7 w-7 flex-shrink-0 rounded-lg" style={{ backgroundColor: 'var(--color-accent)' }} />
          )}
          <span className="truncate">{name}</span>
          <span className="hidden flex-shrink-0 text-sm font-medium sm:inline" style={{ color: 'var(--color-text-muted)' }}>· Support</span>
        </div>
        <div className="card flex flex-col gap-4 p-6 sm:p-7">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Use your company&apos;s portal link</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Each company has its own portal. Open the link your IT help desk sent you, or the one in any email about your tickets.
          </p>
          {params.get('refused') && <Notice tone="warn">Sign-in didn&apos;t finish. Open your company&apos;s portal link and try again.</Notice>}
          <form onSubmit={submit} className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <label htmlFor="link-email" className="label">Can&apos;t find it? Enter your work email</label>
            <input id="link-email" className="input h-12" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button type="submit" disabled={busy} className="btn-primary h-12 justify-center">Email me my link</button>
            {sent ? (
              <div role="status" className="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm" style={{ backgroundColor: 'var(--color-timer-bg)', color: 'var(--color-text-primary)' }}>
                <IconCircleCheck size={18} aria-hidden="true" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-timer)' }} />
                <span>Check your email. If that address has portal access, its link is on its way.</span>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>If that address has portal access, we&apos;ll email its link. This page says the same thing either way.</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
