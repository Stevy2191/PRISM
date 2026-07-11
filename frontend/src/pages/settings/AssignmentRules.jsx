import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const TYPE_OPTIONS = [['incident', 'Incident'], ['request', 'Request'], ['problem', 'Problem'], ['change', 'Change']];
const PRIORITY_OPTIONS = [['critical', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

const EMPTY = { name: '', ticketType: '', departmentId: '', priority: '', targetType: 'user', assigneeId: '', teamId: '' };

function conditionSummary(rule) {
  const parts = [];
  parts.push(rule.ticketType ? `type = ${rule.ticketType}` : 'any type');
  parts.push(rule.department ? `dept = ${rule.department.name}` : 'any department');
  parts.push(rule.priority ? `priority = ${rule.priority}` : 'any priority');
  return parts.join(' AND ');
}

export default function AssignmentRules() {
  const [rules, setRules] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([
      api.get('/assignment-rules'),
      api.get('/departments'),
      api.get('/users/assignable'),
      api.get('/teams'),
    ])
      .then(([r, d, u, t]) => {
        setRules(r.data.rules);
        setDepartments(d.data.departments);
        setUsers(u.data.users);
        setTeams(t.data.teams);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (rule) => {
    setForm({
      name: rule.name,
      ticketType: rule.ticketType || '',
      departmentId: rule.departmentId || '',
      priority: rule.priority || '',
      targetType: rule.teamId ? 'team' : 'user',
      assigneeId: rule.assigneeId || '',
      teamId: rule.teamId || '',
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        ticketType: form.ticketType || null,
        departmentId: form.departmentId || null,
        priority: form.priority || null,
        assigneeId: form.targetType === 'user' ? (form.assigneeId || null) : null,
        teamId: form.targetType === 'team' ? (form.teamId || null) : null,
      };
      if (editingId) await api.patch(`/assignment-rules/${editingId}`, payload);
      else await api.post('/assignment-rules', payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule) => {
    try {
      await api.patch(`/assignment-rules/${rule.id}`, { isActive: !rule.isActive });
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const remove = async (rule) => {
    if (!confirm(`Delete "${rule.name}"?`)) return;
    try {
      await api.delete(`/assignment-rules/${rule.id}`);
      setRules((list) => list.filter((r) => r.id !== rule.id));
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Assignment Rules</h1>
          <p className="text-sm text-navy-500">
            Auto-assign new tickets by type, department, and priority. Rules are checked top to
            bottom — the first match wins, and only applies when the ticket has no assignee already.
            For anything more complex (multi-step conditions, other trigger events), use Workflow Rules instead.
          </p>
        </div>
        {!showForm && <button className="btn-primary flex-shrink-0" onClick={openCreate}>+ New rule</button>}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div>
            <label className="label">Rule name</label>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">If ticket type</label>
              <select className="input" value={form.ticketType} onChange={(e) => setForm((f) => ({ ...f, ticketType: e.target.value }))}>
                <option value="">Any</option>
                {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">If department</label>
              <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                <option value="">Any</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">If priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                <option value="">Any</option>
                {PRIORITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="border-t border-navy-100 pt-4">
            <label className="label">Assign to</label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="input max-w-[8rem]"
                value={form.targetType}
                onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value, assigneeId: '', teamId: '' }))}
              >
                <option value="user">A user</option>
                <option value="team">A team</option>
              </select>
              {form.targetType === 'user' ? (
                <select className="input max-w-xs" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))} required>
                  <option value="">Select user…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              ) : (
                <select className="input max-w-xs" value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))} required>
                  <option value="">Select team…</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
          </div>
        </form>
      )}

      {rules.length === 0 && !showForm ? (
        <div className="card p-8 text-center text-navy-400">No assignment rules yet.</div>
      ) : (
        <div className="card divide-y divide-navy-100">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-navy-900">{rule.name}</p>
                  {!rule.isActive && <span className="badge bg-navy-100 text-navy-500">Inactive</span>}
                </div>
                <p className="mt-0.5 text-xs text-navy-500">
                  {conditionSummary(rule)} → assign to {rule.team ? `team "${rule.team.name}"` : rule.assignee?.displayName || 'nobody'}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                <button onClick={() => toggleActive(rule)} className="text-prism hover:underline">{rule.isActive ? 'disable' : 'enable'}</button>
                <button onClick={() => openEdit(rule)} className="text-prism hover:underline">edit</button>
                <button onClick={() => remove(rule)} className="text-red-500 hover:underline">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
