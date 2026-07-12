import { useEffect, useMemo, useState } from 'react';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import AccessRestricted from '../components/AccessRestricted';
import { PRESETS, presetRange } from './reports/shared';
import TicketVolumeReport from './reports/TicketVolumeReport';
import TicketTrendsReport from './reports/TicketTrendsReport';
import TeamPerformanceReport from './reports/TeamPerformanceReport';
import SlaComplianceReport from './reports/SlaComplianceReport';
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

const CATEGORIES = [
  {
    name: 'Tickets',
    reports: [
      { key: 'ticket-volume', label: 'Ticket Volume', endpoint: 'ticket-volume', showAssignee: true },
      { key: 'ticket-trends', label: 'Ticket Trends', endpoint: 'ticket-trends', showAssignee: false },
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
  const [customRange, setCustomRange] = useState({ startDate: '', endDate: '' });
  const [departmentId, setDepartmentId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [customReports, setCustomReports] = useState([]);
  const [editingSavedId, setEditingSavedId] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

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

  const range = useMemo(() => (preset === 'custom' ? customRange : presetRange(preset) || { startDate: '', endDate: '' }), [preset, customRange]);

  const filters = useMemo(() => ({
    startDate: range.startDate || '',
    endDate: range.endDate || '',
    departmentId: canViewAll ? departmentId : '',
    assigneeId: activeReport?.showAssignee ? assigneeId : '',
  }), [range, canViewAll, departmentId, assigneeId, activeReport]);

  const exportCsv = async () => {
    try {
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.departmentId) params.departmentId = filters.departmentId;
      if (filters.assigneeId) params.assigneeId = filters.assigneeId;
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
        filters: { preset, customRange, departmentId, assigneeId },
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
    setAssigneeId(f.assigneeId || '');
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

  const currentNavLabel = activeKey === 'custom'
    ? (editingSavedId ? (customReports.find((r) => r.id === editingSavedId)?.name || 'Custom report') : 'New custom report')
    : (ALL_REPORTS.find((r) => r.key === activeKey)?.label || 'Reports');

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="lg:w-56 lg:flex-shrink-0">
        <h1 className="mb-3 text-2xl font-bold text-navy-900 lg:hidden">Reports</h1>
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          className="mb-2 flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-sm font-medium lg:hidden"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-card)' }}
        >
          <span className="truncate">{currentNavLabel}</span>
          <span className="flex-shrink-0">{navOpen ? '▲' : '▼'}</span>
        </button>

      <nav className={`w-full shrink-0 space-y-5 lg:block lg:w-56 ${navOpen ? 'block' : 'hidden'}`}>
        <h1 className="hidden text-2xl font-bold text-navy-900 lg:block">Reports</h1>
        {CATEGORIES.map((cat) => (
          <div key={cat.name}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">{cat.name}</p>
            <div className="space-y-0.5">
              {cat.reports.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setActiveKey(r.key); setNavOpen(false); }}
                  className={`block w-full rounded-md px-3 py-1.5 text-left text-sm ${
                    activeKey === r.key ? 'bg-prism text-white' : 'text-navy-600 hover:bg-navy-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {savedViews.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">Saved views</p>
            <div className="flex flex-wrap gap-1.5">
              {savedViews.map((v) => (
                <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-navy-100 px-2.5 py-1 text-xs text-navy-700">
                  <button type="button" onClick={() => { applyView(v); setNavOpen(false); }} className="hover:underline">{v.name}</button>
                  <button type="button" onClick={() => deleteView(v.id)} className="text-navy-400 hover:text-red-500">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">Custom Reports</p>
          <div className="space-y-0.5">
            <button
              onClick={() => { openCustomBuilder(null); setNavOpen(false); }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-sm font-medium ${
                activeKey === 'custom' && !editingSavedId ? 'bg-prism text-white' : 'text-prism hover:bg-navy-50'
              }`}
            >
              + New custom report
            </button>
            {customReports.map((r) => (
              <div
                key={r.id}
                className={`group flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${
                  activeKey === 'custom' && editingSavedId === r.id ? 'bg-prism text-white' : 'text-navy-600 hover:bg-navy-50'
                }`}
              >
                <button type="button" onClick={() => { openCustomBuilder(r.id); setNavOpen(false); }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{r.name}</span>
                  <span className={`block text-xs ${activeKey === 'custom' && editingSavedId === r.id ? 'text-white/70' : 'text-navy-400'}`}>
                    {r.dataSource} · {r.lastRunAt ? new Date(r.lastRunAt).toLocaleDateString() : 'never run'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomReport(r.id)}
                  className={`ml-1 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 ${activeKey === 'custom' && editingSavedId === r.id ? 'text-white/70 hover:text-white' : 'text-navy-400 hover:text-red-500'}`}
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
            <h1 className="text-xl font-bold text-navy-900">{editingSavedId ? 'Edit custom report' : 'Custom report builder'}</h1>
            <CustomReportBuilder
              key={editingSavedId || 'new'}
              loadSavedId={editingSavedId}
              onSaved={loadCustomReports}
              onDeleted={() => { loadCustomReports(); setEditingSavedId(null); }}
            />
          </>
        ) : (
        <>
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  preset === p.key ? 'bg-prism text-white' : 'bg-navy-50 text-navy-600 hover:bg-navy-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <>
              <div>
                <label className="label">From</label>
                <input type="date" className="input h-9" value={customRange.startDate} onChange={(e) => setCustomRange((r) => ({ ...r, startDate: e.target.value }))} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input h-9" value={customRange.endDate} onChange={(e) => setCustomRange((r) => ({ ...r, endDate: e.target.value }))} />
              </div>
            </>
          )}

          {canViewAll && (
            <div>
              <label className="label">Department</label>
              <select className="input h-9" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          {activeReport?.showAssignee && (
            <div>
              <label className="label">Assignee</label>
              <select className="input h-9" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">All assignees</option>
                {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
          )}

          <div className="ml-auto flex gap-2">
            {saveViewOpen ? (
              <>
                <input
                  className="input h-9 w-40"
                  placeholder="View name"
                  value={saveViewName}
                  onChange={(e) => setSaveViewName(e.target.value)}
                  autoFocus
                />
                <button onClick={saveView} className="btn-primary">Save</button>
                <button onClick={() => setSaveViewOpen(false)} className="btn-secondary">Cancel</button>
              </>
            ) : (
              <button onClick={() => setSaveViewOpen(true)} className="btn-secondary">+ Save view</button>
            )}
            {canExport && <button onClick={exportCsv} className="btn-secondary">Export CSV</button>}
          </div>
        </div>

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
