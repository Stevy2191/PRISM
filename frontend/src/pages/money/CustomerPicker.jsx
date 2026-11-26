// Picks a customer company by name (Phase 3 billing).
import { useEffect, useState } from 'react';
import api from '../../api/api';

export default function CustomerPicker({ value, onChange, label = 'Customer', required = false, allowAll = false }) {
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    api.get('/companies', { params: { kind: 'client', limit: 'all' } }).then(({ data }) => setCompanies(data.companies || [])).catch(() => {});
  }, []);
  return (
    <label className="text-sm">{label}
      <select className="input mt-1" aria-label={label} required={required} value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{allowAll ? 'All customers' : 'Choose…'}</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}
