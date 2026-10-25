// Settings → Recurring tickets → new/edit (5b). The template is the fields of
// the ticket each run opens; the schedule says when. The server checks the
// template against your access on save and the rule then runs as you.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import CategoryPicker from '../../components/CategoryPicker';
import { buildIndex, isEffectivelyActive } from '../../components/categoryTree';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import TimeDropdownPicker from '../../components/TimeDropdownPicker';
import { ContactPicker } from '../tickets/new/ContactPicker';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  title: '', description: '', priority: 'medium', type: 'request', contactId: null, departmentId: '', teamId: '', assigneeId: '', categoryId: null,
  tasks: [], frequency: 'weekly', interval: 1, weekdays: [1], dayOfMonth: 1, monthOfYear: 1, timeOfDay: '09:00',
  timezone: '', startDate: today(), endDate: '',
};

export default function RecurringTicketEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [contact, setContact] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  // Worked out from the category picked now (not the saved rule): the
  // same test the run uses before putting the category on the ticket.
  const categoryWarning = (() => {
    if (!form.categoryId) return '';
    const index = buildIndex(categories);
    const node = index.get(Number(form.categoryId));
    if (!node) return '';
    if (!isEffectivelyActive(index, node.id)) return 'This category is retired: runs create the ticket without one until you pick another.';
    if (node.requireChild && categories.some((c) => c.parentId === node.id && c.active)) {
      return 'This category needs a sub-category: runs create the ticket without one until you pick one.';
    }
    return '';
  })();
  const [runsAs, setRunsAs] = useState(null);
  const [preview, setPreview] = useState({ runs: [], error: '' });
  const [newTask, setNewTask] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(data.teams || [])).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setUsers(data.users)).catch(() => {});
    api.get('/ticket-categories').then(({ data }) => setCategories(data.categories || [])).catch(() => {});
    if (isNew) {
      api.get('/settings').then(({ data }) => {
        const tz = data?.settings?.['company.timezone'] || data?.['company.timezone'];
        if (tz) setForm((f) => ({ ...f, timezone: f.timezone || tz }));
      }).catch(() => {});
      return;
    }
    api.get(`/recurring-tickets/${id}`)
      .then(({ data }) => {
        const r = data.rule;
        setForm({
          ...EMPTY, ...r,
          description: r.description || '', departmentId: r.departmentId || '', teamId: r.teamId || '', assigneeId: r.assigneeId || '',
          weekdays: r.weekdays || [1], dayOfMonth: r.dayOfMonth || 1, monthOfYear: r.monthOfYear || 1, endDate: r.endDate || '',
        });
        setContact(r.contact);
        setRunsAs(r.runsAs);
      })
      .catch((err) => { alert(errMessage(err)); navigate('/settings/recurring-tickets'); })
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = {
    frequency: form.frequency, interval: Number(form.interval), weekdays: form.weekdays, dayOfMonth: Number(form.dayOfMonth),
    monthOfYear: Number(form.monthOfYear), timeOfDay: form.timeOfDay, timezone: form.timezone || undefined,
    startDate: form.startDate, endDate: form.endDate || null,
  };
  const scheduleKey = JSON.stringify(schedule);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post('/recurring-tickets/preview', { schedule })
        .then(({ data }) => setPreview({ runs: data.runs, error: '' }))
        .catch((err) => setPreview({ runs: [], error: errMessage(err) }));
    }, 300);
    return () => clearTimeout(t);
  }, [scheduleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleDay = (d) => setForm((f) => ({
    ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d].sort(),
  }));
  const addTask = () => {
    if (!newTask.trim()) return;
    setForm((f) => ({ ...f, tasks: [...f.tasks, newTask.trim()] }));
    setNewTask('');
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        title: form.title, description: form.description || null, priority: form.priority, type: form.type,
        contactId: contact?.id || null, departmentId: form.departmentId || null, teamId: form.teamId || null,
        assigneeId: form.assigneeId || null, categoryId: form.categoryId || null, tasks: form.tasks, ...schedule,
      };
      if (isNew) await api.post('/recurring-tickets', body);
      else await api.patch(`/recurring-tickets/${id}`, body);
      navigate('/settings/recurring-tickets');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <SettingsPage description={isNew ? 'A ticket opened automatically on a schedule.' : `Runs as ${runsAs?.displayName || '—'}. Saving makes it run as you.`}>
      <form onSubmit={save} className="space-y-4" data-testid="recurring-editor">
        <div className="card space-y-3 p-5">
          <p className="eyebrow">The ticket</p>
          <div>
            <label className="label" htmlFor="rt-title">Title</label>
            <input id="rt-title" className="input" maxLength={255} value={form.title} onChange={set('title')} required />
          </div>
          <div>
            <label className="label" htmlFor="rt-desc">Description</label>
            <textarea id="rt-desc" className="input min-h-[80px] resize-y" value={form.description} onChange={set('description')} />
          </div>
          <div>
            <span className="label">Customer</span>
            <ContactPicker selectedContact={contact} onSelect={setContact} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rt-priority">Priority</label>
              <select id="rt-priority" className="input" value={form.priority} onChange={set('priority')}>
                {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rt-type">Type</label>
              <select id="rt-type" className="input" value={form.type} onChange={set('type')}>
                {['incident', 'request', 'problem', 'change', 'task'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rt-dept">Department</label>
              <select id="rt-dept" className="input" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">Customer's department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rt-team">Team</label>
              <select id="rt-team" className="input" value={form.teamId} onChange={set('teamId')}>
                <option value="">No team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {categories.length > 0 && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="rt-category">Category</label>
                <CategoryPicker
                  categories={categories}
                  value={form.categoryId}
                  onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
                  includeRetiredValue
                  id="rt-category"
                />
                {categoryWarning && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-warning)' }} data-testid="rt-category-warning">{categoryWarning}</p>
                )}
              </div>
            )}
            <div>
              <label className="label" htmlFor="rt-assignee">Assignee</label>
              <select id="rt-assignee" className="input" value={form.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span className="label">Tasks</span>
            <ul className="mb-2 space-y-1">
              {form.tasks.map((t, i) => (
                <li key={`${t}-${i}`} className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text-primary)' }}>
                  {t}
                  <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setForm((f) => ({ ...f, tasks: f.tasks.filter((_, j) => j !== i) }))}>remove</button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input className="input flex-1" value={newTask} maxLength={255} placeholder="Add a task" aria-label="New task"
                onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }} />
              <button type="button" className="btn-secondary" onClick={addTask}>Add</button>
            </div>
          </div>
        </div>

        <div className="card space-y-3 p-5">
          <p className="eyebrow">The schedule</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="rt-every">Repeat every</label>
              <input id="rt-every" type="number" min={1} max={365} className="input w-24" value={form.interval} onChange={set('interval')} />
            </div>
            <div>
              <label className="label" htmlFor="rt-freq">Unit</label>
              <select id="rt-freq" className="input" value={form.frequency} onChange={set('frequency')}>
                <option value="daily">Day(s)</option>
                <option value="weekly">Week(s)</option>
                <option value="monthly">Month(s)</option>
                <option value="yearly">Year(s)</option>
              </select>
            </div>
            {form.frequency === 'yearly' && (
              <div>
                <label className="label" htmlFor="rt-month">Month</label>
                <select id="rt-month" className="input" value={form.monthOfYear} onChange={set('monthOfYear')}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
            )}
            {(form.frequency === 'monthly' || form.frequency === 'yearly') && (
              <div>
                <label className="label" htmlFor="rt-dom">Day</label>
                <input id="rt-dom" type="number" min={1} max={31} className="input w-20" value={form.dayOfMonth} onChange={set('dayOfMonth')} />
              </div>
            )}
          </div>
          {form.frequency === 'weekly' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Weekdays">
              {DAY_NAMES.map((d, i) => (
                <button key={d} type="button" aria-pressed={form.weekdays.includes(i)} onClick={() => toggleDay(i)}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium"
                  style={form.weekdays.includes(i)
                    ? { backgroundColor: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white' }
                    : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label">Time</span>
              <TimeDropdownPicker value={form.timeOfDay} onChange={(v) => setForm((f) => ({ ...f, timeOfDay: v || '09:00' }))} allowBlank={false} />
            </div>
            <div>
              <label className="label" htmlFor="rt-tz">Time zone</label>
              <select id="rt-tz" className="input" value={form.timezone} onChange={set('timezone')}>
                <option value="">Organisation's</option>
                {[...new Set([form.timezone, ...TIMEZONES].filter(Boolean))].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rt-start">Starts</label>
              <input id="rt-start" type="date" className="input" value={form.startDate} onChange={set('startDate')} required />
            </div>
            <div>
              <label className="label" htmlFor="rt-end">Ends (optional)</label>
              <input id="rt-end" type="date" className="input" value={form.endDate} onChange={set('endDate')} />
            </div>
          </div>
          <div data-testid="recurring-preview">
            <p className="eyebrow">Next 5 runs</p>
            {preview.error
              ? <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{preview.error}</p>
              : (
                <ul className="mt-1 font-mono text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {preview.runs.map((r) => <li key={r}>{new Date(r).toLocaleString()}</li>)}
                  {preview.runs.length === 0 && <li>No runs (the end date has passed).</li>}
                </ul>
              )}
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Saving makes this rule run with your access.</p>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <Link to="/settings/recurring-tickets" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </SettingsPage>
  );
}
