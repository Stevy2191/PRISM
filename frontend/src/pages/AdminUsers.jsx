import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

const ROLES = ['admin', 'technician', 'requester'];

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/users'), api.get('/departments')])
      .then(([u, d]) => {
        setUsers(u.data.users);
        setDepartments(d.data.departments);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const updateUser = async (id, changes) => {
    try {
      const { data } = await api.patch(`/users/${id}`, changes);
      setUsers((us) => us.map((u) => (u.id === id ? data.user : u)));
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

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-navy-900">Users</h1>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr>
              <th className="table-th">Name</th>
              <th className="table-th">Username</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Department</th>
              <th className="table-th">Last login</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-navy-50">
                <td className="table-td font-medium">{u.displayName}</td>
                <td className="table-td text-navy-500">{u.username}</td>
                <td className="table-td text-navy-500">{u.email || '—'}</td>
                <td className="table-td">
                  <select
                    className="rounded border border-navy-200 bg-white px-2 py-1 text-xs"
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="table-td">
                  <select
                    className="rounded border border-navy-200 bg-white px-2 py-1 text-xs"
                    value={u.departmentId || ''}
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
                  <button onClick={() => deleteUser(u.id)} className="text-xs text-red-500 hover:underline">
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
