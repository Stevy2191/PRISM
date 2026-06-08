import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo'];

function defaultSchedule() {
  const s = {};
  DAYS.forEach((d) => {
    const weekday = d !== 'saturday' && d !== 'sunday';
    s[d] = { start: '09:00', end: '17:00', enabled: weekday };
  });
  return s;
}

const EMPTY = { name: '', departmentId: '', timezone: 'UTC', schedule: defaultSchedule() };

export default function BusinessHours() {
  const [list, setList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    Promise.all([api.get('/business-hours'), api.get('/departments')])
      .then(([b, d]) => { setList(b.data.businessHours); setDepartments(d.data.departments); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startNew = () => { setForm(EMPTY); setEditing('new'); };
  const startEdit = (bh) => {
    setForm({
      name: bh.name, departmentId: bh.departmentId || '', timezone: bh.timezone || 'UTC',
      schedule: bh.schedule || defaultSchedule(),
    });
    setEditing(bh.id);
  };

  const setDay = (day, key, value) =>
    setForm((f) => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule[day], [key]: value } } }));

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, departmentId: form.departmentId || null };
      if (editing === 'new') await api.post('/business-hours', payload);
      else await api.patch(`/business-hours/${editing}`, payload);
      setEditing(null); setLoading(true); load();
    } catch (err) { alert(errMessage(err)); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this schedule?')) return;
    try { await api.delete(`/business-hours/${id}`); setList((l) => l.filter((x) => x.id !== id)); }
    catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Business Hours</h1>
        {editing === null && <button onClick={startNew} className="btn-primary">+ New Schedule</button>}
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {editing !== null ? (
        <form onSubmit={save} className="card space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Department</label>
              <select className="input" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                <option value="">Global</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Timezone</label>
              <select className="input" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            {DAYS.map((day) => (
              <div key={day} className="flex items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm capitalize text-navy-700">
                  <input type="checkbox" checked={!!form.schedule[day]?.enabled}
                    onChange={(e) => setDay(day, 'enabled', e.target.checked)}
                    className="h-4 w-4 rounded border-navy-300 text-prism" />
                  {day}
                </label>
                <input type="time" className="input w-32" value={form.schedule[day]?.start || '09:00'}
                  disabled={!form.schedule[day]?.enabled} onChange={(e) => setDay(day, 'start', e.target.value)} />
                <span className="text-navy-400">to</span>
                <input type="time" className="input w-32" value={form.schedule[day]?.end || '17:00'}
                  disabled={!form.schedule[day]?.enabled} onChange={(e) => setDay(day, 'end', e.target.value)} />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn-primary">Save schedule</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {list.length === 0 && <div className="card p-8 text-center text-navy-400">No schedules yet.</div>}
          {list.map((bh) => (
            <div key={bh.id} className="card flex items-center justify-between p-5">
              <div>
                <p className="font-semibold text-navy-900">{bh.name}</p>
                <p className="text-sm text-navy-500">
                  {bh.department?.name || 'Global'} · {bh.timezone} ·{' '}
                  {DAYS.filter((d) => bh.schedule?.[d]?.enabled).length} working days
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => startEdit(bh)} className="text-xs text-prism hover:underline">edit</button>
                <button onClick={() => remove(bh.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
