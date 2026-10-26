// Workload (sub-project 6): who is busy with what, tickets and project tasks
// together, and drag-to-dispatch. The server works out every number from what
// the viewer may see; this page draws it and sends the drops.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import Pill from '../../components/ui/Pill';
import { usePermission } from '../../context/AuthContext';
import { localToday } from '../projects/detail/taskFilters';
import CellPopover from './CellPopover';
import UnassignedLane from './UnassignedLane';
import WorkloadGrid from './WorkloadGrid';
import { dropPatch, mondayOf, rangeLabel, shiftFrom } from './dispatch';

const KINDS = [['all', 'Tickets and tasks'], ['tickets', 'Tickets'], ['tasks', 'Tasks']];

const chevron = (d) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={d} /></svg>;

export default function Workload() {
  const canSetHours = usePermission('settings.manage_business_hours');
  const [from, setFrom] = useState(null); // null = the server's "this week"
  const [days, setDays] = useState(10);
  const [teamId, setTeamId] = useState('');
  const [kinds, setKinds] = useState('all');
  const [teams, setTeams] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [open, setOpen] = useState(null); // { person, key, rect }
  const today = localToday();

  // keepError: a refetch after a refused drop must not wipe that message.
  const load = useCallback(async (keepError = false) => {
    const params = { days, today, kinds };
    if (from) params.from = from;
    if (teamId) params.teamId = teamId;
    try {
      const { data: res } = await api.get('/workload', { params });
      setData(res);
      if (!keepError) setError('');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [from, days, today, teamId, kinds]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/teams').then(({ data: t }) => setTeams(t.teams || [])).catch(() => {}); }, []);

  const move = (direction) => setFrom(shiftFrom(data?.from || from || mondayOf(today), days, direction));
  const range = data?.days?.length ? rangeLabel([data.days[0].date, data.days[data.days.length - 1].date]) : '';

  const drop = async (person, key) => {
    const item = dragging;
    setDragging(null);
    setHoverKey(null);
    setOpen(null);
    if (!item) return;
    const { url, body } = dropPatch(item, person.id, key);
    setNote('');
    try {
      const { data: res } = await api.patch(url, body);
      if (res?.shiftOffer) setNote('Some tasks wait on the one you moved. Open its project to move them too.');
      setError('');
    } catch (err) {
      setError(errMessage(err));
    }
    await load(true);
  };

  const popover = useMemo(() => {
    if (!open || !data) return null;
    const person = data.people.find((p) => p.id === open.person.id);
    if (!person) return null;
    const items = (data.items[person.id] || []).filter((i) => i.byDay[open.key] != null);
    return { person, items, cell: person.cells[open.key] };
  }, [open, data]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">Workload</h1>
        <p className="mt-1 text-sm text-navy-500">
          Who's busy with what — tickets and project tasks together. Drag work onto a person and a day to hand it out. Counts work you can see.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="icon" size="sm" aria-label={days === 5 ? 'Previous week' : 'Previous two weeks'} onClick={() => move(-1)}>{chevron('M15 6l-6 6 6 6')}</Button>
        <b className="num min-w-[120px] text-center text-navy-900">{range}</b>
        <Button variant="icon" size="sm" aria-label={days === 5 ? 'Next week' : 'Next two weeks'} onClick={() => move(1)}>{chevron('M9 6l6 6-6 6')}</Button>
        <Button size="sm" onClick={() => setFrom(null)}>This week</Button>
        <div role="group" aria-label="Range" className="flex gap-1">
          <Pill on={days === 5} onClick={() => setDays(5)}>1 week</Pill>
          <Pill on={days === 10} onClick={() => setDays(10)}>2 weeks</Pill>
        </div>
        <span className="flex-1" />
        <select className="input !w-auto" aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
        </select>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {KINDS.map(([id, label]) => <Pill key={id} on={kinds === id} onClick={() => setKinds(id)}>{label}</Pill>)}
        </div>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}
      {note && <Notice tone="info">{note}</Notice>}

      {data && (
        <div className="flex flex-col items-start gap-5 lg:flex-row">
          <UnassignedLane
            items={data.unassigned}
            dragging={dragging}
            onDragStart={setDragging}
            onDragEnd={() => { setDragging(null); setHoverKey(null); }}
          />
          <WorkloadGrid
            data={data}
            today={data.today || today}
            dragging={dragging}
            hoverKey={hoverKey}
            setHoverKey={setHoverKey}
            onOpenCell={(person, key, rect) => setOpen({ person, key, rect })}
            onDropOn={drop}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-navy-500">
        <span><i className="mr-1.5 inline-block h-2.5 w-[18px] rounded-sm align-middle" style={{ backgroundColor: 'var(--color-accent)' }} />Booked hours against what they have that day</span>
        <span><i className="mr-1.5 inline-block h-2.5 w-[18px] rounded-sm align-middle" style={{ backgroundColor: 'var(--color-danger)' }} />Over what they have</span>
        <span><i className="mr-1.5 inline-block h-2.5 w-[18px] rounded-sm align-middle" style={{ background: 'repeating-linear-gradient(135deg, var(--color-hover) 0 4px, var(--color-border-strong) 4px 8px)' }} />Holiday</span>
        <span>Click a day to see what's in it.</span>
      </div>

      {popover && (
        <CellPopover
          anchor={open.rect}
          person={popover.person}
          dateKey={open.key}
          cell={popover.cell}
          items={popover.items}
          defaultTicketNote={(
            <p className="mt-2 text-xs text-navy-400">
              Tickets with no estimate count as the default ticket size.
              {canSetHours && <> Change that in <Link to="/settings/work-hours" className="underline">Settings</Link>.</>}
            </p>
          )}
          dragging={dragging}
          onDragStart={setDragging}
          onDragEnd={() => { setDragging(null); setHoverKey(null); }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
