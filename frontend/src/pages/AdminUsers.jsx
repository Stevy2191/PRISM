import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import NewAccountForm from '../components/users/NewAccountForm';
import { useAuth } from '../context/AuthContext';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const { isOwner } = useAuth();

  const pager = usePagination({ storageKey: 'prism.adminUsers.pageSize' });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/users', { params: { scope: 'department', ...pager.params } }),
      api.get('/departments'),
    ])
      .then(([u, d]) => {
        setUsers(u.data.users);
        pager.applyMeta(u.data);
        setDepartments(d.data.departments);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pager.page, pager.limit]);

  const updateUser = async (id, changes) => {
    try {
      const { data } = await api.patch(`/users/${id}`, changes);
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...data.user } : u)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await api.delete(`/users/${id}`);
      setUsers((us) => us.filter((u) => u.id !== id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const resetPassword = async (u) => {
    const pw = prompt(`Set a new temporary password for ${u.displayName} (min 8 chars).\nThey will be required to change it on next login.`);
    if (!pw) return;
    try {
      await api.patch(`/users/${u.id}`, { password: pw });
      setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, mustChangePassword: true } : x)));
      alert('Password reset. The user must change it on next login.');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">Users</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
          {showCreate ? 'Close' : '+ New Local Account'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {showCreate && (
        <NewAccountForm
          departments={departments}
          onCreated={(user) => navigate(`/admin/users/${user.id}`)}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr>
              <th className="table-th">Name</th>
              <th className="table-th">Username</th>
              <th className="table-th">Type</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Department</th>
              <th className="table-th">Last login</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {users.map((u) => {
              const fullName = (u.firstName || u.lastName) ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : u.username;
              // An administrator's account is changed only by an Owner.
              const locked = u.administrator && !isOwner;
              return (
              <tr key={u.id} className="hover:bg-navy-50">
                <td className="table-td font-medium">
                  <Link to={`/admin/users/${u.id}`} className="text-prism hover:underline">{fullName}</Link>
                  {u.jobTitle && <p className="mt-0.5 text-xs font-normal text-navy-400">{u.jobTitle}</p>}
                </td>
                <td className="table-td text-navy-500">{u.username}</td>
                <td className="table-td">
                  {u.isLocalAccount ? (
                    <span className="badge bg-violet-100 text-violet-800">
                      Local{u.mustChangePassword ? ' · pending pw' : ''}
                    </span>
                  ) : (
                    <span className="badge bg-sky-100 text-sky-800">AD</span>
                  )}
                </td>
                <td className="table-td text-navy-500">{u.email || '—'}</td>
                <td className="table-td">
                  {u.primaryRole ? (
                    <span className="badge bg-navy-100 text-navy-700">{u.primaryRole.name}</span>
                  ) : (
                    <span className="text-xs text-navy-400">No role assigned</span>
                  )}
                </td>
                <td className="table-td">
                  <select
                    className="rounded border border-navy-200 bg-surface px-2 py-1 text-xs text-navy-800"
                    value={u.departmentId || ''}
                    disabled={locked}
                    title={locked ? 'Only an Owner can change an administrator\'s account' : undefined}
                    onChange={(e) => updateUser(u.id, { departmentId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="table-td text-navy-400">
                  {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}
                </td>
                <td className="table-td">
                  <div className="flex gap-3">
                    <Link to={`/admin/users/${u.id}`} className="text-xs text-prism hover:underline">
                      roles &amp; permissions
                    </Link>
                    {u.isLocalAccount && !locked && (
                      <button onClick={() => resetPassword(u)} className="text-xs text-prism hover:underline">
                        reset pw
                      </button>
                    )}
                    {!locked && (
                      <button onClick={() => deleteUser(u.id)} className="text-xs text-red-500 hover:underline">
                        delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && users.length > 0 && (
          <Pagination
            page={pager.page}
            limit={pager.limit}
            total={pager.total}
            totalPages={pager.totalPages}
            onPageChange={pager.setPage}
            onLimitChange={pager.setLimit}
          />
        )}
      </div>
    </div>
  );
}
