import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Notice from '../ui/Notice';
import StatusChip from '../ui/StatusChip';

// Mockup CompanyM365: the company's Microsoft 365 tenant, approval, sync,
// sync groups and detected departments (client portal 7b). Shown to staff
// with portal.manage.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (iso) => new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const MUTED = { color: 'var(--color-text-muted)' };

function Section({ title, hint, action, children }) {
  return (
    <section aria-label={title} className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-navy-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm" style={MUTED}>{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tenant({ company, m365, onSaved }) {
  const [tenantId, setTenantId] = useState(m365.tenantId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = tenantId.trim().toLowerCase() !== (m365.tenantId || '');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/companies/${company.id}/m365`, { tenantId: tenantId.trim() || null });
      onSaved(data.m365);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  const approve = async () => {
    setError('');
    try {
      const { data } = await api.get(`/companies/${company.id}/m365/consent-url`);
      window.location.assign(data.url);
    } catch (err) { setError(errMessage(err)); }
  };
  let chip = null;
  if (m365.tenantId) chip = m365.consentAt ? <StatusChip tone="good">Approved</StatusChip> : <StatusChip tone="waiting">Waiting for approval</StatusChip>;
  return (
    <Section title="Microsoft 365 tenant" hint="Who's in this company comes from their Microsoft 365." action={chip}>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
        <label htmlFor="m365-tenant" className="text-sm font-medium text-navy-700">Tenant ID</label>
        <div className="flex min-w-0 gap-2">
          <input
            id="m365-tenant"
            className="input h-9 min-w-0 flex-1 font-mono text-sm"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
          <button type="button" disabled={busy || !dirty || (tenantId.trim() && !GUID.test(tenantId.trim()))} onClick={save} className="btn-primary h-9 flex-shrink-0 px-3 text-sm">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {m365.tenantId && (
          <>
            <span className="text-sm font-medium text-navy-700">Approval</span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span style={MUTED}>{m365.consentAt ? `Approved by a Microsoft 365 admin on ${when(m365.consentAt)}` : 'A Microsoft 365 admin of this tenant approves PRISM once.'}</span>
              <button type="button" onClick={approve} className="btn-secondary h-8 px-3 text-sm">{m365.consentAt ? 'Approve again' : 'Approve PRISM for this tenant'}</button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function LastSync({ lastSync }) {
  if (!lastSync) return <p className="text-sm" style={MUTED}>Not synced yet.</p>;
  const stats = [
    [lastSync.updated, 'contacts updated'], [lastSync.deactivated, 'made inactive'],
    [lastSync.newDetected, 'new detected departments'], [lastSync.errors.length, 'errors'],
  ];
  return (
    <div className="space-y-3" aria-label="Last sync">
      <p className="text-sm" style={MUTED}>Last sync {when(lastSync.at)} · took {Math.max(1, Math.round(lastSync.durationMs / 1000))} s</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([n, label]) => (
          <div key={label} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <dd className="text-xl font-semibold text-navy-900">{n}</dd>
            <dt className="text-xs" style={MUTED}>{label}</dt>
          </div>
        ))}
      </dl>
      {lastSync.errors.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--color-danger)' }}>
          {lastSync.errors.map((e) => <li key={e} className="break-words">{e}</li>)}
        </ul>
      )}
    </div>
  );
}

function Sync({ company, m365, onSynced }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/companies/${company.id}/m365/sync`);
      onSynced(data.lastSync);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Section
      title="Sync"
      hint="Every night, and when you press Sync now. Only updates existing contacts."
      action={<button type="button" disabled={busy || !m365.syncGroups.length} onClick={run} className="btn-primary h-9 px-4 text-sm">{busy ? 'Syncing…' : 'Sync now'}</button>}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      <LastSync lastSync={m365.lastSync} />
    </Section>
  );
}

function SyncGroups({ company, m365, onSaved }) {
  const [groups, setGroups] = useState(m365.syncGroups);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(groups.map((g) => g.id)) !== JSON.stringify(m365.syncGroups.map((g) => g.id));
  const search = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.get(`/companies/${company.id}/m365/groups`, { params: { q } });
      setResults(data.groups);
    } catch (err) { setError(errMessage(err)); setResults(null); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/companies/${company.id}/m365`, { tenantId: m365.tenantId, syncGroups: groups });
      onSaved(data.m365);
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Section
      title="Sync groups"
      hint="Only members of these Microsoft 365 groups can sign in to the portal or be synced. Leave service accounts out."
      action={dirty && <button type="button" disabled={busy} onClick={save} className="btn-primary h-9 px-4 text-sm">{busy ? 'Saving…' : 'Save groups'}</button>}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      <ul className="flex flex-wrap gap-2" aria-label="Chosen sync groups">
        {groups.length === 0 && <li className="text-sm" style={MUTED}>No groups yet: nobody from this tenant can sign in.</li>}
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm" style={{ borderColor: 'var(--color-border)' }}>
            {g.name}
            <button type="button" aria-label={`Remove ${g.name}`} onClick={() => setGroups(groups.filter((x) => x.id !== g.id))} className="ml-1 px-1" style={MUTED}>×</button>
          </li>
        ))}
      </ul>
      <form onSubmit={search} className="flex min-w-0 gap-2">
        <input aria-label="Find a group" className="input h-9 min-w-0 flex-1 text-sm" placeholder="Find a Microsoft 365 group" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn-secondary h-9 flex-shrink-0 px-3 text-sm">Search</button>
      </form>
      {results && (
        <ul className="divide-y rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)' }} aria-label="Groups found">
          {results.length === 0 && <li className="p-3" style={MUTED}>No groups found.</li>}
          {results.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0 break-words">{g.name}</span>
              <button
                type="button"
                disabled={groups.some((x) => x.id === g.id)}
                onClick={() => setGroups([...groups, g])}
                className="btn-secondary h-8 flex-shrink-0 px-3 text-sm"
              >
                {groups.some((x) => x.id === g.id) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DetectedRow({ company, row, departments, onDone }) {
  const [target, setTarget] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggested = departments.find((d) => d.id === row.suggestedDepartmentId);
  const act = async (path, body) => {
    setBusy(true); setError('');
    try {
      await api.post(`/companies/${company.id}/m365/detected-departments/${row.id}/${path}`, body);
      await onDone();
    } catch (err) { setError(errMessage(err)); setBusy(false); }
  };
  return (
    <tr className="align-top">
      <td className="py-3 pr-3 font-medium text-navy-900">{row.name}</td>
      <td className="whitespace-nowrap py-3 pr-3" style={MUTED}>{row.peopleCount} {row.peopleCount === 1 ? 'person' : 'people'}</td>
      <td className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {suggested && (
            <>
              <span className="text-sm" style={MUTED}>Looks like <strong>{suggested.name}</strong></span>
              <button type="button" disabled={busy} onClick={() => act('map', { departmentId: suggested.id })} className="btn-primary h-8 px-3 text-sm">Map</button>
            </>
          )}
          {!suggested && departments.length > 0 && (
            <>
              <select aria-label={`Map ${row.name} to`} className="input h-8 w-auto text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Map to…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button type="button" disabled={busy || !target} onClick={() => act('map', { departmentId: Number(target) })} className="btn-secondary h-8 px-3 text-sm">Map</button>
            </>
          )}
          {company.isInternal && (
            <input aria-label={`Short code for ${row.name}`} className="input h-8 w-24 text-sm uppercase" placeholder="Code" maxLength={10} value={shortCode} onChange={(e) => setShortCode(e.target.value)} />
          )}
          <button
            type="button"
            disabled={busy || (company.isInternal && !shortCode.trim())}
            onClick={() => act('create', company.isInternal ? { shortCode } : {})}
            className="btn-secondary h-8 px-3 text-sm"
          >
            Create department
          </button>
        </div>
        {error && <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      </td>
    </tr>
  );
}

function DetectedDepartments({ company, version }) {
  const [rows, setRows] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [d, deps] = await Promise.all([
        api.get(`/companies/${company.id}/m365/detected-departments`),
        api.get('/departments', { params: { companyId: company.id } }),
      ]);
      setRows(d.data.detected);
      setDepartments(deps.data.departments);
    } catch (err) { setError(errMessage(err)); }
  }, [company.id]);
  useEffect(() => { load(); }, [load, version]);
  return (
    <Section
      title="Detected departments"
      hint="Department names from Microsoft 365 that don't match a department here yet. People with these names have no department until you create or map them. Spelling differences are worth fixing in AD too."
    >
      {error && <Notice tone="bad">{error}</Notice>}
      {rows === null && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-sm" style={MUTED}>Nothing to sort out.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs" style={MUTED}>
                <th className="pb-2 pr-3 font-medium">Name in Microsoft 365</th>
                <th className="pb-2 pr-3 font-medium">People</th>
                <th className="pb-2 font-medium">What to do</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {rows.map((row) => <DetectedRow key={row.id} company={company} row={row} departments={departments} onDone={load} />)}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export default function CompanyMicrosoft365({ company, notice }) {
  const [m365, setM365] = useState(null);
  const [error, setError] = useState('');
  const [syncs, setSyncs] = useState(0);
  useEffect(() => {
    api.get(`/companies/${company.id}/m365`).then(({ data }) => setM365(data.m365)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!m365) return <Spinner />;
  return (
    <div className="space-y-5">
      {notice === 'approved' && <Notice tone="info">Thanks: the approval is recorded once PRISM first reads this tenant (search for a group, or Sync now).</Notice>}
      {notice === 'not_approved' && <Notice tone="bad">Microsoft says PRISM wasn&apos;t approved for this tenant.</Notice>}
      <Tenant key={`t-${m365.tenantId}`} company={company} m365={m365} onSaved={setM365} />
      {m365.tenantId && (
        <>
          <Sync company={company} m365={m365} onSynced={(lastSync) => { setM365({ ...m365, lastSync }); setSyncs((n) => n + 1); }} />
          <SyncGroups key={`g-${m365.tenantId}-${m365.syncGroups.map((g) => g.id).join()}`} company={company} m365={m365} onSaved={setM365} />
          <DetectedDepartments company={company} version={syncs} />
        </>
      )}
    </div>
  );
}
