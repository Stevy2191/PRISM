import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// "Company access" on a user or a role (spec: Users and roles). A user
// reaches every company or a chosen list; a role adds its list to everyone
// holding it. Only companies the viewer can reach are listed; the server
// keeps the rest when saving (plan 2a review R6).
export default function CompanyAccessPanel({ userId, roleId }) {
  const { hasPermission } = useAuth();
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  const allowed = hasPermission('companies.manage_access') && multiCompany;
  const url = userId ? `/users/${userId}/company-access` : `/roles/${roleId}/company-access`;
  const [access, setAccess] = useState(null);
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    api.get(url).then(({ data }) => {
      setAccess(data.access);
      setAll(userId ? data.access.allCompanies : false);
      setChosen(data.access.companyIds);
    }).catch((err) => setError(errMessage(err)));
  }, [allowed, url, userId]);

  if (!allowed) return null;
  if (!access) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  if (access.unfenceable) {
    return <div className="card p-4 text-sm">System Administrators always reach every company.</div>;
  }
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const save = async () => {
    setError('');
    setSaved(false);
    try {
      const body = userId ? { allCompanies: all, companyIds: all ? [] : chosen } : { companyIds: chosen };
      const { data } = await api.put(url, body);
      setAccess(data.access);
      setChosen(data.access.companyIds);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="card mt-5 space-y-3 p-5">
      <p className="eyebrow">Company access</p>
      {roleId && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Everyone with this role also reaches these companies.</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {userId && (
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="company-access" checked={all} onChange={() => setAll(true)} /> All companies</label>
          <label className="flex items-center gap-2"><input type="radio" name="company-access" checked={!all} onChange={() => setAll(false)} /> Chosen companies</label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {companies.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" disabled={userId && all} checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save}>Save company access</button>
        {saved && <span className="text-sm" style={{ color: 'var(--color-success)' }}>Company access saved</span>}
      </div>
    </div>
  );
}
