import { useEffect, useMemo, useState } from 'react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import {
  StatCard, ChartCard, SimpleBarChart, MultiLineChart, DonutChart, SortableTable, PALETTE,
} from './shared';

const VIS_OPTIONS = [
  { key: 'table', label: 'Table' },
  { key: 'bar', label: 'Bar chart', needsGroup: true },
  { key: 'line', label: 'Line chart', needsGroup: true, monthOnly: true },
  { key: 'pie', label: 'Pie / donut', needsGroup: true },
];

// Which generic filter controls are relevant per data source — the filter
// panel only shows what applies, per spec's per-source filter list.
const FILTER_APPLICABILITY = {
  tickets: ['dateRange', 'dateField', 'department', 'assignee', 'status', 'priority', 'source', 'tag', 'customField'],
  projects: ['dateRange', 'dateField', 'department', 'status', 'tag'],
  time_entries: ['dateRange', 'department', 'assignee', 'userType'],
  expenses_materials: ['dateRange', 'department'],
  contacts: ['dateRange', 'department', 'status'],
};

const DATE_FIELD_OPTIONS = {
  tickets: [{ key: 'createdAt', label: 'Created date' }, { key: 'closedAt', label: 'Closed date' }, { key: 'dueDate', label: 'Due date' }],
  projects: [{ key: 'createdAt', label: 'Start date' }, { key: 'closedAt', label: 'Closed date' }, { key: 'dueDate', label: 'Due date' }],
};

const EMPTY_FILTERS = {
  startDate: '', endDate: '', dateField: 'createdAt', departmentId: '', assigneeId: '',
  status: '', priority: '', source: '', userType: '', tag: '', customFieldKey: '', customFieldValue: '',
};

function filtersToPayload(filters) {
  const payload = {};
  if (filters.startDate) payload.startDate = filters.startDate;
  if (filters.endDate) payload.endDate = filters.endDate;
  if (filters.dateField) payload.dateField = filters.dateField;
  if (filters.departmentId) payload.departmentId = filters.departmentId;
  if (filters.assigneeId) payload.assigneeId = filters.assigneeId;
  if (filters.status) payload.status = filters.status;
  if (filters.priority) payload.priority = filters.priority;
  if (filters.source) payload.source = filters.source;
  if (filters.userType) payload.userType = filters.userType;
  if (filters.tag) payload.tag = filters.tag;
  if (filters.customFieldKey) payload.customField = { key: filters.customFieldKey, value: filters.customFieldValue };
  return payload;
}

export default function CustomReportBuilder({ loadSavedId, onSaved, onDeleted }) {
  const canViewAll = usePermission('reports.view_all');
  const canExport = usePermission('reports.export');

  const [metadata, setMetadata] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);

  const [dataSource, setDataSource] = useState('tickets');
  const [selectedFields, setSelectedFields] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [groupBy, setGroupBy] = useState('');
  const [visualization, setVisualization] = useState('table');

  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const [savedId, setSavedId] = useState(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/reports/custom/metadata').then(({ data }) => setMetadata(data)).catch(() => {});
    if (canViewAll) api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
  }, [canViewAll]);

  // Loading a saved report's config into the builder.
  useEffect(() => {
    if (!loadSavedId) return;
    api.get('/reports/saved').then(({ data }) => {
      const saved = data.reports.find((r) => r.id === loadSavedId);
      if (!saved) return;
      setSavedId(saved.id);
      setDataSource(saved.dataSource);
      setSelectedFields(saved.fields || []);
      setFilters({ ...EMPTY_FILTERS, ...(saved.filters || {}) });
      setGroupBy(saved.groupBy || '');
      setVisualization(saved.visualization || 'table');
      setResult(null);
    }).catch(() => {});
  }, [loadSavedId]);

  const source = metadata?.dataSources.find((s) => s.key === dataSource);
  const applicableFilters = FILTER_APPLICABILITY[dataSource] || [];
  const dateFieldOptions = DATE_FIELD_OPTIONS[dataSource];

  // Fields default to "all" whenever the data source changes (including on
  // first metadata load) unless we just loaded a saved config for it.
  useEffect(() => {
    if (!source) return;
    if (loadSavedId) return; // the saved-report effect already set fields for this source
    setSelectedFields(source.fields.map((f) => f.key));
    setGroupBy('');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, metadata]);

  const toggleField = (key) => {
    setSelectedFields((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const availableVis = VIS_OPTIONS.filter((v) => {
    if (!v.needsGroup) return true;
    if (!groupBy) return false;
    if (v.monthOnly) return groupBy === 'month';
    return true;
  });
  useEffect(() => {
    if (!availableVis.some((v) => v.key === visualization)) setVisualization('table');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy]);

  const runReport = async () => {
    setRunning(true);
    setError('');
    try {
      const { data } = await api.post('/reports/custom', {
        dataSource, fields: selectedFields, filters: filtersToPayload(filters), groupBy: groupBy || null,
      });
      setResult(data);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await api.post('/reports/custom/export-csv', {
        dataSource, fields: selectedFields, filters: filtersToPayload(filters), groupBy: groupBy || null,
      }, { responseType: 'blob' });
      downloadBlob(res.data, `prism-custom-report-${dataSource}.csv`);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const exportPdf = async () => {
    try {
      const res = await api.post('/reports/custom/export-pdf', {
        dataSource, fields: selectedFields, filters: filtersToPayload(filters), groupBy: groupBy || null, visualization,
      }, { responseType: 'blob' });
      downloadBlob(res.data, `prism-custom-report-${dataSource}.pdf`);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const saveAs = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: saveName.trim(), dataSource, fields: selectedFields, filters: filtersToPayload(filters),
        groupBy: groupBy || null, visualization,
      };
      if (savedId) {
        await api.patch(`/reports/saved/${savedId}`, payload);
      } else {
        const { data } = await api.post('/reports/saved', payload);
        setSavedId(data.report.id);
      }
      setSaveModalOpen(false);
      setSaveName('');
      onSaved?.();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteSaved = async () => {
    if (!savedId || !confirm('Delete this saved report?')) return;
    try {
      await api.delete(`/reports/saved/${savedId}`);
      setSavedId(null);
      onDeleted?.();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (!metadata) return <Spinner />;

  const groupByOptions = source?.groupBy || [];
  const valueKey = result?.chartData?.[0] ? Object.keys(result.chartData[0]).find((k) => k !== 'name') : 'count';

  return (
    <div className="space-y-5">
      <div className="card space-y-5 p-5">
        {/* Step 1 */}
        <div>
          <p className="label mb-2">1. Data source</p>
          <div className="flex flex-wrap gap-2">
            {metadata.dataSources.map((s) => (
              <button
                key={s.key}
                onClick={() => setDataSource(s.key)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  dataSource === s.key ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-600 hover:bg-navy-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 */}
        <div>
          <p className="label mb-2">2. Fields / columns</p>
          <div className="flex flex-wrap gap-1.5">
            {source?.fields.map((f) => (
              <label
                key={f.key}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  selectedFields.includes(f.key) ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-500'
                }`}
              >
                <input type="checkbox" className="sr-only" checked={selectedFields.includes(f.key)} onChange={() => toggleField(f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        {/* Step 3 */}
        <div>
          <p className="label mb-2">3. Filters</p>
          <div className="flex flex-wrap items-end gap-3">
            {applicableFilters.includes('dateRange') && (
              <>
                <div>
                  <label className="label">From</label>
                  <input type="date" className="input h-9" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="label">To</label>
                  <input type="date" className="input h-9" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </>
            )}
            {applicableFilters.includes('dateField') && dateFieldOptions && (
              <div>
                <label className="label">Date field</label>
                <select className="input h-9" value={filters.dateField} onChange={(e) => setFilters((f) => ({ ...f, dateField: e.target.value }))}>
                  {dateFieldOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            )}
            {applicableFilters.includes('department') && canViewAll && (
              <div>
                <label className="label">Department</label>
                <select className="input h-9" value={filters.departmentId} onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">All departments</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {applicableFilters.includes('assignee') && (
              <div>
                <label className="label">Assignee / tech</label>
                <select className="input h-9" value={filters.assigneeId} onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}>
                  <option value="">Everyone</option>
                  {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              </div>
            )}
            {applicableFilters.includes('status') && dataSource === 'contacts' && (
              <div>
                <label className="label">Status</label>
                <select className="input h-9" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                  <option value="">Any status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
            {applicableFilters.includes('status') && dataSource !== 'contacts' && (
              <div>
                <label className="label">Status</label>
                <input className="input h-9 w-32" placeholder="e.g. Open" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} />
              </div>
            )}
            {applicableFilters.includes('priority') && (
              <div>
                <label className="label">Priority</label>
                <select className="input h-9" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
                  <option value="">Any priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            )}
            {applicableFilters.includes('source') && (
              <div>
                <label className="label">Source</label>
                <select className="input h-9" value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}>
                  <option value="">Any source</option>
                  <option value="manual">Manual</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="portal">Portal</option>
                </select>
              </div>
            )}
            {applicableFilters.includes('userType') && (
              <div>
                <label className="label">User type</label>
                <select className="input h-9" value={filters.userType} onChange={(e) => setFilters((f) => ({ ...f, userType: e.target.value }))}>
                  <option value="">Everyone</option>
                  <option value="internal">Internal</option>
                  <option value="contractor">Contractor</option>
                </select>
              </div>
            )}
            {applicableFilters.includes('tag') && (
              <div>
                <label className="label">Tag</label>
                <input className="input h-9 w-28" placeholder="e.g. vpn" value={filters.tag} onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))} />
              </div>
            )}
            {applicableFilters.includes('customField') && (
              <>
                <div>
                  <label className="label">Custom field</label>
                  <select className="input h-9" value={filters.customFieldKey} onChange={(e) => setFilters((f) => ({ ...f, customFieldKey: e.target.value }))}>
                    <option value="">None</option>
                    {source?.fields.filter((f) => f.key.startsWith('cf_')).map((f) => (
                      <option key={f.key} value={f.fieldKey}>{f.label}</option>
                    ))}
                  </select>
                </div>
                {filters.customFieldKey && (
                  <div>
                    <label className="label">Value</label>
                    <input className="input h-9 w-32" value={filters.customFieldValue} onChange={(e) => setFilters((f) => ({ ...f, customFieldValue: e.target.value }))} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Step 4 */}
        {groupByOptions.length > 0 && (
          <div>
            <p className="label mb-2">4. Group by (optional)</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setGroupBy('')}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${!groupBy ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-600 hover:bg-navy-50'}`}
              >
                None
              </button>
              {groupByOptions.map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize ${groupBy === g ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-600 hover:bg-navy-50'}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5 */}
        <div>
          <p className="label mb-2">5. Visualization</p>
          <div className="flex flex-wrap gap-2">
            {VIS_OPTIONS.map((v) => {
              const disabled = v.needsGroup && (!groupBy || (v.monthOnly && groupBy !== 'month'));
              return (
                <button
                  key={v.key}
                  disabled={disabled}
                  onClick={() => setVisualization(v.key)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                    visualization === v.key ? 'border-prism bg-prism/10 text-prism' : 'border-navy-200 text-navy-600 hover:bg-navy-50'
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 6 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-navy-100 pt-4">
          <button onClick={runReport} disabled={running || !selectedFields.length} className="btn-primary">
            {running ? 'Running…' : 'Run report'}
          </button>
          <button onClick={() => { setSaveName(''); setSaveModalOpen(true); }} className="btn-secondary">
            {savedId ? 'Update saved report' : 'Save as…'}
          </button>
          {savedId && <button onClick={deleteSaved} className="text-sm text-red-500 hover:underline">Delete saved report</button>}
          {canExport && (
            <div className="ml-auto flex gap-2">
              <button onClick={exportCsv} className="btn-secondary">Export CSV</button>
              <button onClick={exportPdf} className="btn-secondary">Export PDF</button>
            </div>
          )}
        </div>
      </div>

      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSaveModalOpen(false)}>
          <div className="w-full max-w-sm rounded-md bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-navy-900">{savedId ? 'Update saved report' : 'Save custom report'}</h3>
            <input
              autoFocus
              className="input mb-4"
              placeholder="Report name"
              value={saveName || (savedId ? '' : '')}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSaveModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveAs} disabled={saving || !saveName.trim()} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {result && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Records" value={result.summary.totalRecords} />
            {Object.entries(result.summary).filter(([k]) => k !== 'totalRecords').map(([k, v]) => (
              <StatCard key={k} label={k.replace('total_', 'Total ').replace(/([A-Z])/g, ' $1')} value={v} />
            ))}
          </div>

          {groupBy && result.chartData.length > 0 && visualization !== 'table' && (
            <ChartCard title={`Grouped by ${groupBy}`}>
              {visualization === 'bar' && <SimpleBarChart data={result.chartData} dataKey={valueKey} color={PALETTE[0]} />}
              {visualization === 'line' && <MultiLineChart data={result.chartData} lines={[{ dataKey: valueKey, label: valueKey, color: PALETTE[0] }]} xKey="name" />}
              {visualization === 'pie' && <DonutChart data={result.chartData} dataKey={valueKey} />}
            </ChartCard>
          )}

          <SortableTable columns={result.tableData.columns} rows={result.tableData.rows} />
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
