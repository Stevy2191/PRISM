// Hours people work (sub-project 6): the default week every person starts
// from, the size a ticket with no estimate counts as, and per-person weeks.
// Workload reads all three; the server enforces who may change them.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Notice from '../../components/ui/Notice';
import Button from '../../components/ui/Button';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

const DAYS = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['7', 'Sunday']];
const FALLBACK = { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0, 7: 0 };

const toHours = (minutes) => String(Math.round((Number(minutes) / 60) * 100) / 100);
const toMinutes = (hours) => Math.round(Number(hours) * 60);
const weekToForm = (week) => Object.fromEntries(DAYS.map(([k]) => [k, toHours((week || FALLBACK)[k] ?? 0)]));
const validHours = (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 24 && Number.isInteger(toMinutes(v));
const weekValid = (form) => DAYS.every(([k]) => validHours(form[k]));
const formToWeek = (form) => Object.fromEntries(DAYS.map(([k]) => [k, toMinutes(form[k])]));

function summary(week) {
  const worked = DAYS.filter(([k]) => Number(week[k]) > 0);
  if (!worked.length) return 'No working days';
  return worked.map(([k, name]) => `${name.slice(0, 3)} ${toHours(week[k])} h`).join(', ');
}

function WeekInputs({ form, onChange, idPrefix }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {DAYS.map(([k, name]) => (
        <label key={k} className="flex flex-col gap-1 text-[13px] text-navy-500" htmlFor={`${idPrefix}-${k}`}>
          {name}
          <input
            id={`${idPrefix}-${k}`}
            type="number"
            inputMode="decimal"
            min="0"
            max="24"
            step="0.25"
            className="input num"
            aria-invalid={!validHours(form[k])}
            value={form[k]}
            onChange={(e) => onChange({ ...form, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function PersonRow({ person, defaults, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const own = person.workHours;

  const start = () => { setForm(weekToForm(own || defaults)); setEditing(true); };
  const send = async (workHours) => {
    setBusy(true);
    onError('');
    try {
      const { data } = await api.patch(`/users/${person.id}/work-hours`, { workHours });
      onSaved(person.id, data.user.workHours ?? null);
      setEditing(false);
    } catch (err) {
      onError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-5 py-3" data-person-hours={person.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-navy-900">{person.displayName}</div>
          <div className="num text-[12.5px] text-navy-400">{own ? summary(own) : 'Uses the default week'}</div>
        </div>
        {!editing && <Button size="sm" onClick={start} aria-label={`Change hours for ${person.displayName}`}>{own ? 'Change' : 'Set own hours'}</Button>}
      </div>
      {editing && (
        <>
          <WeekInputs form={form} onChange={setForm} idPrefix={`wh-${person.id}`} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || !weekValid(form)} onClick={() => send(formToWeek(form))}>Save hours</Button>
            {own && <Button size="sm" disabled={busy} onClick={() => send(null)}>Use the default</Button>}
            <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function WorkHours() {
  const [form, setForm] = useState(null); // { week, ticket }
  const [snapshot, setSnapshot] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/settings'), api.get('/users/assignable', { params: { withHours: 1 } })])
      .then(([s, u]) => {
        let week = FALLBACK;
        try { week = JSON.parse(s.data.settings['workload.defaultWorkHours']) || FALLBACK; } catch { /* keep the built-in week */ }
        const loaded = { week: weekToForm(week), ticket: String(Number(s.data.settings['workload.defaultTicketMinutes']) || 60) };
        setForm(loaded);
        setSnapshot(loaded);
        setPeople(u.data.users);
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const ticketOk = form && /^\d+$/.test(form.ticket) && Number(form.ticket) >= 15 && Number(form.ticket) <= 1440;
  const valid = form && weekValid(form.week) && ticketOk;

  const save = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', {
        settings: {
          'workload.defaultWorkHours': JSON.stringify(formToWeek(form.week)),
          'workload.defaultTicketMinutes': String(Number(form.ticket)),
        },
      });
      setSnapshot(form);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!form) return <SettingsPage>{error && <Notice tone="bad">{error}</Notice>}</SettingsPage>;

  const defaults = formToWeek(form.week);
  return (
    <SettingsPage description="How many hours each person has on each weekday. Workload measures booked work against these.">
      {error && <Notice tone="bad">{error}</Notice>}
      <form onSubmit={save} className="space-y-5">
        <SettingsPanel title="Default week" description="What everyone has unless you set their own hours below.">
          <div className="space-y-3 px-5 py-4">
            <WeekInputs form={form.week} onChange={(week) => { setSaved(false); setForm({ ...form, week }); }} idPrefix="wh-default" />
            <p className="text-xs text-navy-400">
              Hours, from 0 to 24. Holidays are taken off. Workload shows Monday to Friday only, so Saturday and Sunday hours
              are saved but not shown there.
            </p>
          </div>
          <SettingsRow label="Ticket size" htmlFor="wh-ticket" help="What a ticket with no estimate counts as on Workload.">
            <div className="flex items-center gap-2">
              <input
                id="wh-ticket"
                type="number"
                min="15"
                max="1440"
                step="5"
                className="input num !w-28"
                aria-invalid={!ticketOk}
                value={form.ticket}
                onChange={(e) => { setSaved(false); setForm({ ...form, ticket: e.target.value }); }}
              />
              <span className="text-sm text-navy-500">minutes (15 to 1440)</span>
            </div>
          </SettingsRow>
        </SettingsPanel>
        <SaveBar dirty={isDirty(form, snapshot)} saving={saving} saved={saved} disabled={!valid} />
      </form>

      <SettingsPanel title="Per person" description="Someone who works different hours, for example part time. Everyone else uses the default week.">
        {people.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            defaults={defaults}
            onError={setError}
            onSaved={(id, workHours) => setPeople((list) => list.map((x) => (x.id === id ? { ...x, workHours } : x)))}
          />
        ))}
        {!people.length && <p className="px-5 py-4 text-sm text-navy-400">No one to show.</p>}
      </SettingsPanel>
    </SettingsPage>
  );
}
