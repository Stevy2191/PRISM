import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import { formatTicketId } from '../../utils/ticketId';

const ACTION_META = {
  ticket_created: { label: 'Ticket created', cls: 'bg-green-100 text-green-800' },
  reply_added: { label: 'Reply added', cls: 'bg-blue-100 text-blue-800' },
  ignored: { label: 'Ignored', cls: 'bg-navy-100 text-navy-600' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
};

export default function EmailLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/settings/email-log')
      .then(({ data }) => setLogs(data.logs))
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Email Log</h1>
        <p className="text-sm text-navy-500">The last 100 emails the inbound processor looked at, including ones it skipped or failed on.</p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                <th className="table-th">When</th>
                <th className="table-th">From</th>
                <th className="table-th">Subject</th>
                <th className="table-th">Action</th>
                <th className="table-th">Ticket</th>
                <th className="table-th">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {logs.map((log) => {
                const meta = ACTION_META[log.action] || { label: log.action, cls: 'bg-navy-100 text-navy-600' };
                return (
                  <tr key={log.id} className="hover:bg-navy-50">
                    <td className="table-td whitespace-nowrap text-navy-500">{new Date(log.processedAt).toLocaleString()}</td>
                    <td className="table-td">{log.fromEmail || '—'}</td>
                    <td className="table-td max-w-xs truncate">{log.subject || '—'}</td>
                    <td className="table-td">
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="table-td">
                      {log.ticket ? (
                        <Link to={`/tickets/${log.ticket.id}`} className="text-prism hover:underline">
                          {formatTicketId(log.ticket)}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="table-td text-red-600">{log.error || ''}</td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="table-td text-navy-400">No emails processed yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
