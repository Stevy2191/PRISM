import { useEffect, useState } from 'react';
import api from '../../api/api';
import { useCompanySummary } from '../../context/CompanyContext';

// A site of one company. Hidden while company UI is off. Inactive sites are
// left out unless one is the current value (which must still render).
export default function SitePicker({ companyId, value, onChange, disabled = false, className = 'input', style }) {
  const { multiCompany } = useCompanySummary();
  const [sites, setSites] = useState([]);
  useEffect(() => {
    if (!multiCompany || !companyId) {
      setSites([]);
      return;
    }
    api.get(`/companies/${companyId}/sites`).then(({ data }) => setSites(data.sites)).catch(() => setSites([]));
  }, [multiCompany, companyId]);
  if (!multiCompany || !companyId) return null;
  const shown = sites.filter((s) => s.status === 'active' || String(s.id) === String(value));
  return (
    <select aria-label="Site" className={className} style={style} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">No site</option>
      {shown.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
