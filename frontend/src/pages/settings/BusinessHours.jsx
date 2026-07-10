import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import TimeDropdownPicker from '../../components/TimeDropdownPicker';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKEND_DAYS = ['saturday', 'sunday'];
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo'];

function defaultSchedule() {
  const s = {};
  DAYS.forEach((d) => {
    const weekday = !WEEKEND_DAYS.includes(d);
    s[d] = { start: '09:00', end: '17:00', enabled: weekday };
  });
  return s;
}

const EMPTY = { name: '', departmentId: '', timezone: 'UTC', is24x7: false, holidayListId: '', schedule: defaultSchedule() };

export default function BusinessHours() {
  const [list, setList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [holidayLists, setHolidayLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [form, setForm] = useState(EMPTY);
  const [bulkStart, setBulkStart] = useState('09:00');
  const [bulkEnd, setBulkEnd] = useState('17:00');

  const load = () => {
    Promise.all([api.get('/business-hours'), api.get('/departments'), api.get('/holiday-lists')])
      .then(([b, d, h]) => {
        setList(b.data.businessHours);
        setDepartments(d.data.departments);
        setHolidayLists(h.data.holidayLists);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startNew = () => { setForm(EMPTY); setEditing('new'); };
  const startEdit = (bh) => {
    setForm({
      name: bh.name, departmentId: bh.departmentId || '', timezone: bh.timezone || 'UTC',
      is24x7: !!bh.is24x7, holidayListId: bh.holidayListId || '',
      schedule: bh.schedule || defaultSchedule(),
    });
    setEditing(bh.id);
  };

  const setDay = (day, key, value) =>
    setForm((f) => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule[day], [key]: value } } }));

  const setDaysEnabled = (predicate) =>
    setForm((f) => {
      const schedule = { ...f.schedule };
      DAYS.forEach((d) => { schedule[d] = { ...schedule[d], enabled: predicate(d) }; });
      return { ...f, schedule };
    });

  // The existing per-day checkbox doubles as the "select for bulk apply"
  // signal — no separate selection state needed.
  const checkedDays = form.is24x7 ? [] : DAYS.filter((d) => form.schedule[d]?.enabled);

  const applyBulkTimes = () => {
    setForm((f) => {
      const schedule = { ...f.schedule };
      checkedDays.forEach((d) => { schedule[d] = { ...schedule[d], start: bulkStart, end: bulkEnd }; });
      return { ...f, schedule };
    });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        departmentId: form.departmentId || null,
        holidayListId: form.holidayListId || null,
      };
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

  const clone = async (id) => {
    try {
      const { data } = await api.post(`/business-hours/${id}/clone`);
      setList((l) => [...l, data.businessHours]);
      startEdit(data.businessHours);
    } catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <Spinner />;

  const conflict = form.departmentId
    ? list.find((bh) => String(bh.departmentId) === String(form.departmentId) && bh.id !== editing)
    : null;
  const conflictDeptName = departments.find((d) => String(d.id) === String(form.departmentId))?.name;

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            <div>
              <label className="label">24/7</label>
              <label className="flex h-9 cursor-pointer items-center gap-2">
                <span className="relative inline-flex h-6 w-11 flex-shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={form.is24x7}
                    onChange={(e) => setForm((f) => ({ ...f, is24x7: e.target.checked }))}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-navy-200 transition peer-checked:bg-prism" />
                  <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                </span>
                <span className="text-sm text-navy-700">{form.is24x7 ? 'Always open' : 'Off'}</span>
              </label>
            </div>
          </div>

          <div>
            <label className="label">Holiday List</label>
            <select
              className="input max-w-sm"
              value={form.holidayListId}
              onChange={(e) => setForm((f) => ({ ...f, holidayListId: e.target.value }))}
            >
              <option value="">None</option>
              {holidayLists.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-navy-400">Dates in the linked list are treated as closed days for this schedule.</p>
          </div>

          {conflict && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              {conflictDeptName} already has a schedule assigned ({conflict.name}). Assigning this schedule will replace it.
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-navy-100 pt-4">
            <button type="button" disabled={form.is24x7} onClick={() => setDaysEnabled((d) => !WEEKEND_DAYS.includes(d))} className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40">Weekdays</button>
            <button type="button" disabled={form.is24x7} onClick={() => setDaysEnabled((d) => WEEKEND_DAYS.includes(d))} className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40">Weekends</button>
            <button type="button" disabled={form.is24x7} onClick={() => setDaysEnabled(() => true)} className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40">All Days</button>
            <button type="button" disabled={form.is24x7} onClick={() => setDaysEnabled(() => false)} className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40">Clear All</button>
          </div>

          {checkedDays.length >= 2 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-prism/30 bg-prism/5 p-3">
              <span className="text-sm font-medium text-navy-700">Apply to {checkedDays.length} selected days:</span>
              <TimeDropdownPicker value={bulkStart} onChange={setBulkStart} allowBlank={false} selectClassName="input h-9 w-auto text-sm" />
              <span className="text-navy-400">to</span>
              <TimeDropdownPicker value={bulkEnd} onChange={setBulkEnd} allowBlank={false} selectClassName="input h-9 w-auto text-sm" />
              <button type="button" className="btn-primary text-xs" onClick={applyBulkTimes}>Apply</button>
            </div>
          )}

          <div className="space-y-2">
            {DAYS.map((day) => {
              const effective = form.is24x7
                ? { start: '00:00', end: '23:59', enabled: true }
                : (form.schedule[day] || { start: '09:00', end: '17:00', enabled: false });
              const closed = !effective.enabled;
              return (
                <div key={day} className="flex items-center gap-3">
                  <label className="flex w-32 items-center gap-2 text-sm capitalize text-navy-700">
                    <input type="checkbox" checked={effective.enabled}
                      disabled={form.is24x7}
                      onChange={(e) => setDay(day, 'enabled', e.target.checked)}
                      className="h-4 w-4 rounded border-navy-300 text-prism disabled:cursor-not-allowed" />
                    {day}
                  </label>
                  <TimeDropdownPicker
                    value={effective.start} onChange={(v) => setDay(day, 'start', v)} allowBlank={false}
                    disabled={closed || form.is24x7}
                    selectClassName={`input h-9 w-auto text-sm${closed ? ' opacity-50' : ''}`}
                  />
                  <span className="text-navy-400">to</span>
                  <TimeDropdownPicker
                    value={effective.end} onChange={(v) => setDay(day, 'end', v)} allowBlank={false}
                    disabled={closed || form.is24x7}
                    selectClassName={`input h-9 w-auto text-sm${closed ? ' opacity-50' : ''}`}
                  />
                  {closed && (
                    <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-500">Closed</span>
                  )}
                </div>
              );
            })}
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
                  {bh.is24x7 ? '24/7' : `${DAYS.filter((d) => bh.schedule?.[d]?.enabled).length} working days`}
                  {bh.holidayList && <> · Holidays: {bh.holidayList.name}</>}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => startEdit(bh)} className="text-xs text-prism hover:underline">edit</button>
                <button onClick={() => clone(bh.id)} className="text-xs text-prism hover:underline">clone</button>
                <button onClick={() => remove(bh.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
