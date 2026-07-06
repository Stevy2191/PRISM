import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import AccessRestricted, { isForbidden } from '../../components/AccessRestricted';

const ACTION_LABELS = {
  role_assigned: 'Role assigned',
  role_removed: 'Role removed',
  override_granted: 'Override created',
  override_revoked: 'Override revoked',
};

function formatDetail(log) {
  const d = log.detail || {};
  if (log.action === 'role_assigned' || log.action === 'role_removed') {
    return d.roleName || `role #${d.roleId}`;
  }
  if (log.action === 'override_granted' || log.action === 'override_revoked') {
    const access = d.granted ? 'grant' : 'deny';
    const expiry = d.expiresAt ? ` until ${new Date(d.expiresAt).toLocaleString()}` : '';
    return `${d.permissionKey} (${access}${expiry})${d.reason ? ` — ${d.reason}` : ''}`;
  }
  return JSON.stringify(d);
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setLoading(true);
    setForbidden(false);
    const params = { page, limit: 25 };
    if (action) params.action = action;
    api.get('/audit-log', { params })
      .then(({ data }) => {
        setLogs(data.logs);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      })
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(errMessage(err));
      })
      .finally(() => setLoading(false));
  }, [page, action]);

  if (forbidden) return <AccessRestricted />;

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Audit Log</h1>
      <p className="text-sm text-navy-500">Every role assignment and permission override change, system-wide.</p>

      <div className="card flex flex-wrap items-end gap-3 p-5">
        <div>
          <label className="label">Action</label>
          <select className="input" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-navy-100">
              <thead className="bg-navy-50">
                <tr>
                  <th className="table-th">When</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Actor</th>
                  <th className="table-th">Target</th>
                  <th className="table-th">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-navy-50">
                    <td className="table-td whitespace-nowrap text-navy-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="table-td">
                      <span className="badge bg-navy-100 text-navy-700">{ACTION_LABELS[log.action] || log.action}</span>
                    </td>
                    <td className="table-td">{log.actor?.displayName || '—'}</td>
                    <td className="table-td">{log.target?.displayName || '—'}</td>
                    <td className="table-td text-navy-500">{formatDetail(log)}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={5} className="table-td text-navy-400">No matching activity.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-navy-500">
            <span>{total} total</span>
            <div className="flex items-center gap-3">
              <button
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                className="btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
