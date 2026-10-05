import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

// "All companies" filter for list pages. Renders nothing while company UI is off.
export default function CompanyFilter({ value, onChange, className = 'input h-9 flex-shrink-0 text-sm', style }) {
  const { multiCompany } = useCompanySummary();
  const companies = useCompanyOptions();
  if (!multiCompany) return null;
  return (
    <select aria-label="Company" value={value} onChange={(e) => onChange(e.target.value)} className={className} style={{ maxWidth: '12rem', ...style }}>
      <option value="">All companies</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
