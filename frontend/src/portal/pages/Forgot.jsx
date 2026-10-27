import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconCircleCheck } from '@tabler/icons-react';
import portalApi from '../api';
import AccountCard from './AccountCard';

// The same answer whatever the email: nothing here says whether it exists.
export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await portalApi.post('/auth/forgot', { email: email.trim() }); } catch { /* same answer either way */ }
    setBusy(false);
    setSent(true);
  };
  return (
    <AccountCard caption="Forgot password" title="Reset your password">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Enter the email you sign in with. If it&apos;s set up for the portal, we&apos;ll send a link to choose a new password.</p>
        <div>
          <label htmlFor="forgot-email" className="label">Email</label>
          <input id="forgot-email" className="input h-12" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <button type="submit" disabled={busy} className="btn-primary h-12 justify-center">Send link</button>
        {sent && (
          <div role="status" className="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm" style={{ backgroundColor: 'var(--color-timer-bg)', color: 'var(--color-text-primary)' }}>
            <IconCircleCheck size={18} aria-hidden="true" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-timer)' }} />
            <span>Check your email. If that address can use the portal, a link is on its way.</span>
          </div>
        )}
        <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          <Link to="/portal/sign-in" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Back to sign in</Link>
        </p>
      </form>
    </AccountCard>
  );
}
