import { useEffect } from 'react';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// The company a new record belongs to. Hidden while company UI is off (the
// record then goes to the internal company). When nothing is chosen yet it
// picks the internal company, or the user's first company if they can't
// reach the internal one, so the form never submits a blank it can't save.
export default function CompanyPicker({ value, onChange, label = 'Company', disabled = false, style }) {
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  useEffect(() => {
    if (!multiCompany || value || !companies.length) return;
    const fallback = companies.find((c) => c.isInternal) || companies[0];
    onChange(String(fallback.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiCompany, value, companies]);
  if (!multiCompany) return null;
  return (
    <div>
      <label className="label" htmlFor="company-picker">{label}</label>
      <select id="company-picker" className="input" style={style} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isInternal ? ' (internal)' : ''}</option>)}
      </select>
    </div>
  );
}
