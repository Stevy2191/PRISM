import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import TagInput from '../components/TagInput';

export default function ProjectNew() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: '',
    ownerDepartmentId: '',
    forDepartmentId: '',
    assignedToUserId: '',
    teamId: '',
    dueDate: '',
  });
  const [tags, setTags] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [memberIds, setMemberIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setAssignableUsers(data.users)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams)).catch(() => {});
    api.get('/users/directory').then(({ data }) => setDirectory(data.users)).catch(() => {});
    api.get('/project-statuses').then(({ data }) => {
      setStatuses(data.statuses);
      const def = data.statuses.find((s) => s.behaviorType === 'open') || data.statuses[0];
      if (def) setForm((f) => ({ ...f, status: def.name }));
    }).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleMember = (id) => setMemberIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.ownerDepartmentId) {
      setError('Owned by department is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        status: form.status || undefined,
        ownerDepartmentId: form.ownerDepartmentId,
        forDepartmentId: form.forDepartmentId || undefined,
        assignedToUserId: form.assignedToUserId || null,
        teamId: form.teamId || null,
        dueDate: form.dueDate || null,
        tags: tags.length ? tags : undefined,
        memberIds,
      };
      const { data } = await api.post('/projects', payload);
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const memberCandidates = directory.filter((u) => u.displayName.toLowerCase().includes(memberSearch.toLowerCase()));
  const ownerDepartment = departments.find((d) => String(d.id) === String(form.ownerDepartmentId));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">New Project</h1>
        <Link to="/projects" className="btn-secondary">Cancel</Link>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[8rem]" value={form.description} onChange={set('description')} />
        </div>
        <div>
          <label className="label">Tags</label>
          <TagInput tags={tags} onChange={setTags} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Owned by department <span className="text-red-500">*</span></label>
            <select className="input" value={form.ownerDepartmentId} onChange={set('ownerDepartmentId')} required>
              <option value="">Select department…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">Which team does the work.</p>
          </div>
          <div>
            <label className="label">For department</label>
            <select className="input" value={form.forDepartmentId} onChange={set('forDepartmentId')}>
              <option value="">Same as owned by</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">Which department benefits.</p>
          </div>
        </div>
        {ownerDepartment && !ownerDepartment.shortCode && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This department has no short code configured. Project ID will use &quot;DEPT&quot; prefix. Configure it in Settings → Departments.
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Project lead</label>
            <select className="input" value={form.assignedToUserId} onChange={set('assignedToUserId')}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Team</label>
            <select className="input" value={form.teamId} onChange={set('teamId')}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Add initial team members (optional)</label>
          <input
            className="input mb-2"
            placeholder="Search users…"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <div className="max-h-40 overflow-y-auto rounded-md border border-navy-200">
            {memberCandidates.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-navy-50">
                <input type="checkbox" checked={memberIds.includes(u.id)} onChange={() => toggleMember(u.id)} className="h-4 w-4" />
                {u.displayName}
              </label>
            ))}
            {memberCandidates.length === 0 && <p className="px-3 py-2 text-sm text-navy-400">No matches.</p>}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
