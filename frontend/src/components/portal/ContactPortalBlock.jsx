import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import Switch from '../Switch';

const SIGN_IN = { password: 'Email and password', microsoft: 'Microsoft' };

// Mockup ContactPortal: the contact's "Support portal" block. Changing
// access or sending an invite needs portal.manage; others see it read-only.
export default function ContactPortalBlock({ contact, onChanged }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('portal.manage');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const adminOf = [
    ...(contact.adminOf?.company ? ['The whole company'] : []),
    ...(contact.adminOf?.departments || []).map((d) => `${d.name} department`),
  ];

  const run = async (fn, done) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await fn();
      if (done) setMessage(done);
      await onChanged();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (on) => run(() => api.patch(`/contacts/${contact.id}`, { portalAccess: on }));
  const invite = () => run(() => api.post(`/contacts/${contact.id}/portal-invite`), `Invite sent to ${contact.email}.`);

  const MUTED = { color: 'var(--color-text-muted)' };
  return (
    <section aria-label="Support portal" className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
      <p className="text-xs font-semibold" style={MUTED}>Support portal</p>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Portal access</div>
          <div className="text-xs" style={MUTED}>{contact.portalAccess ? 'Can sign in to the support portal.' : 'Off until the invite is sent.'}</div>
        </div>
        <Switch checked={!!contact.portalAccess} disabled={!canManage || busy} onChange={toggle} label={`Portal access for ${contact.displayName}`} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt style={MUTED}>Signs in with</dt>
        <dd>{SIGN_IN[contact.signInMethod] || 'Not set up yet'}</dd>
        {contact.portalLastSignInAt && (
          <>
            <dt style={MUTED}>Last sign-in</dt>
            <dd>{new Date(contact.portalLastSignInAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
          </>
        )}
        <dt style={MUTED}>Admin of</dt>
        <dd className="break-words">{adminOf.length ? adminOf.join(', ') : 'None'}</dd>
      </dl>
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p role="status" className="text-xs" style={{ color: 'var(--color-timer)' }}>{message}</p>}
      {canManage && contact.email && contact.status !== 'inactive' && (
        <div className="space-y-1.5">
          <button type="button" disabled={busy} onClick={invite} className="btn-secondary h-9 w-full justify-center text-sm max-sm:h-11">
            {contact.signInMethod ? 'Send a new portal invite' : 'Send portal invite'}
          </button>
          <p className="break-words text-xs" style={MUTED}>Emails {contact.email} a link to set a password. Sending it turns portal access on.</p>
        </div>
      )}
    </section>
  );
}
