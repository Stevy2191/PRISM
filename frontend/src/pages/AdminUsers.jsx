import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

const EMPTY_FORM = { username: '', displayName: '', email: '', departmentId: '', password: '' };

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/users', { params: { scope: 'department' } }), api.get('/departments')])
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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const createUser = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const payload = { ...form, departmentId: form.departmentId || null, email: form.email || null };
      const { data } = await api.post('/users', payload);
      setUsers((us) => [...us, data.user].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setForm(EMPTY_FORM);
      setShowCreate(false);
    } catch (err) {
      setCreateError(errMessage(err));
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Users</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
          {showCreate ? 'Close' : '+ New Local Account'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {showCreate && (
        <form onSubmit={createUser} className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-navy-900">Create local account</h2>
            <p className="text-sm text-navy-500">
              Local accounts sign in with a username/email + password. AD users are
              created automatically on their first directory login. The new user must
              change their password on first login.
            </p>
          </div>
          {createError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Username</label>
              <input className="input" value={form.username} onChange={set('username')} required />
            </div>
            <div>
              <label className="label">Display name</label>
              <input className="input" value={form.displayName} onChange={set('displayName')} required />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="label">Temporary password</label>
              <input type="password" className="input" value={form.password} onChange={set('password')} required minLength={8} />
            </div>
            <div>
              <label className="label">Department</label>
              <select className="input" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-navy-400">
            Assign a role from the Roles &amp; Permissions tab after the account is created.
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
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
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-navy-50">
                <td className="table-td font-medium">
                  <Link to={`/admin/users/${u.id}`} className="text-prism hover:underline">{u.displayName}</Link>
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
                    {u.isLocalAccount && (
                      <button onClick={() => resetPassword(u)} className="text-xs text-prism hover:underline">
                        reset pw
                      </button>
                    )}
                    <button onClick={() => deleteUser(u.id)} className="text-xs text-red-500 hover:underline">
                      delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
