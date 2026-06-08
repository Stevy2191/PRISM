import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';

// Lightweight agenda view of tickets with due dates, grouped by date.
// (Full month calendar and external calendar sync come in a later phase.)
export default function Calendar() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/tickets')
      .then(({ data }) => setTickets(data.tickets))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;

  const today = new Date().toISOString().slice(0, 10);
  const dated = tickets.filter((t) => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const groups = dated.reduce((acc, t) => {
    (acc[t.dueDate] = acc[t.dueDate] || []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(groups);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Calendar</h1>
        <p className="text-sm text-navy-500">Tickets with due dates, grouped by day.</p>
      </div>

      {dates.length === 0 ? (
        <div className="card p-8 text-center text-navy-400">No tickets with due dates.</div>
      ) : (
        <div className="space-y-4">
          {dates.map((date) => (
            <div key={date} className="card">
              <div className={`flex items-center justify-between border-b border-navy-100 px-5 py-3 ${date < today ? 'text-red-600' : 'text-navy-900'}`}>
                <h2 className="font-semibold">{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h2>
                {date < today && <span className="text-xs font-medium">overdue</span>}
              </div>
              <ul className="divide-y divide-navy-100">
                {groups[date].map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-5 py-3">
                    <Link to={`/tickets/${t.id}`} className="font-medium text-navy-800 hover:text-prism">
                      #{t.id} {t.title}
                    </Link>
                    <div className="flex gap-2">
                      <Badge value={t.priority} />
                      <Badge value={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
