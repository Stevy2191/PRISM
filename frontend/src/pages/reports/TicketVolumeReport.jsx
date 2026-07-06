import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, MultiLineChart, SortableTable, PALETTE, formatHours } from './shared';

export default function TicketVolumeReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ticket-statuses').then(({ data: d }) => setStatuses(d.statuses)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.departmentId) params.departmentId = filters.departmentId;
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    api.get('/reports/ticket-volume', { params })
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

  const statusColor = new Map(statuses.map((s) => [s.name, s.color]));
  const colorForStatus = (name) => statusColor.get(name);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total created" value={data.summary.totalCreated} />
        <StatCard label="Total closed" value={data.summary.totalClosed} />
        <StatCard label="Currently open" value={data.summary.currentlyOpen} />
        <StatCard label="Avg resolution time" value={formatHours(data.summary.avgResolutionHours)} />
      </div>

      <ChartCard title={`Tickets created over time (${data.chartData.granularity})`}>
        <MultiLineChart data={data.chartData.volumeOverTime} xKey="date" lines={[{ dataKey: 'count', label: 'Created', color: PALETTE[0] }]} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ChartCard title="Tickets by status">
          <SimpleBarChart data={data.chartData.byStatus} color={PALETTE[0]} colorForName={colorForStatus} />
        </ChartCard>
        <ChartCard title="Tickets by type">
          <SimpleBarChart data={data.chartData.byType} color={PALETTE[1]} />
        </ChartCard>
        <ChartCard title="Tickets by priority">
          <SimpleBarChart data={data.chartData.byPriority} color={PALETTE[4]} />
        </ChartCard>
      </div>

      <SortableTable
        columns={[
          { key: 'ticketNumber', label: '#' },
          { key: 'title', label: 'Title', render: (r) => <Link to={`/tickets/${r.id}`} className="text-prism hover:underline">{r.title}</Link> },
          { key: 'type', label: 'Type' },
          { key: 'priority', label: 'Priority' },
          { key: 'status', label: 'Status' },
          { key: 'createdAt', label: 'Created' },
          { key: 'resolvedAt', label: 'Closed' },
          { key: 'resolutionHours', label: 'Resolution (hrs)' },
          { key: 'assignee', label: 'Assignee' },
        ]}
        rows={data.tableData.rows}
      />
    </div>
  );
}
