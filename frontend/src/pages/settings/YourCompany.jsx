// Settings › Your company (CS): your own company's one page. The same parts
// a customer company has on its page, plus what only yours has: the profile
// (name, app name, time zone, logo) and the staff sign-in page. Your company
// is not in the Companies list; its links lead here.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Notice from '../../components/ui/Notice';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import CompanyProfile from './CompanyProfile';
import AdminDepartments from '../AdminDepartments';
import CompanySites from '../../components/companies/CompanySites';
import CompanySla from '../../components/companies/CompanySla';
import CompanyCategories from '../../components/companies/CompanyCategories';
import CompanyDevices from '../../components/companies/CompanyDevices';
import CompanyNotices from '../../components/companies/CompanyNotices';
import CompanyPortal from '../../components/companies/CompanyPortal';
import CompanySurveys from '../../components/companies/CompanySurveys';

// Parts in menu order; `can` says who sees each.
const PARTS = [
  ['profile', 'Profile and sign-in page', (p) => p('settings.manage_branding') || p('settings.manage_system')],
  ['departments', 'Departments', (p) => p('people.manage_departments')],
  ['sites', 'Sites', (p) => p('companies.view')],
  ['sla', 'Support hours, holidays and SLA', (p) => p('companies.view')],
  ['categories', 'Categories', (p) => p('tickets.categories.manage')],
  ['devices', 'Devices', (p) => p('assets.view')],
  ['notices', 'Agent notices', (p) => p('devices.manage') || p('portal.manage')],
  ['portal', 'Portal', (p) => p('companies.view')],
  ['surveys', 'Surveys', (p) => p('companies.view')],
];

export default function YourCompany() {
  const { hasPermission } = useAuth();
  const { internalId } = useCompanySummary();
  const [params, setParams] = useSearchParams();
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!internalId) return;
    api.get(`/companies/${internalId}`).then(({ data }) => setCompany(data.company)).catch((err) => setError(errMessage(err)));
  }, [internalId]);

  const parts = PARTS.filter(([, , can]) => can(hasPermission));
  const asked = params.get('part');
  const part = parts.some(([k]) => k === asked) ? asked : parts[0]?.[0];
  // The profile works from settings alone; the other parts need the company.
  const needsCompany = part !== 'profile' && part !== 'departments';

  return (
    <div className="space-y-5">
      <header>
        <Breadcrumbs className="mb-1" items={[{ label: 'Settings', to: '/settings' }, { label: 'Your company', current: true }]} />
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="page-title">{company?.name || 'Your company'}</h1>
          <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: 'var(--color-success-bg, #E5F5EC)', color: 'var(--color-success-ink, #14603A)' }}>Your company</span>
        </div>
        <p className="mt-1 text-sm text-navy-500">Everything about your own organization. Customers each have a page like this one, under Companies.</p>
      </header>

      {parts.length > 1 && (
        <nav aria-label="Your company's settings" className="flex flex-wrap gap-2">
          {parts.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setParams(key === parts[0][0] ? {} : { part: key }, { replace: true })}
              aria-pressed={part === key}
              className="rounded-full border px-3 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:min-h-[40px]"
              style={part === key
                ? { backgroundColor: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }
                : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {error && <Notice tone="bad">{error}</Notice>}
      {!parts.length && <Notice tone="info">Nothing here is yours to change.</Notice>}
      {part === 'profile' && <CompanyProfile embedded onSaved={() => internalId && api.get(`/companies/${internalId}`).then(({ data }) => setCompany(data.company)).catch(() => {})} />}
      {part === 'departments' && <AdminDepartments embedded />}
      {needsCompany && !company && !error && <Spinner />}
      {needsCompany && company && (
        <>
          {part === 'sites' && <CompanySites company={company} />}
          {part === 'sla' && <CompanySla base={`/companies/${company.id}/sla`} who="your company" />}
          {part === 'categories' && <CompanyCategories company={company} />}
          {part === 'devices' && <CompanyDevices company={company} />}
          {part === 'notices' && <CompanyNotices company={company} />}
          {part === 'portal' && <CompanyPortal company={company} m365Notice={params.get('m365')} />}
          {part === 'surveys' && <CompanySurveys company={company} />}
        </>
      )}
    </div>
  );
}
