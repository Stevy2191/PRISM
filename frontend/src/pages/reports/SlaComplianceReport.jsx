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
  const metMissedBars = [
    { dataKey: 'met', label: 'Met', color: PALETTE[2] },
    { dataKey: 'missed', label: 'Missed', color: PALETTE[4] },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Closed within SLA" value={pct(data.summary.pctMetSLA)} />
        <StatCard label="Overdue at closing" value={pct(data.summary.pctMissedAtClosing)} />
        <StatCard label="Currently overdue" value={pct(data.summary.pctCurrentlyOverdue)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="SLA met vs missed per tech">
          <GroupedBarChart data={data.chartData.metVsMissedByTech} bars={metMissedBars} />
        </ChartCard>
        <ChartCard title="SLA met vs missed per department">
          <GroupedBarChart data={data.chartData.metVsMissedByDept} bars={metMissedBars} />
        </ChartCard>
      </div>

      <ChartCard title="SLA compliance trend (% met)">
        <MultiLineChart data={data.chartData.complianceTrend} lines={[{ dataKey: 'pctMet', label: '% met', color: PALETTE[0] }]} />
      </ChartCard>

      <SortableTable
        columns={[
          { key: 'ticketNumber', label: '#' },
          { key: 'title', label: 'Title', render: (r) => <Link to={`/tickets/${r.id}`} className="text-prism hover:underline">{r.title}</Link> },
          { key: 'assignee', label: 'Assignee' },
          { key: 'dueDate', label: 'Due date' },
          { key: 'closedDate', label: 'Closed date' },
          { key: 'daysOverdue', label: 'Days overdue' },
        ]}
        rows={data.tableData.rows}
        emptyMessage="No missed SLA tickets in this period."
      />
    </div>
  );
}
