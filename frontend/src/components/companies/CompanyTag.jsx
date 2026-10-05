import { useCompanySummary } from '../../context/CompanyContext';

// " · Acme" after a contact's name, while company UI is on.
export default function CompanyTag({ company }) {
  const { multiCompany } = useCompanySummary();
  if (!multiCompany || !company) return null;
  return <span className="text-xs" style={{ color: 'var(--color-muted)' }}> · {company.name}</span>;
}
