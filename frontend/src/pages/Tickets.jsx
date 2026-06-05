import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export default function Tickets() {
  const { isStaff } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', priority: '' });
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    api
      .get('/tickets', { params })
      .then(({ data }) => setTickets(data.tickets))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (ticket, status) => {
    try {
      const { data } = await api.patch(`/tickets/${ticket.id}`, { status });
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? data.ticket : t)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const sorted = [...tickets].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const av = a[sort.key] ?? '';
    const bv = b[sort.key] ?? '';
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const SortHeader = ({ label, k }) => (
    <th className="table-th cursor-pointer select-none" onClick={() => toggleSort(k)}>
      {label} {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Tickets</h1>
        <Link to="/tickets/new" className="btn-primary">+ New Ticket</Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className="input max-w-[12rem]"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          className="input max-w-[12rem]"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                <SortHeader label="ID" k="id" />
                <SortHeader label="Title" k="title" />
                <SortHeader label="Priority" k="priority" />
                <th className="table-th">Status</th>
                <SortHeader label="Type" k="type" />
                <SortHeader label="Due" k="dueDate" />
                <th className="table-th">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {sorted.length === 0 && (
                <tr>
                  <td className="table-td text-navy-400" colSpan={7}>No tickets found.</td>
                </tr>
              )}
              {sorted.map((t) => (
                <tr key={t.id} className="hover:bg-navy-50">
                  <td className="table-td font-mono text-navy-500">#{t.id}</td>
                  <td className="table-td">
                    <Link to={`/tickets/${t.id}`} className="font-medium text-navy-800 hover:text-prism">
                      {t.title}
                    </Link>
                  </td>
                  <td className="table-td"><Badge value={t.priority} /></td>
                  <td className="table-td">
                    {isStaff ? (
                      <select
                        className="rounded border border-navy-200 bg-white px-2 py-1 text-xs"
                        value={t.status}
                        onChange={(e) => updateStatus(t, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    ) : (
                      <Badge value={t.status} />
                    )}
                  </td>
                  <td className="table-td"><Badge value={t.type} /></td>
                  <td className="table-td text-navy-500">{t.dueDate || '—'}</td>
                  <td className="table-td text-navy-600">{t.assignee?.displayName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
