// A company's own portal (CS part 3), on its page under Setup › Portal: the
// switch, its link (and changing it; the old one keeps working), who can
// sign in with invites, its portal admins, and Microsoft 365 sign-in.
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Switch from '../Switch';
import Notice from '../ui/Notice';
import Button from '../ui/Button';
import { CompanyAdmins } from './CompanyDepartments';
import CompanyMicrosoft365 from './CompanyMicrosoft365';

const MUTED = { color: 'var(--color-text-muted)' };
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

function LinkRow({ data, canManage, onSave }) {
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(data.portal.slug || '');
  const [copied, setCopied] = useState(false);
  const base = data.portal.url.slice(0, data.portal.url.length - encodeURIComponent(data.portal.slug || '').length);
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.portal.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  if (editing) {
    return (
      <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await onSave({ slug })) setEditing(false); }}>
        <span className="text-sm" style={MUTED}>{base}</span>
        <input aria-label="Portal link name" className="input h-9 w-48 min-w-0 font-mono text-sm" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        <Button size="sm" variant="primary" type="submit" disabled={!slug.trim()}>Save</Button>
        <Button size="sm" variant="quiet" onClick={() => { setEditing(false); setSlug(data.portal.slug); }}>Cancel</Button>
      </form>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input readOnly aria-label="Portal link" value={data.portal.url} className="input h-9 min-w-0 flex-1 font-mono text-sm sm:max-w-md" />
      <Button size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      {canManage && <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>Change the name</Button>}
    </div>
  );
}

function SignsIn({ c, open, canManage, onInvite, onRemove, busy }) {
  if (!c.email) return <span style={MUTED}>Needs an email first</span>;
  if (c.portalAccess && c.signInMethod) {
    return (
      <span className="flex items-center gap-2">
        <span>{c.signInMethod === 'microsoft' ? 'Microsoft' : 'Password'}</span>
        {canManage && <Button size="sm" variant="quiet" disabled={busy} onClick={() => onRemove(c)} aria-label={`Remove ${c.name}'s access`}>Remove</Button>}
      </span>
    );
  }
  if (c.portalAccess && c.invitedAt) {
    return (
      <span className="flex items-center gap-2">
        <span>Invited {day(c.invitedAt)}</span>
        {canManage && open && <Button size="sm" variant="quiet" disabled={busy} onClick={() => onInvite(c)} aria-label={`Send ${c.name}'s invite again`}>Send again</Button>}
      </span>
    );
  }
  if (!canManage || !open) return <span style={MUTED}>{c.portalAccess ? 'Not signed in yet' : 'No access'}</span>;
  return <Button size="sm" disabled={busy} onClick={() => onInvite(c)} aria-label={`Invite ${c.name}`}>Invite</Button>;
}

export default function CompanyPortal({ company, m365Notice }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/companies/${company.id}/portal`;

  const load = useCallback(() => {
    api.get(base).then(({ data: d }) => setData(d)).catch((err) => setError(errMessage(err)));
  }, [base]);
  useEffect(load, [load]);

  const run = async (fn, done) => {
    setBusy(true); setError(''); setNote('');
    try {
      const res = await fn();
      if (res?.data?.portal) setData(res.data);
      else load();
      if (done) setNote(typeof done === 'function' ? done(res?.data) : done);
      return true;
    } catch (err) {
      setError(errMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const { portal, contacts, canManage } = data;
  const withAccess = contacts.filter((c) => c.portalAccess).length;
  const invitable = contacts.filter((c) => !c.portalAccess && c.email && c.signInMethod !== 'microsoft').length;
  const name = company.isInternal ? 'Your company' : company.name;
  const whose = company.isInternal ? 'your company' : company.name;

  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      {note && <Notice tone="info">{note}</Notice>}

      <section aria-label="Portal" className="card divide-y divide-navy-100">
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="font-semibold text-navy-900">{company.isInternal ? 'Your company\'s portal' : `${company.name}'s portal`}</p>
            <p className="text-xs" style={MUTED}>Where {whose}&apos;s people raise and follow their tickets.</p>
          </div>
          <span className="flex items-center gap-2 text-sm font-medium">
            {portal.enabled ? 'On' : 'Off'}
            <Switch checked={portal.enabled} disabled={!canManage || busy} label="Portal on" onChange={(on) => run(() => api.put(base, { enabled: on }))} />
          </span>
        </div>
        <div className="space-y-2 p-5">
          <p className="text-sm font-semibold text-navy-900">{company.isInternal ? 'Its own link' : `${name}'s own link`}</p>
          <LinkRow key={portal.slug} data={data} canManage={canManage} onSave={(body) => run(() => api.put(base, body), 'Saved. The old link keeps working.')} />
          <p className="text-xs" style={MUTED}>
            Only {whose}&apos;s contacts can sign in here. Someone from another company is told &ldquo;wrong email or password&rdquo;, and nothing else.
            {portal.previousSlugs.length > 0 && ` Older links still work: ${portal.previousSlugs.join(', ')}.`}
          </p>
          {company.status !== 'active' && <Notice tone="warn">{company.name} is inactive, so nobody can sign in here until it is active again.</Notice>}
          <p className="text-xs" style={MUTED}>Turning this off{company.isInternal ? '' : `, or marking ${company.name} inactive,`} stops every one of its contacts signing in at once.</p>
        </div>
      </section>

      <section aria-label="Who can sign in" className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-navy-900">Who can sign in</h3>
            <p className="text-xs" style={MUTED}>{withAccess} of {contacts.length} contact{contacts.length === 1 ? '' : 's'}</p>
          </div>
          {canManage && portal.open && invitable > 0 && (
            <Button size="sm" disabled={busy} onClick={() => run(() => api.post(`${base}/invite-all`), (d) => `${d.invited} invite${d.invited === 1 ? '' : 's'} sent${d.failed?.length ? `; ${d.failed.length} could not be sent` : ''}.`)}>
              Invite everyone without access
            </Button>
          )}
        </div>
        {!portal.open && canManage && <p className="px-5 py-3 text-sm" style={MUTED}>Turn the portal on to send invites.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-navy-400">
                <th className="px-5 py-2 font-semibold">Contact</th>
                <th className="px-3 py-2 font-semibold">Department</th>
                <th className="px-3 py-2 font-semibold">Last signed in</th>
                <th className="px-3 py-2 font-semibold">Signs in with</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2"><span className="font-semibold">{c.name}</span>{c.email && <span className="block text-xs" style={MUTED}>{c.email}</span>}</td>
                  <td className="px-3 py-2">{c.department || '—'}</td>
                  <td className="px-3 py-2">{c.lastSignInAt ? day(c.lastSignInAt) : 'Never'}</td>
                  <td className="px-3 py-2">
                    <SignsIn
                      c={c}
                      open={portal.open}
                      canManage={canManage}
                      busy={busy}
                      onInvite={(x) => run(() => api.post(`/contacts/${x.id}/portal-invite`), `Invite sent to ${x.email}.`)}
                      onRemove={(x) => run(() => api.patch(`/contacts/${x.id}`, { portalAccess: false }), `${x.name} can no longer sign in.`)}
                    />
                  </td>
                </tr>
              ))}
              {!contacts.length && <tr><td colSpan={4} className="px-5 py-3" style={MUTED}>No active contacts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {!company.isInternal && (
        <section aria-label="Portal admins" className="space-y-3">
          <CompanyAdmins company={company} canEdit={canManage} onError={setError} />
          {data.departmentAdmins.length > 0 && (
            <div className="card p-4 text-sm sm:p-5">
              <p className="font-semibold text-navy-900">Department admins</p>
              <ul className="mt-1 space-y-0.5">
                {data.departmentAdmins.map((a) => <li key={`${a.departmentId}-${a.contactId}`}>{a.name} <span style={MUTED}>· {a.department}&apos;s tickets</span></li>)}
              </ul>
              <p className="mt-2 text-xs" style={MUTED}>Set on People › Departments.</p>
            </div>
          )}
        </section>
      )}

      {canManage && <CompanyMicrosoft365 company={company} notice={m365Notice} />}
    </div>
  );
}
