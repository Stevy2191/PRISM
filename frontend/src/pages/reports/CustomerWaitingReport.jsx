import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import {
  StatCard, ChartCard, SimpleBarChart, MultiLineChart, SortableTable, PALETTE, formatHours,
} from './shared';

// Time waiting on the customer: statuses switched on as "counts as waiting"
// (Settings → Statuses). Lifecycle times and the SLA still include it.
const GROUPS = [
  { key: 'byTech', label: 'Tech', column: 'Tech' },
  { key: 'byCompany', label: 'Company', column: 'Company' },
  { key: 'byPeriod', label: 'Period', column: 'Period' },
];

const pct = (v) => (v === null || v === undefined || v === '' ? '—' : `${v}%`);

export default function CustomerWaitingReport({ filters, onForbidden }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupKey, setGroupKey] = useState('byTech');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.departmentId) params.departmentId = filters.departmentId;
    if (filters.companyId) params.companyId = filters.companyId;
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    if (filters.closedOnly) params.closedOnly = 'true';
    api.get('/reports/customer-waiting', { params })
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

  const { summary } = data;
  const group = GROUPS.find((g) => g.key === groupKey);
  const groupRows = (data[groupKey] || []).map((r) => ({ ...r, name: r.name ?? r.date, key: r.name ?? r.date }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Time waiting on customer" value={formatHours(summary.waitingHours)} sub={`${summary.tickets} tickets`} />
        <StatCard label="Average per ticket" value={formatHours(summary.avgWaitingHours)} />
        <StatCard label="Share of ticket life" value={pct(summary.pctWaiting)} sub={`of ${formatHours(summary.lifeHours)} in total`} />
        <StatCard label="Waiting right now" value={summary.waitingNow} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Average hours waiting per ticket, by tech">
          <SimpleBarChart data={data.byTech} dataKey="avgWaitingHours" color={PALETTE[0]} />
        </ChartCard>
        <ChartCard title="Average hours waiting per ticket, by company">
          <SimpleBarChart data={data.byCompany} dataKey="avgWaitingHours" color={PALETTE[1]} />
        </ChartCard>
      </div>

      <ChartCard title="Share of ticket life spent waiting (%)">
        <MultiLineChart data={data.byPeriod} lines={[{ dataKey: 'pctWaiting', label: '% waiting', color: PALETTE[0] }]} />
      </ChartCard>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="eyebrow">Totals and averages by</h3>
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupKey(g.key)}
              className={groupKey === g.key ? 'btn-primary h-8 px-3 text-xs' : 'btn-secondary h-8 px-3 text-xs'}
            >
              {g.label}
            </button>
          ))}
        </div>
        <SortableTable
          columns={[
            { key: 'name', label: group.column },
            { key: 'tickets', label: 'Tickets' },
            { key: 'waitingHours', label: 'Total waiting', render: (r) => formatHours(r.waitingHours) },
            { key: 'avgWaitingHours', label: 'Average waiting', render: (r) => formatHours(r.avgWaitingHours) },
            { key: 'pctWaiting', label: '% of life', render: (r) => pct(r.pctWaiting) },
          ]}
          rows={groupRows}
          emptyMessage="No tickets created in this period."
        />
      </div>

      <SortableTable
        columns={[
          { key: 'ticketNumber', label: '#' },
          { key: 'title', label: 'Title', render: (r) => <Link to={`/tickets/${r.id}`} className="text-prism hover:underline">{r.title}</Link> },
          { key: 'status', label: 'Status' },
          { key: 'assignee', label: 'Assignee' },
          { key: 'company', label: 'Company' },
          { key: 'createdAt', label: 'Created' },
          { key: 'resolvedAt', label: 'Closed' },
          { key: 'lifeHours', label: 'Life (hrs)' },
          { key: 'waitingHours', label: 'Waiting (hrs)' },
          { key: 'waitingPct', label: '% waiting', render: (r) => pct(r.waitingPct) },
          { key: 'waitingNow', label: 'Waiting now', render: (r) => (r.waitingNow ? 'Yes' : '') },
        ]}
        rows={data.tableData.rows}
        emptyMessage="No tickets created in this period."
      />
    </div>
  );
}
