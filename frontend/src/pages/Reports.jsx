import { useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

function formatMinutes(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export default function Reports() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [ticketReport, setTicketReport] = useState(null);
  const [timeReport, setTimeReport] = useState(null);
  const [csatReport, setCsatReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    Promise.all([
      api.get('/reports/tickets', { params }),
      api.get('/reports/time', { params }),
      api.get('/reports/csat', { params }),
    ])
      .then(([t, tm, cs]) => {
        setTicketReport(t.data);
        setTimeReport(tm.data);
        setCsatReport(cs.data);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const params = { format: 'csv' };
      if (range.from) params.from = range.from;
      if (range.to) params.to = range.to;
      const res = await api.get('/reports/time', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prism-time-report.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const statusData = (ticketReport?.byStatus || []).map((r) => ({
    name: String(r.status).replace(/_/g, ' '),
    count: Number(r.count),
  }));
  const priorityData = (ticketReport?.byPriority || []).map((r) => ({
    name: r.priority,
    count: Number(r.count),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy-900">Reports</h1>

      <div className="card flex flex-wrap items-end gap-3 p-5">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <button onClick={load} className="btn-primary">Apply</button>
        {(range.from || range.to) && (
          <button onClick={() => setRange({ from: '', to: '' })} className="btn-secondary">Clear</button>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title={`Tickets by Status (${ticketReport?.total || 0} total)`}>
              <Chart data={statusData} color="#3a5da6" />
            </ChartCard>
            <ChartCard title="Tickets by Priority">
              <Chart data={priorityData} color="#38bdf8" />
            </ChartCard>
          </div>

          {/* Time logged */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-navy-900">
              Time Logged · Total {formatMinutes(timeReport?.totalMinutes)}
            </h2>
            <button onClick={exportCsv} className="btn-secondary">Export CSV</button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <TimeTable title="By User" rows={timeReport?.byUser} label="User" />
            <TimeTable title="By Project" rows={timeReport?.byProject} label="Project" />
            <TimeTable title="By Department" rows={timeReport?.byDepartment} label="Department" />
          </div>

          {/* Customer satisfaction */}
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-navy-900">Customer Satisfaction</h2>
            <CsatScore overall={csatReport?.overall} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CsatTable title="By Technician" rows={csatReport?.byTechnician} label="Technician" />
            <CsatTable title="By Department" rows={csatReport?.byDepartment} label="Department" />
          </div>
        </>
      )}
    </div>
  );
}

function CsatScore({ overall }) {
  if (!overall || !overall.total) return <span className="text-sm text-navy-400">No responses yet</span>;
  return (
    <span className="text-sm text-navy-600">
      <span className="text-lg font-bold text-prism">{overall.score}%</span>{' '}
      satisfaction · {overall.total} response{overall.total === 1 ? '' : 's'}
      {' '}(😀 {overall.happy} · 😐 {overall.neutral} · ☹️ {overall.unhappy})
    </span>
  );
}

function CsatTable({ title, rows, label }) {
  const data = rows || [];
  return (
    <div className="card">
      <div className="border-b border-navy-100 px-5 py-3">
        <h2 className="font-semibold text-navy-900">{title}</h2>
      </div>
      <table className="min-w-full divide-y divide-navy-100">
        <thead className="bg-navy-50">
          <tr>
            <th className="table-th">{label}</th>
            <th className="table-th">Score</th>
            <th className="table-th">Responses</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {data.map((row) => (
            <tr key={row.key} className="hover:bg-navy-50">
              <td className="table-td">{row.label}</td>
              <td className="table-td font-medium">{row.score == null ? '—' : `${row.score}%`}</td>
              <td className="table-td text-navy-500">{row.total}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={3} className="table-td text-navy-400">No data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TimeTable({ title, rows, label }) {
  const data = rows || [];
  return (
    <div className="card">
      <div className="border-b border-navy-100 px-5 py-3">
        <h2 className="font-semibold text-navy-900">{title}</h2>
      </div>
      <table className="min-w-full divide-y divide-navy-100">
        <thead className="bg-navy-50">
          <tr>
            <th className="table-th">{label}</th>
            <th className="table-th">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {data.map((row) => (
            <tr key={row.key} className="hover:bg-navy-50">
              <td className="table-td">{row.label}</td>
              <td className="table-td">{formatMinutes(row.minutes)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={2} className="table-td text-navy-400">No data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="card p-5">
      <h2 className="mb-4 font-semibold text-navy-900">{title}</h2>
      <div className="h-64">{children}</div>
    </div>
  );
}

function Chart({ data, color }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-navy-400">No data.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
