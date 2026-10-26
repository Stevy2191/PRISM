import { useEffect, useMemo, useState } from 'react';
import CompanyFilter from '../components/companies/CompanyFilter';
import { useCompanySummary } from '../context/CompanyContext';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import AccessRestricted from '../components/AccessRestricted';
import { PRESETS, presetRange } from './reports/shared';
import TicketVolumeReport from './reports/TicketVolumeReport';
import TicketTrendsReport from './reports/TicketTrendsReport';
import TeamPerformanceReport from './reports/TeamPerformanceReport';
import SlaComplianceReport from './reports/SlaComplianceReport';
import CustomerWaitingReport from './reports/CustomerWaitingReport';
import TimeBillingReport from './reports/TimeBillingReport';
import ProjectsReport from './reports/ProjectsReport';
import ContactsReport from './reports/ContactsReport';
import CustomerHappinessReport from './reports/CustomerHappinessReport';
import AssetsReplacementReport from './reports/AssetsReplacementReport';
import AssetsWarrantyReport from './reports/AssetsWarrantyReport';
import AssetsInventoryReport from './reports/AssetsInventoryReport';
import AssetsTicketHistoryReport from './reports/AssetsTicketHistoryReport';
import LicensesInventoryReport from './reports/LicensesInventoryReport';
import ContractsSummaryReport from './reports/ContractsSummaryReport';
import SoftwareSpendReport from './reports/SoftwareSpendReport';
import ContractSpendReport from './reports/ContractSpendReport';
import UpcomingRenewalsReport from './reports/UpcomingRenewalsReport';
import CustomReportBuilder from './reports/CustomReportBuilder';
import {
  IconAdjustmentsHorizontal, IconChevronDown, IconChevronUp, IconDownload,
} from '@tabler/icons-react';
import PillRow from '../components/ui/PillRow';
import Pill from '../components/ui/Pill';
import SelectChip from '../components/ui/SelectChip';
import FiltersSheet from '../components/ui/FiltersSheet';
import Button from '../components/ui/Button';

const CATEGORIES = [
  {
    name: 'Tickets',
    reports: [
      { key: 'ticket-volume', label: 'Ticket Volume', endpoint: 'ticket-volume', showAssignee: true },
      { key: 'ticket-trends', label: 'Ticket Trends', endpoint: 'ticket-trends', showAssignee: false },
      {
        key: 'customer-waiting', label: 'Waiting on Customer', endpoint: 'customer-waiting', showAssignee: true, showClosedOnly: true,
      },
    ],
  },
  {
    name: 'Team Performance',
    reports: [
      { key: 'team-performance', label: 'Team Performance', endpoint: 'team-performance', showAssignee: false },
      { key: 'sla-compliance', label: 'SLA Compliance', endpoint: 'sla-compliance', showAssignee: false },
    ],
  },
  {
    name: 'Time & Billing',
    reports: [
      { key: 'time-billing', label: 'Time & Billing', endpoint: 'time-billing', showAssignee: true },
    ],
  },
  {
    name: 'Projects',
    reports: [
      { key: 'projects', label: 'Project Reports', endpoint: 'projects', showAssignee: false },
    ],
  },
  {
    name: 'Contacts',
    reports: [
      { key: 'contacts', label: 'Contact Reports', endpoint: 'contacts', showAssignee: false },
    ],
  },
  {
    name: 'Customer Happiness',
    reports: [
      { key: 'customer-happiness', label: 'Customer Happiness', endpoint: 'customer-happiness', showAssignee: false },
    ],
  },
  {
    name: 'Assets',
    reports: [
      { key: 'assets-replacement', label: 'Assets Due for Replacement', endpoint: 'assets/replacement', showAssignee: false },
      { key: 'assets-warranty', label: 'Warranty Status', endpoint: 'assets/warranty', showAssignee: false },
      { key: 'assets-inventory', label: 'Asset Inventory', endpoint: 'assets/inventory', showAssignee: false },
      { key: 'assets-ticket-history', label: 'Asset Ticket History', endpoint: 'assets/ticket-history', showAssignee: false },
    ],
  },
  {
    name: 'Licenses & Contracts',
    reports: [
      { key: 'licenses-inventory', label: 'License Inventory', endpoint: 'licenses/inventory', showAssignee: false },
      { key: 'contracts-summary', label: 'Contract Summary', endpoint: 'contracts/summary', showAssignee: false },
      { key: 'software-spend', label: 'Total Software Spend', endpoint: 'licenses/spend', showAssignee: false },
      { key: 'contract-spend', label: 'Total Contract Spend', endpoint: 'contracts/spend', showAssignee: false },
      { key: 'upcoming-renewals', label: 'Upcoming Renewals', endpoint: 'licenses-contracts/upcoming-renewals', showAssignee: false },
    ],
  },
];

const ALL_REPORTS = CATEGORIES.flatMap((c) => c.reports);

const REPORT_COMPONENTS = {
  'ticket-volume': TicketVolumeReport,
  'ticket-trends': TicketTrendsReport,
  'team-performance': TeamPerformanceReport,
  'sla-compliance': SlaComplianceReport,
  'customer-waiting': CustomerWaitingReport,
  'time-billing': TimeBillingReport,
  projects: ProjectsReport,
  contacts: ContactsReport,
  'customer-happiness': CustomerHappinessReport,
  'assets-replacement': AssetsReplacementReport,
  'assets-warranty': AssetsWarrantyReport,
  'assets-inventory': AssetsInventoryReport,
  'assets-ticket-history': AssetsTicketHistoryReport,
  'licenses-inventory': LicensesInventoryReport,
  'contracts-summary': ContractsSummaryReport,
  'software-spend': SoftwareSpendReport,
  'contract-spend': ContractSpendReport,
  'upcoming-renewals': UpcomingRenewalsReport,
};

export default function Reports() {
  const canViewAll = usePermission('reports.view_all');
  const canExport = usePermission('reports.export');

  const [activeKey, setActiveKey] = useState('ticket-volume');
  const [preset, setPreset] = useState('this_month');
  // Presets count from the organization's today; recount once its zone loads.
  const orgZone = useSettings().settings?.company?.timezone;
  const [customRange, setCustomRange] = useState({ startDate: '', endDate: '' });
  const [departmentId, setDepartmentId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { multiCompany } = useCompanySummary();
  const [assigneeId, setAssigneeId] = useState('');
  const [closedOnly, setClosedOnly] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [customReports, setCustomReports] = useState([]);
  const [editingSavedId, setEditingSavedId] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeReport = ALL_REPORTS.find((r) => r.key === activeKey);
  const ActiveComponent = REPORT_COMPONENTS[activeKey];

  useEffect(() => {
    if (!canViewAll) return;
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, [canViewAll]);

  useEffect(() => {
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, []);

  const loadSavedViews = () => {
    api.get('/reports/saved-views', { params: { reportType: activeKey } })
      .then(({ data }) => setSavedViews(data.savedViews))
      .catch(() => setSavedViews([]));
  };
  useEffect(loadSavedViews, [activeKey]);

  const loadCustomReports = () => {
    api.get('/reports/saved').then(({ data }) => setCustomReports(data.reports)).catch(() => setCustomReports([]));
  };
  useEffect(loadCustomReports, []);

  const openCustomBuilder = (savedId) => {
    setEditingSavedId(savedId || null);
    setActiveKey('custom');
  };
  const deleteCustomReport = async (id) => {
    if (!confirm('Delete this saved report?')) return;
    try {
      await api.delete(`/reports/saved/${id}`);
      loadCustomReports();
      if (editingSavedId === id) { setEditingSavedId(null); setActiveKey('ticket-volume'); }
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const range = useMemo(() => (preset === 'custom' ? customRange : presetRange(preset) || { startDate: '', endDate: '' }), [preset, customRange, orgZone]);

  const filters = useMemo(() => ({
    startDate: range.startDate || '',
    endDate: range.endDate || '',
    departmentId: canViewAll ? departmentId : '',
    // Not gated by canViewAll: the company fence already limits it.
    companyId,
    assigneeId: activeReport?.showAssignee ? assigneeId : '',
    closedOnly: activeReport?.showClosedOnly ? closedOnly : false,
  }), [range, canViewAll, departmentId, companyId, assigneeId, closedOnly, activeReport]);

  const exportCsv = async () => {
    try {
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.departmentId) params.departmentId = filters.departmentId;
      if (filters.companyId) params.companyId = filters.companyId;
      if (filters.assigneeId) params.assigneeId = filters.assigneeId;
      if (filters.closedOnly) params.closedOnly = 'true';
      const res = await api.get(`/reports/${activeReport.endpoint}/export`, { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prism-${activeReport.endpoint}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveView = async () => {
    if (!saveViewName.trim()) return;
    try {
      await api.post('/reports/saved-views', {
        reportType: activeKey,
        name: saveViewName.trim(),
        filters: {
          preset, customRange, departmentId, companyId, assigneeId, closedOnly,
        },
      });
      setSaveViewName('');
      setSaveViewOpen(false);
      loadSavedViews();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const applyView = (view) => {
    const f = view.filters || {};
    if (f.preset) setPreset(f.preset);
    if (f.customRange) setCustomRange(f.customRange);
    setDepartmentId(f.departmentId || '');
    setCompanyId(f.companyId || '');
    setAssigneeId(f.assigneeId || '');
    setClosedOnly(Boolean(f.closedOnly));
  };

  const deleteView = async (id) => {
    try {
      await api.delete(`/reports/saved-views/${id}`);
      loadSavedViews();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (forbidden) return <AccessRestricted />;

  // null when the report has none of the sheet's filters (no Filters button).
  const sheetFilterCount = (canViewAll || multiCompany || activeReport?.showAssignee)
    ? [canViewAll && departmentId, multiCompany && companyId, activeReport?.showAssignee && assigneeId].filter(Boolean).length
    : null;

  const currentNavLabel = activeKey === 'custom'
    ? (editingSavedId ? (customReports.find((r) => r.id === editingSavedId)?.name || 'Custom report') : 'New custom report')
    : (ALL_REPORTS.find((r) => r.key === activeKey)?.label || 'Reports');

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 lg:flex-row lg:gap-8 lg:px-6">
      <div className="lg:w-60 lg:flex-shrink-0">
        <h1 className="page-title mb-3 lg:hidden">Reports</h1>
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
          className="mb-2 flex min-h-[44px] w-full items-center justify-between rounded-lg border border-navy-100 bg-surface px-3 py-2.5 text-sm font-semibold text-navy-900 lg:hidden"
        >
          <span className="truncate">{currentNavLabel}</span>
          {navOpen ? <IconChevronUp size={16} aria-hidden="true" /> : <IconChevronDown size={16} aria-hidden="true" />}
        </button>

      <nav aria-label="Reports" className={`w-full shrink-0 space-y-4 max-lg:rounded-lg max-lg:border max-lg:border-navy-100 max-lg:bg-surface max-lg:p-2 lg:block lg:w-60 ${navOpen ? 'block' : 'hidden'}`}>
        <h1 className="page-title hidden lg:block">Reports</h1>
        {CATEGORIES.map((cat) => (
          <div key={cat.name}>
            <p className="mb-1 px-3 text-xs font-semibold text-navy-400">{cat.name}</p>
            <div className="space-y-0.5">
              {cat.reports.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setActiveKey(r.key); setNavOpen(false); }}
                  aria-current={activeKey === r.key ? 'page' : undefined}
                  className={`block w-full rounded-md px-3 py-1.5 text-left text-sm max-lg:min-h-[44px] ${
                    activeKey === r.key ? 'font-semibold' : 'text-navy-700 hover:bg-[var(--color-hover)]'
                  }`}
                  style={activeKey === r.key ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {savedViews.length > 0 && (
          <div>
            <p className="mb-1 px-3 text-xs font-semibold text-navy-400">Saved views</p>
            <div className="flex flex-wrap gap-1.5 px-3">
              {savedViews.map((v) => (
                <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-navy-100 px-2.5 py-1 text-xs text-navy-700">
                  <button type="button" onClick={() => { applyView(v); setNavOpen(false); }} className="hover:underline">{v.name}</button>
                  <button type="button" onClick={() => deleteView(v.id)} aria-label={`Delete view ${v.name}`} className="text-navy-400 hover:text-[var(--color-danger)]">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 px-3 text-xs font-semibold text-navy-400">Custom Reports</p>
          <div className="space-y-0.5">
            <button
              onClick={() => { openCustomBuilder(null); setNavOpen(false); }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-sm font-semibold max-lg:min-h-[44px] ${
                activeKey === 'custom' && !editingSavedId ? '' : 'hover:bg-[var(--color-hover)]'
              }`}
              style={activeKey === 'custom' && !editingSavedId ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : { color: 'var(--color-accent)' }}
            >
              + New custom report
            </button>
            {customReports.map((r) => (
              <div
                key={r.id}
                className={`group flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${
                  activeKey === 'custom' && editingSavedId === r.id ? 'font-semibold' : 'text-navy-700 hover:bg-[var(--color-hover)]'
                }`}
                style={activeKey === 'custom' && editingSavedId === r.id ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' } : undefined}
              >
                <button type="button" onClick={() => { openCustomBuilder(r.id); setNavOpen(false); }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{r.name}</span>
                  <span className="block text-xs font-normal text-navy-400">
                    {r.dataSource} · {r.lastRunAt ? new Date(r.lastRunAt).toLocaleDateString() : 'never run'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomReport(r.id)}
                  aria-label={`Delete ${r.name}`}
                  className="ml-1 flex-shrink-0 text-navy-400 opacity-100 hover:text-[var(--color-danger)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </nav>
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        {activeKey === 'custom' ? (
          <>
            <h2 className="page-title text-2xl">{editingSavedId ? 'Edit custom report' : 'Custom report builder'}</h2>
            <CustomReportBuilder
              key={editingSavedId || 'new'}
              loadSavedId={editingSavedId}
              onSaved={loadCustomReports}
              onDeleted={() => { loadCustomReports(); setEditingSavedId(null); }}
            />
          </>
        ) : (
        <>
        <h2 className="page-title text-2xl max-lg:hidden">{currentNavLabel}</h2>
        <div className="space-y-3 lg:card lg:p-4">
          <PillRow label="Date range" className="lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
            {PRESETS.map((p) => (
              <Pill key={p.key} on={preset === p.key} onClick={() => setPreset(p.key)}>{p.label}</Pill>
            ))}
          </PillRow>

          {preset === 'custom' && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="report-from">From</label>
                <input id="report-from" type="date" className="input h-9" value={customRange.startDate} onChange={(e) => setCustomRange((r) => ({ ...r, startDate: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="report-to">To</label>
                <input id="report-to" type="date" className="input h-9" value={customRange.endDate} onChange={(e) => setCustomRange((r) => ({ ...r, endDate: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {sheetFilterCount !== null && (
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-md border border-navy-100 bg-surface px-3 text-sm font-semibold text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent lg:hidden"
              >
                <IconAdjustmentsHorizontal size={16} aria-hidden="true" />
                Filters
                {sheetFilterCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-semibold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                    {sheetFilterCount}
                  </span>
                )}
              </button>
            )}
            {canViewAll && (
              <SelectChip label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="max-lg:hidden">
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectChip>
            )}
            {multiCompany && (
              <span className="contents max-lg:hidden">
                <CompanyFilter value={companyId} onChange={setCompanyId} className="sel" />
              </span>
            )}
            {activeReport?.showAssignee && (
              <SelectChip label="Assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="max-lg:hidden">
                <option value="">All assignees</option>
                {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </SelectChip>
            )}

            {activeReport?.showClosedOnly && (
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-navy-700 lg:min-h-0">
                <input type="checkbox" checked={closedOnly} onChange={(e) => setClosedOnly(e.target.checked)} />
                Closed tickets only
              </label>
            )}

            <div className="flex flex-wrap gap-2 lg:ml-auto">
              {saveViewOpen ? (
                <>
                  <input
                    className="input h-9 w-40"
                    placeholder="View name"
                    aria-label="View name"
                    value={saveViewName}
                    onChange={(e) => setSaveViewName(e.target.value)}
                    autoFocus
                  />
                  <Button size="sm" variant="primary" onClick={saveView}>Save</Button>
                  <Button size="sm" onClick={() => setSaveViewOpen(false)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setSaveViewOpen(true)}>+ Save view</Button>
              )}
              {canExport && <Button size="sm" onClick={exportCsv}><IconDownload size={14} aria-hidden="true" />Export CSV</Button>}
            </div>
          </div>
        </div>

        <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}>
          {canViewAll && (
            <div>
              <label className="label" htmlFor="report-sheet-department">Department</label>
              <select id="report-sheet-department" className="input h-11 text-sm" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          {multiCompany && (
            <div>
              <p className="label">Company</p>
              <CompanyFilter value={companyId} onChange={setCompanyId} className="input h-11 text-sm" />
            </div>
          )}
          {activeReport?.showAssignee && (
            <div>
              <label className="label" htmlFor="report-sheet-assignee">Assignee</label>
              <select id="report-sheet-assignee" className="input h-11 text-sm" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">All assignees</option>
                {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
          )}
        </FiltersSheet>

        {ActiveComponent && (
          <ActiveComponent
            filters={filters}
            onForbidden={() => setForbidden(true)}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}
