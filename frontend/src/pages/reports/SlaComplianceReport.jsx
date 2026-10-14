import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, GroupedBarChart, MultiLineChart, SortableTable, PALETTE } from './shared';

export default function SlaComplianceReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.departmentId) params.departmentId = filters.departmentId;
    if (filters.companyId) params.companyId = filters.companyId;
    api.get('/reports/sla-compliance', { params })
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        if (isForbidden(err)) onForbidden?.();
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  }, [filters, onForbidden]);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const { clocks } = data.summary;
  const of = (c) => (c.tracked ? `${c.met} of ${c.tracked} on time` : 'No results yet');
  const bars = [
    { dataKey: 'met', label: 'Met', color: PALETTE[2] },
    { dataKey: 'breached', label: 'Breached', color: PALETTE[4] },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Assigned on time" value={pct(clocks.assign.pctMet)} sub={of(clocks.assign)} />
        <StatCard label="First response on time" value={pct(clocks.response.pctMet)} sub={of(clocks.response)} />
        <StatCard label="Resolved on time" value={pct(clocks.resolution.pctMet)} sub={of(clocks.resolution)} />
        <StatCard label="Open and breached" value={data.summary.openBreached} />
        <StatCard label="Open and at risk" value={data.summary.openAtRisk} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Met the original SLA" value={pct(data.summary.resolution.pctMetOriginal)} sub={`${data.summary.resolution.metOriginal} of ${data.summary.resolution.closed} resolved`} />
        <StatCard label="Met the due date (with extensions)" value={pct(data.summary.resolution.pctMetDue)} sub={`${data.summary.resolution.metDue} of ${data.summary.resolution.closed} resolved`} />
        <StatCard label="Tickets extended" value={data.summary.resolution.extended} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ChartCard title="Resolution met vs breached per tech">
          <GroupedBarChart data={data.chartData.metVsBreachedByTech} bars={bars} />
        </ChartCard>
        <ChartCard title="Resolution met vs breached per department">
          <GroupedBarChart data={data.chartData.metVsBreachedByDept} bars={bars} />
        </ChartCard>
        <ChartCard title="Resolution met vs breached per company">
          <GroupedBarChart data={data.chartData.metVsBreachedByCompany} bars={bars} />
        </ChartCard>
      </div>

      <ChartCard title="Resolution compliance trend (% met)">
        <MultiLineChart data={data.chartData.complianceTrend} lines={[{ dataKey: 'pctMet', label: '% met', color: PALETTE[0] }]} />
      </ChartCard>

      <SortableTable
        columns={[
          { key: 'ticketNumber', label: '#' },
          { key: 'title', label: 'Title', render: (r) => <Link to={`/tickets/${r.id}`} className="text-prism hover:underline">{r.title}</Link> },
          { key: 'assignee', label: 'Assignee' },
          { key: 'company', label: 'Company' },
          { key: 'clock', label: 'Clock' },
          { key: 'dueAt', label: 'Due', render: (r) => new Date(r.dueAt).toLocaleString() },
          { key: 'overByMinutes', label: 'Minutes over' },
        ]}
        rows={data.tableData.rows.map((r, i) => ({ ...r, key: `${r.id}-${r.clock}-${i}` }))}
        emptyMessage="No SLA breaches for tickets created in this period."
      />

      <div>
        <h3 className="eyebrow mb-2">Due date changes</h3>
        <SortableTable
          columns={[
            { key: 'ticketNumber', label: '#' },
            { key: 'title', label: 'Title', render: (r) => <Link to={`/tickets/${r.id}`} className="text-prism hover:underline">{r.title}</Link> },
            { key: 'kind', label: 'Change', render: (r) => (r.kind === 'extension' ? 'Extended' : 'Changed') },
            { key: 'to', label: 'New due', render: (r) => new Date(r.to).toLocaleString() },
            { key: 'reason', label: 'Reason' },
            { key: 'by', label: 'By' },
          ]}
          rows={(data.extensions || []).map((r, i) => ({ ...r, key: `${r.id}-${r.at}-${i}` }))}
          emptyMessage="No due dates were changed for tickets created in this period."
        />
      </div>
    </div>
  );
}
