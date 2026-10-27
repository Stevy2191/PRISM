import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import portalApi, { errMessage } from '../api';
import { usePortalAuth } from '../PortalAuth';
import AccountCard from './AccountCard';
import Notice from '../../components/ui/Notice';

// The invite page (kind 'invite': set up your account) and the reset page
// (kind 'reset'). Both set a password from an emailed one-time link and sign
// the contact in.
export default function SetPassword({ kind }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { setMe } = usePortalAuth();
  const [who, setWho] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const invite = kind === 'invite';

  useEffect(() => {
    if (!invite) return;
    portalApi.post('/auth/invite/check', { token })
      .then(({ data }) => setWho(data))
      .catch((err) => setLinkError(errMessage(err, 'This link is invalid or has expired.')));
  }, [invite, token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('The two passwords don’t match.'); return; }
    setBusy(true);
    try {
      const { data } = await portalApi.post(invite ? '/auth/invite/accept' : '/auth/reset', { token, password });
      setMe(data.contact);
      navigate('/portal/tickets', { replace: true });
    } catch (err) {
      setError(errMessage(err, 'Could not save your password.'));
    } finally {
      setBusy(false);
    }
  };

  if (linkError) {
    return (
      <AccountCard caption={invite ? 'From the invite email' : 'Password reset'} title="This link can't be used">
        <Notice tone="bad">{linkError}</Notice>
        <Link to="/portal/forgot" className="btn-secondary h-11 justify-center">Send me a new link</Link>
      </AccountCard>
    );
  }
  return (
    <AccountCard caption={invite ? 'From the invite email' : 'Password reset'} title={invite ? 'Set up your account' : 'Choose a new password'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {invite && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {who?.companyName ? `${who.companyName}'s` : 'Your'} help desk invited you to the support portal. Choose a password to finish.
          </p>
        )}
        {invite && (
          <div>
            <label htmlFor="sp-email" className="label">Email</label>
            <input id="sp-email" className="input h-12" value={who?.email || ''} readOnly style={{ color: 'var(--color-text-secondary)' }} />
          </div>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        <div>
          <label htmlFor="sp-password" className="label">Password</label>
          <input id="sp-password" className="input h-12" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>At least 12 characters.</p>
        </div>
        <div>
          <label htmlFor="sp-confirm" className="label">Confirm password</label>
          <input id="sp-confirm" className="input h-12" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <button type="submit" disabled={busy} className="btn-primary h-12 justify-center">{invite ? 'Create account' : 'Save password'}</button>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>This link works once and expires in 3 days.</p>
      </form>
    </AccountCard>
  );
}
