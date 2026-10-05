import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
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

  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!company) return <Spinner />;
  const tabs = company.isVendor ? [...TABS, ['vendor', 'Vendor']] : TABS;
  return (
    <div className="space-y-5">
      <Link to="/companies" className="text-sm text-prism hover:underline">← Companies</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{company.name}</h1>
        <CompanyFlags company={company} />
        {company.status !== 'active' && <span className="badge">Inactive</span>}
      </div>
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-prism text-prism' : 'border-transparent text-navy-500 hover:text-navy-700'}`}>{label}</button>
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
