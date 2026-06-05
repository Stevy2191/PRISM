import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

function StatCard({ label, value, accent, to }) {
  const body = (
    <div className="card p-5">
      <p className="text-sm font-medium text-navy-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent || 'text-navy-900'}`}>{value}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

const OPEN_STATUSES = ['open', 'in_progress', 'on_hold'];

export default function Dashboard() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/tickets')
      .then(({ data }) => setTickets(data.tickets))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;

  const today = new Date().toISOString().slice(0, 10);
  const openTickets = tickets.filter((t) => OPEN_STATUSES.includes(t.status));
  const myTickets = tickets.filter(
    (t) => t.assigneeId === user.id || t.requesterId === user.id
  );
  const overdue = openTickets.filter((t) => t.dueDate && t.dueDate < today);
  const recent = [...tickets]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Welcome, {user.displayName}</h1>
          <p className="text-sm text-navy-500">Here is what's happening today.</p>
        </div>
        <Link to="/tickets/new" className="btn-primary">+ New Ticket</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open Tickets" value={openTickets.length} accent="text-prism" to="/tickets" />
        <StatCard label="My Tickets" value={myTickets.length} accent="text-sky-600" to="/tickets" />
        <StatCard label="Overdue" value={overdue.length} accent="text-red-600" to="/tickets" />
        <StatCard label="Total Tickets" value={tickets.length} to="/tickets" />
      </div>

      <div className="card">
        <div className="border-b border-navy-100 px-5 py-4">
          <h2 className="font-semibold text-navy-900">Recent Activity</h2>
        </div>
        {recent.length === 0 ? (
          <p className="p-5 text-sm text-navy-500">No tickets yet.</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/tickets/${t.id}`} className="font-medium text-navy-800 hover:text-prism">
                    #{t.id} {t.title}
                  </Link>
                  <p className="text-xs text-navy-400">
                    Updated {new Date(t.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Badge value={t.priority} />
                  <Badge value={t.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
