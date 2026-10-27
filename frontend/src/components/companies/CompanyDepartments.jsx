import { useCallback, useEffect, useState } from 'react';
import Notice from '../ui/Notice';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import ContactPicker from '../portal/ContactPicker';
import AdminChips from '../portal/AdminChips';

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

function CompanyAdmins({ company, canEdit, onError }) {
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
  // Portal admins are a client-company idea; the internal company's people are staff.
  const portalAdmins = !company.isInternal;
  const [departments, setDepartments] = useState([]);
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get('/departments', { params: { companyId: company.id } }).then(({ data }) => setDepartments(data.departments)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/departments', { name, companyId: company.id, ...(company.isInternal ? { shortCode } : {}) });
      setName('');
      setShortCode('');
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {portalAdmins && <CompanyAdmins company={company} canEdit={canManagePortal} onError={setError} />}
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
          </li>
        ))}
        {!departments.length && <li style={{ color: 'var(--color-text-muted)' }}>No departments yet.</li>}
      </ul>
      {canAdd && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input aria-label="Department name" className="input h-9 text-sm" placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} />
          {company.isInternal && <input aria-label="Short code" className="input h-9 w-28 text-sm uppercase" placeholder="Code" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} />}
          <button type="submit" className="btn-secondary h-9 px-3 text-sm" disabled={!name.trim()}>Add department</button>
        </form>
      )}
    </div>
  );
}
