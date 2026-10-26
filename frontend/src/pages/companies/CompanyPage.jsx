import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Notice from '../../components/ui/Notice';
import StatusChip from '../../components/ui/StatusChip';
import CompanyOverview from '../../components/companies/CompanyOverview';
import CompanySites from '../../components/companies/CompanySites';
import CompanyDepartments from '../../components/companies/CompanyDepartments';
import CompanyRecordList from '../../components/companies/CompanyRecordList';
import { CompanyFlags } from './CompaniesList';

const TABS = [
  ['overview', 'Overview'], ['sites', 'Sites'], ['departments', 'Departments'],
  ['contacts', 'Contacts'], ['tickets', 'Tickets'], ['projects', 'Projects'], ['assets', 'Assets'],
];

// A company's page (spec: Companies nav tab).
export default function CompanyPage() {
  const { id } = useParams();
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const load = useCallback(() => {
    api.get(`/companies/${id}`).then(({ data }) => setCompany(data.company)).catch((err) => setError(errMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!company) return <Spinner />;
  const tabs = company.isVendor ? [...TABS, ['vendor', 'Vendor']] : TABS;
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
