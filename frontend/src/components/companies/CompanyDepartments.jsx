import { useCallback, useEffect, useState } from 'react';
import Notice from '../ui/Notice';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import ContactPicker from '../portal/ContactPicker';
import AdminChips from '../portal/AdminChips';
import { suggestCode, cleanCode } from '../../utils/codes';

// Client portal (7a): a department's admins see all of its tickets in the
// portal. Read for anyone who sees the tab; changed with portal.manage.
function DepartmentAdmins({ department, companyId, canEdit, onError }) {
  const [admins, setAdmins] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    api.get(`/departments/${department.id}/portal-admins`).then(({ data }) => setAdmins(data.contacts)).catch(() => setAdmins([]));
  }, [department.id]);
  useEffect(load, [load]);
  const save = async (ids) => {
    try {
      const { data } = await api.put(`/departments/${department.id}/portal-admins`, { contactIds: ids });
      setAdmins(data.contacts);
    } catch (err) { onError(errMessage(err)); }
  };
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <AdminChips contacts={admins} canEdit={canEdit} roleLabel={`${department.name} admin`} onRemove={(c) => save(admins.filter((a) => a.id !== c.id).map((a) => a.id))} />
      {canEdit && (adding ? (
        <span className="w-56"><ContactPicker autoFocus companyId={companyId} departmentId={department.id} exclude={admins.map((a) => a.id)} label={`Add a ${department.name} admin`} onPick={(c) => { setAdding(false); save([...admins.map((a) => a.id), c.id]); }} /></span>
      ) : (
        <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={() => setAdding(true)}>Add admin</button>
      ))}
    </span>
  );
}

// Also shown on the company's Setup › Portal (CS).
export function CompanyAdmins({ company, canEdit, onError }) {
  const [admins, setAdmins] = useState([]);
  const load = useCallback(() => {
    api.get(`/companies/${company.id}/portal-admins`).then(({ data }) => setAdmins(data.contacts)).catch(() => setAdmins([]));
  }, [company.id]);
  useEffect(load, [load]);
  const save = async (ids) => {
    try {
      const { data } = await api.put(`/companies/${company.id}/portal-admins`, { contactIds: ids });
      setAdmins(data.contacts);
    } catch (err) { onError(errMessage(err)); }
  };
  return (
    <section aria-labelledby="company-admins" className="card p-4 sm:p-5">
      <h2 id="company-admins" className="text-base font-semibold">Company admins</h2>
      <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>See every ticket from {company.name} in the portal.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AdminChips contacts={admins} canEdit={canEdit} roleLabel="company admin" onRemove={(c) => save(admins.filter((a) => a.id !== c.id).map((a) => a.id))} />
        {canEdit && <span className="w-60"><ContactPicker companyId={company.id} exclude={admins.map((a) => a.id)} label="Add a company admin" onPick={(c) => save([...admins.map((a) => a.id), c.id])} /></span>}
      </div>
    </section>
  );
}

// Departments tab: the company's own departments. Client departments need
// companies.manage; internal ones need people.manage_departments and a
// short code (they own projects).
export default function CompanyDepartments({ company }) {
  const { hasPermission } = useAuth();
  const canAdd = company.isInternal ? hasPermission('people.manage_departments') : hasPermission('companies.manage');
  const canManagePortal = hasPermission('portal.manage');
  // Phase 3: a department's people default to this support tier.
  const seesBilling = hasPermission('money.billing.view');
  // Portal admins are a client-company idea; the internal company's people are staff.
  const portalAdmins = !company.isInternal;
  const [departments, setDepartments] = useState([]);
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  // The code follows the name until someone types their own.
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get('/departments', { params: { companyId: company.id } }).then(({ data }) => setDepartments(data.departments)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/departments', { name, companyId: company.id, ...(shortCode ? { shortCode } : {}) });
      setName('');
      setShortCode('');
      setCodeTouched(false);
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  // Client departments live here only (Settings → Departments is the help
  // desk's own), so they're renamed and deleted here too.
  const rename = async (d) => {
    const next = window.prompt(`Rename "${d.name}" to:`, d.name);
    if (!next || !next.trim() || next.trim() === d.name) return;
    setError('');
    try { await api.patch(`/departments/${d.id}`, { name: next.trim() }); load(); } catch (err) { setError(errMessage(err)); }
  };
  // Every department has a code (CN): it sits in project numbers (WC-HR-P0007).
  const recode = async (d) => {
    const next = window.prompt(`Code for "${d.name}" (1 to 6 letters or digits):`, d.shortCode || '');
    if (next === null) return;
    const clean = cleanCode(next);
    if (!clean || clean === d.shortCode) return;
    setError('');
    try { await api.patch(`/departments/${d.id}`, { shortCode: clean }); load(); } catch (err) { setError(errMessage(err)); }
  };
  const remove = async (d) => {
    if (!window.confirm(`Delete the department "${d.name}"? Its contacts and assets stay, with no department.`)) return;
    setError('');
    try { await api.delete(`/departments/${d.id}`); load(); } catch (err) { setError(errMessage(err)); }
  };

  return (
    <div className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {portalAdmins && (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          A department&apos;s admins see all of that department&apos;s tickets in the portal. Admins come from the department&apos;s own contacts; moving to another department removes the role.
        </p>
      )}
      <ul className="space-y-1 text-sm">
        {departments.map((d) => (
          <li key={d.id} className={portalAdmins ? 'flex min-w-0 flex-col gap-2 border-b py-2.5 sm:flex-row sm:items-center sm:gap-4' : ''} style={portalAdmins ? { borderColor: 'var(--color-border)' } : undefined}>
            <span className={portalAdmins ? 'font-semibold sm:w-48 sm:flex-shrink-0' : ''}>{d.name}{d.shortCode ? <span className="ml-2 num text-xs">{d.shortCode}</span> : null}</span>
            {portalAdmins && <DepartmentAdmins department={d} companyId={company.id} canEdit={canManagePortal} onError={setError} />}
            {portalAdmins && seesBilling && (
              <label className="flex flex-shrink-0 items-center gap-1 text-xs">
                Support tier
                <select
                  className="input h-8 w-auto py-0 text-xs"
                  aria-label={`${d.name} support tier`}
                  disabled={!canAdd}
                  value={d.defaultSupportTier || 'full'}
                  onChange={async (e) => {
                    try { await api.patch(`/departments/${d.id}`, { defaultSupportTier: e.target.value }); load(); } catch (err) { setError(errMessage(err)); }
                  }}
                >
                  <option value="full">Full users</option>
                  <option value="light">Light users</option>
                  <option value="none">Not covered</option>
                </select>
              </label>
            )}
            {canAdd && (
              <span className={`flex flex-shrink-0 gap-3 ${portalAdmins ? 'sm:ml-auto' : 'ml-3'}`}>
                <button type="button" className="text-xs text-prism hover:underline" onClick={() => rename(d)} aria-label={`Rename ${d.name}`}>Rename</button>
                <button type="button" className="text-xs text-prism hover:underline" onClick={() => recode(d)} aria-label={`Change ${d.name}'s code`}>Code</button>
                <button type="button" className="text-xs hover:underline" style={{ color: 'var(--color-danger)' }} onClick={() => remove(d)} aria-label={`Delete ${d.name}`}>Delete</button>
              </span>
            )}
          </li>
        ))}
        {!departments.length && <li style={{ color: 'var(--color-text-muted)' }}>No departments yet.</li>}
      </ul>
      {canAdd && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input aria-label="Department name" className="input h-9 text-sm" placeholder="Department name" value={name} onChange={(e) => { setName(e.target.value); if (!codeTouched) setShortCode(suggestCode(e.target.value, { single: 3 })); }} />
          <input aria-label="Department code" className="input h-9 w-24 font-mono text-sm" placeholder="Code" value={shortCode} onChange={(e) => { setCodeTouched(true); setShortCode(cleanCode(e.target.value)); }} />
          <button type="submit" className="btn-secondary h-9 px-3 text-sm" disabled={!name.trim()}>Add department</button>
        </form>
      )}
    </div>
  );
}
