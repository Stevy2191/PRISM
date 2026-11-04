import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Notice from '../../components/ui/Notice';
import StatusChip from '../../components/ui/StatusChip';
import CompanyOverview from '../../components/companies/CompanyOverview';
import CompanySites from '../../components/companies/CompanySites';
import CompanyDepartments from '../../components/companies/CompanyDepartments';
import CompanyRecordList from '../../components/companies/CompanyRecordList';
import CompanyMicrosoft365 from '../../components/companies/CompanyMicrosoft365';
import CompanyDevices from '../../components/companies/CompanyDevices';
import { CompanyFlags } from './CompaniesList';

const TABS = [
  ['overview', 'Overview'], ['sites', 'Sites'], ['departments', 'Departments'],
  ['contacts', 'Contacts'], ['tickets', 'Tickets'], ['projects', 'Projects'], ['assets', 'Assets'],
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
  const [tab, setTab] = useState(m365Notice ? 'm365' : 'overview');
  const load = useCallback(() => {
    api.get(`/companies/${id}`).then(({ data }) => setCompany(data.company)).catch((err) => setError(errMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!company) return <Spinner />;
  // Microsoft 365 (7b) after Overview, for staff who manage portal access.
  // Then Devices (the PRISM agent, 8a) for staff who can see assets.
  let tabs = [TABS[0], ...(hasPermission('portal.manage') ? [['m365', 'Microsoft 365']] : []),
    ...(hasPermission('assets.view') ? [['devices', 'Devices']] : []), ...TABS.slice(1)];
  if (company.isVendor) tabs = [...tabs, ['vendor', 'Vendor']];
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
      <div className="flex gap-1 overflow-x-auto border-b border-navy-100">
        {tabs.map(([key, label]) => (
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
      </div>
      {/* Keyed on updatedAt so the form re-reads a saved company. */}
      {tab === 'overview' && <CompanyOverview key={company.updatedAt} company={company} onSaved={setCompany} />}
      {tab === 'm365' && <CompanyMicrosoft365 company={company} notice={m365Notice} />}
      {tab === 'devices' && <CompanyDevices company={company} />}
      {tab === 'sites' && <CompanySites company={company} />}
      {tab === 'departments' && <CompanyDepartments company={company} />}
      {['contacts', 'tickets', 'projects', 'assets'].includes(tab) && <CompanyRecordList key={tab} kind={tab} companyId={company.id} />}
      {tab === 'vendor' && (
        <div className="space-y-6">
          {['assets', 'licenses', 'contracts'].map((kind) => (
            <div key={kind}><p className="eyebrow mb-2">{kind[0].toUpperCase() + kind.slice(1)}</p><CompanyRecordList kind={kind} vendorCompanyId={company.id} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
