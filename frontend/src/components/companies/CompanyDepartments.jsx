import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';

// Departments tab: the company's own departments. Client departments need
// companies.manage; internal ones need people.manage_departments and a
// short code (they own projects).
export default function CompanyDepartments({ company }) {
  const { hasPermission } = useAuth();
  const canAdd = company.isInternal ? hasPermission('people.manage_departments') : hasPermission('companies.manage');
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
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <ul className="space-y-1 text-sm">
        {departments.map((d) => <li key={d.id}>{d.name}{d.shortCode ? <span className="ml-2 font-mono text-xs">{d.shortCode}</span> : null}</li>)}
        {!departments.length && <li style={{ color: 'var(--color-muted)' }}>No departments yet.</li>}
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
