import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const EMPTY = { name: '', description: '', departmentId: '', members: [] };

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    Promise.all([api.get('/teams'), api.get('/departments'), api.get('/users')])
      .then(([t, d, u]) => { setTeams(t.data.teams); setDepartments(d.data.departments); setUsers(u.data.users); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startNew = () => { setForm(EMPTY); setEditing('new'); };
  const startEdit = (team) => {
    setForm({
      name: team.name, description: team.description || '', departmentId: team.departmentId || '',
      members: (team.memberships || []).map((m) => ({ userId: m.userId, isLead: m.isLead })),
    });
    setEditing(team.id);
  };

  const toggleMember = (userId) => setForm((f) => {
    const exists = f.members.find((m) => m.userId === userId);
    return {
      ...f,
      members: exists ? f.members.filter((m) => m.userId !== userId) : [...f.members, { userId, isLead: false }],
    };
  });
  const toggleLead = (userId) => setForm((f) => ({
    ...f,
    members: f.members.map((m) => m.userId === userId ? { ...m, isLead: !m.isLead } : m),
  }));

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, departmentId: form.departmentId || null };
      if (editing === 'new') await api.post('/teams', payload);
      else await api.patch(`/teams/${editing}`, payload);
      setEditing(null); setLoading(true); load();
    } catch (err) { alert(errMessage(err)); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this team?')) return;
    try { await api.delete(`/teams/${id}`); setTeams((t) => t.filter((x) => x.id !== id)); }
    catch (err) { alert(errMessage(err)); }
  };

  const isMember = (userId) => form.members.some((m) => m.userId === userId);
  const isLead = (userId) => form.members.find((m) => m.userId === userId)?.isLead;

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Teams</h1>
        {editing === null && <button onClick={startNew} className="btn-primary">+ New Team</button>}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null ? (
        <form onSubmit={save} className="card space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Department</label>
              <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Members</label>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-navy-100 p-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-navy-50">
                  <label className="flex items-center gap-2 text-sm text-navy-700">
                    <input type="checkbox" checked={isMember(u.id)} onChange={() => toggleMember(u.id)}
                      className="h-4 w-4 rounded border-navy-300 text-prism" />
                    {u.displayName} <span className="text-xs text-navy-400">({u.primaryRole?.name || 'no role'})</span>
                  </label>
                  {isMember(u.id) && (
                    <label className="flex items-center gap-1 text-xs text-navy-500">
                      <input type="checkbox" checked={!!isLead(u.id)} onChange={() => toggleLead(u.id)}
                        className="h-3 w-3 rounded border-navy-300 text-prism" />
                      lead
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn-primary">Save team</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {teams.length === 0 && <div className="card p-8 text-center text-navy-400">No teams yet.</div>}
          {teams.map((team) => (
            <div key={team.id} className="card flex items-center justify-between p-5">
              <div>
                <p className="font-semibold text-navy-900">{team.name}</p>
                <p className="text-sm text-navy-500">
                  {team.department?.name || 'No department'} · {(team.memberships || []).length} member(s)
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => startEdit(team)} className="text-xs text-prism hover:underline">edit</button>
                <button onClick={() => remove(team.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
