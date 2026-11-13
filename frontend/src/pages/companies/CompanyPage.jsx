import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Notice from '../../components/ui/Notice';
import StatusChip from '../../components/ui/StatusChip';
import CompanyGlance from '../../components/companies/CompanyGlance';
import CompanyOverview from '../../components/companies/CompanyOverview';
import CompanySites from '../../components/companies/CompanySites';
import CompanyDepartments from '../../components/companies/CompanyDepartments';
import CompanyCategories from '../../components/companies/CompanyCategories';
import CompanyRecordList from '../../components/companies/CompanyRecordList';
import CompanyMicrosoft365 from '../../components/companies/CompanyMicrosoft365';
import CompanyDevices from '../../components/companies/CompanyDevices';
import CompanyNotices from '../../components/companies/CompanyNotices';
import { CompanyFlags } from './CompaniesList';

// Five tabs; a tab with more than one part shows them as a second row.
// (Owner, 2026-11-13: ten tabs in a row was too many.)
const GROUPS = [
  ['overview', 'Overview', []],
  ['people', 'People', [['contacts', 'Contacts'], ['departments', 'Departments'], ['sites', 'Sites']]],
  ['work', 'Work', [['tickets', 'Tickets'], ['projects', 'Projects']]],
  ['assets', 'Assets', [['assets', 'Assets'], ['devices', 'Devices'], ['notices', 'Agent notices'], ['vendor', 'Vendor']]],
  ['setup', 'Setup', [['details', 'Details'], ['categories', 'Categories'], ['m365', 'Microsoft 365']]],
];

// A company's page (spec: Companies nav tab).
export default function CompanyPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  // ?m365=approved|not_approved: back from a tenant admin's approval.
  const [params] = useSearchParams();
  const m365Notice = params.get('m365');
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(m365Notice ? 'setup' : 'overview');
  // The part showing within each tab.
  const [parts, setParts] = useState(m365Notice ? { setup: 'm365' } : {});
  const load = useCallback(() => {
    api.get(`/companies/${id}`).then(({ data }) => setCompany(data.company)).catch((err) => setError(errMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!company) return <Spinner />;
  // Parts this viewer has: Microsoft 365 (7b) for staff who manage portal
  // access, Devices (the PRISM agent, 8a) for staff who see assets, each
  // client company's own ticket categories (9), Vendor for a vendor.
  const has = {
    m365: hasPermission('portal.manage'),
    devices: hasPermission('assets.view'),
    categories: (company.isClient || company.isInternal) && hasPermission('tickets.categories.manage'),
    vendor: company.isVendor,
    notices: hasPermission('devices.manage') || hasPermission('portal.manage'),
  };
  const groups = GROUPS.map(([key, label, subs]) => [key, label, subs.filter(([k]) => has[k] !== false)]);
  const subs = groups.find(([key]) => key === tab)[2];
  const part = subs.some(([k]) => k === parts[tab]) ? parts[tab] : subs[0]?.[0];
  const open = (group, sub) => { setTab(group); if (sub) setParts((p) => ({ ...p, [group]: sub })); };
  return (
    <div className="mx-auto max-w-[1144px] space-y-5 lg:px-6">
      <div>
        <Breadcrumbs items={[{ label: 'Companies', to: '/companies' }, { label: company.name }]} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="page-title min-w-0 break-words">{company.name}</h1>
          <CompanyFlags company={company} />
          {company.status !== 'active' && <StatusChip tone="neutral">Inactive</StatusChip>}
        </div>
      </div>
      <nav aria-label="Company sections" className="flex gap-1 overflow-x-auto border-b border-navy-100">
        {groups.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`-mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent ${tab === key ? 'font-semibold text-navy-900' : 'border-transparent font-medium text-navy-500 hover:text-navy-900'}`}
            style={tab === key ? { borderBottomColor: 'var(--color-accent)' } : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
      {subs.length > 1 && (
        <div role="group" aria-label={`${groups.find(([key]) => key === tab)[1]} parts`} className="flex flex-wrap gap-2">
          {subs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => open(tab, key)}
              aria-pressed={part === key}
              className="rounded-full border px-3 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent"
              style={part === key
                ? { backgroundColor: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }
                : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'overview' && <CompanyGlance company={company} onOpen={open} />}
      {/* Keyed on updatedAt so the form re-reads a saved company. */}
      {part === 'details' && <CompanyOverview key={company.updatedAt} company={company} onSaved={setCompany} />}
      {part === 'm365' && <CompanyMicrosoft365 company={company} notice={m365Notice} />}
      {part === 'devices' && <CompanyDevices company={company} />}
      {part === 'notices' && <CompanyNotices company={company} />}
      {part === 'sites' && <CompanySites company={company} />}
      {part === 'departments' && <CompanyDepartments company={company} />}
      {part === 'categories' && <CompanyCategories company={company} />}
      {['contacts', 'tickets', 'projects', 'assets'].includes(part) && <CompanyRecordList key={part} kind={part} companyId={company.id} />}
      {part === 'vendor' && (
        <div className="space-y-6">
          {['assets', 'licenses', 'contracts'].map((kind) => (
            <div key={kind}><p className="eyebrow mb-2">{kind[0].toUpperCase() + kind.slice(1)}</p><CompanyRecordList kind={kind} vendorCompanyId={company.id} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
