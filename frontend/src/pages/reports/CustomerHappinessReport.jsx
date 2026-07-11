import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { isForbidden } from '../../components/AccessRestricted';
import { StatCard, ChartCard, SimpleBarChart, MultiLineChart, SortableTable } from './shared';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function CustomerHappinessReport({ filters, onForbidden }) {
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
    api.get('/reports/customer-happiness', { params })
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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Overall CSAT score" value={data.summary.overallScore !== null ? `${data.summary.overallScore.toFixed(1)}/5` : '—'} />
        <StatCard label="Responses" value={data.summary.responseCount} />
        <StatCard label="Surveys sent" value={data.summary.sentCount} />
        <StatCard label="Response rate" value={data.summary.responseRate !== null ? `${data.summary.responseRate}%` : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Score trend over time">
          <MultiLineChart data={data.chartData.scoreTrend} lines={[{ dataKey: 'score', label: 'CSAT score' }]} />
        </ChartCard>
        <ChartCard title="Score by technician">
          <SimpleBarChart data={data.chartData.scoreByTech} dataKey="score" />
        </ChartCard>
        <ChartCard title="Score by department">
          <SimpleBarChart data={data.chartData.scoreByDepartment} dataKey="score" />
        </ChartCard>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold text-navy-900">Recent comments</h3>
          {data.recentComments.length === 0 ? (
            <p className="text-sm text-navy-400">No written comments in this period.</p>
          ) : (
            <ul className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
              {data.recentComments.map((c, i) => (
                <li key={i} className="border-b border-navy-100 pb-2 text-sm last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-navy-800">{c.contact || 'Anonymous'}</span>
                    <span className="text-xs text-amber-500">{'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}</span>
                  </div>
                  <p className="mt-0.5 text-navy-600">{c.comment}</p>
                  <p className="mt-0.5 text-xs text-navy-400">Ticket #{c.ticketNumber} · {c.tech} · {formatDate(c.date)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SortableTable
        columns={[
          { key: 'ticketNumber', label: 'Ticket #' },
          { key: 'ticketTitle', label: 'Title' },
          { key: 'contact', label: 'Contact' },
          { key: 'tech', label: 'Tech' },
          { key: 'rating', label: 'Rating', render: (r) => `${r.rating}/5` },
          { key: 'comment', label: 'Comment' },
          { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
        ]}
        rows={data.tableData.rows}
      />
    </div>
  );
}
