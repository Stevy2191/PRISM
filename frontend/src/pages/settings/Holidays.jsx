import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';

export default function Holidays() {
  const [lists, setLists] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newList, setNewList] = useState({ name: '', departmentId: '' });
  const [holidayDrafts, setHolidayDrafts] = useState({}); // listId -> { name, date }

  const load = () => {
    Promise.all([api.get('/holiday-lists'), api.get('/departments')])
      .then(([h, d]) => { setLists(h.data.holidayLists); setDepartments(d.data.departments); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const createList = async (e) => {
    e.preventDefault();
    if (!newList.name.trim()) return;
    try {
      const { data } = await api.post('/holiday-lists', { name: newList.name, departmentId: newList.departmentId || null });
      setLists((l) => [...l, { ...data.holidayList, holidays: [] }]);
      setNewList({ name: '', departmentId: '' });
    } catch (err) { alert(errMessage(err)); }
  };

  const removeList = async (id) => {
    if (!confirm('Delete this list and all its holidays?')) return;
    try { await api.delete(`/holiday-lists/${id}`); setLists((l) => l.filter((x) => x.id !== id)); }
    catch (err) { alert(errMessage(err)); }
  };

  const addHoliday = async (listId) => {
    const draft = holidayDrafts[listId] || {};
    if (!draft.name?.trim() || !draft.date) return;
    try {
      const { data } = await api.post(`/holiday-lists/${listId}/holidays`, { name: draft.name, date: draft.date });
      setLists((l) => l.map((x) => x.id === listId ? { ...x, holidays: [...(x.holidays || []), data.holiday] } : x));
      setHolidayDrafts((d) => ({ ...d, [listId]: { name: '', date: '' } }));
    } catch (err) { alert(errMessage(err)); }
  };

  const removeHoliday = async (listId, holidayId) => {
    try {
      await api.delete(`/holiday-lists/${listId}/holidays/${holidayId}`);
      setLists((l) => l.map((x) => x.id === listId ? { ...x, holidays: x.holidays.filter((h) => h.id !== holidayId) } : x));
    } catch (err) { alert(errMessage(err)); }
  };

  const draft = (id) => holidayDrafts[id] || { name: '', date: '' };
  const setDraft = (id, key, value) => setHolidayDrafts((d) => ({ ...d, [id]: { ...draft(id), [key]: value } }));

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <h1 className="text-2xl font-bold text-navy-900">Holiday Lists</h1>
      <p className="text-sm text-navy-500">Holidays pause SLA timers for the assigned department (or globally).</p>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={createList} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="flex-1">
          <label className="label">New list name</label>
          <input className="input" value={newList.name} onChange={(e) => setNewList((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="label">Applies to</label>
          <select className="input" value={newList.departmentId} onChange={(e) => setNewList((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">Global</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-primary">Add list</button>
      </form>

      {lists.map((list) => (
        <div key={list.id} className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-navy-900">{list.name}</p>
              <p className="text-xs text-navy-400">{list.department?.name || 'Global'}</p>
            </div>
            <button onClick={() => removeList(list.id)} className="text-xs text-red-500 hover:underline">delete list</button>
          </div>
          <ul className="mt-3 divide-y divide-navy-100">
            {(list.holidays || []).map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span><span className="font-medium text-navy-800">{h.date}</span> — {h.name}</span>
                <button onClick={() => removeHoliday(list.id, h.id)} className="text-xs text-red-500 hover:underline">remove</button>
              </li>
            ))}
            {(list.holidays || []).length === 0 && <li className="py-2 text-sm text-navy-400">No holidays.</li>}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input flex-1" placeholder="Holiday name" value={draft(list.id).name} onChange={(e) => setDraft(list.id, 'name', e.target.value)} />
            <input type="date" className="input w-44" value={draft(list.id).date} onChange={(e) => setDraft(list.id, 'date', e.target.value)} />
            <button onClick={() => addHoliday(list.id)} className="btn-secondary">Add</button>
          </div>
        </div>
      ))}
      {lists.length === 0 && <div className="card p-8 text-center text-navy-400">No holiday lists yet.</div>}
    </div>
  );
}
