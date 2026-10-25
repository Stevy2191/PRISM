// The Timeline tab: phases and tasks as bars on a day grid. Drag a bar to move
// it, drag either end to resize (snapping to days). Arrows show what waits on
// what. View-only without edit access and on a phone (scroll, no drag).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Button from '../../../components/ui/Button';
import { workPaths } from '../../../components/work/workPaths';
import ShiftBanner from './ShiftBanner';
import { groupByPhase, isDone, shortCode } from './taskFilters';
import DependencyArrows from './timeline/DependencyArrows';
import TimelineBars, { ROW } from './timeline/TimelineBars';
import {
  ZOOM, addDays, barRect, chartRange, dragResult, formatMonth, formatShort, isWeekend, isoWeekday, layout,
} from './timeline/geometry';
import { useBarDrag } from './timeline/useBarDrag';

const LABEL_W = 280;
const HEAD_H = 40;
const ZOOMS = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']];

function useNarrow() {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

// Header ticks: every day (week zoom), every Monday (month), the 1st (quarter).
function ticks(lay, zoom) {
  const out = [];
  for (let i = 0; i < lay.days; i += 1) {
    const date = addDays(lay.from, i);
    const day = Number(date.slice(8));
    if (zoom === 'week') out.push({ date, x: i * lay.zoom, text: String(day), strong: isoWeekday(date) === 1 ? formatShort(date) : null });
    else if (zoom === 'month' && isoWeekday(date) === 1) out.push({ date, x: i * lay.zoom, text: formatShort(date) });
    else if (zoom === 'quarter' && day === 1) out.push({ date, x: i * lay.zoom, text: formatMonth(date) });
  }
  return out;
}

export default function TimelineTab({ projectId, tasks, phases, canEdit, today, onChanged }) {
  const paths = workPaths('project', projectId);
  const [zoomKey, setZoomKey] = useState('month');
  const [deps, setDeps] = useState([]);
  const [offer, setOffer] = useState(null);
  const [shifting, setShifting] = useState(false);
  const scroller = useRef(null);
  const narrow = useNarrow();
  const zoom = ZOOM[zoomKey];

  // Re-read the arrows whenever the tasks change (a drag reloads them).
  useEffect(() => {
    let live = true;
    api.get(`/projects/${projectId}/dependencies`)
      .then(({ data }) => { if (live) setDeps(data.dependencies || []); })
      .catch(() => { if (live) setDeps([]); });
    return () => { live = false; };
  }, [projectId, tasks]);

  const { from, days } = useMemo(() => chartRange(tasks, phases, today), [tasks, phases, today]);
  const lay = useMemo(() => layout({ from, days, zoom }), [from, days, zoom]);
  const groups = useMemo(() => groupByPhase(tasks, phases), [tasks, phases]);

  // Rows: a phase row (when it has a span or tasks) then its dated tasks.
  const { rows, unscheduled } = useMemo(() => {
    const out = [];
    const none = [];
    groups.forEach((g) => {
      const dated = g.tasks.filter((t) => t.startDate || t.dueDate);
      none.push(...g.tasks.filter((t) => !t.startDate && !t.dueDate));
      if (!dated.length) return;
      if (g.phase) out.push({ key: `p${g.phase.id}`, phase: g.phase });
      dated.forEach((t) => out.push({ key: `t${t.id}`, task: t }));
    });
    return { rows: out, unscheduled: none };
  }, [groups]);

  const onCommit = useCallback(async (task, mode, delta) => {
    const next = dragResult(task, mode, delta);
    try {
      const { data } = await api.patch(paths.task(task.id), next);
      const found = data.shiftOffer;
      setOffer(found
        ? { taskId: task.id, code: shortCode(task.code), days: found.days, count: found.tasks.length }
        : null);
    } catch (err) { alert(errMessage(err)); }
    await onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, onChanged]);

  const canDrag = canEdit && !narrow;
  const { drag, begin } = useBarDrag({ enabled: canDrag, zoomPx: zoom, onCommit });

  const shiftThem = async () => {
    setShifting(true);
    try { await api.post(`${paths.task(offer.taskId)}/shift-dependents`, { days: offer.days }); } catch (err) { alert(errMessage(err)); }
    setShifting(false);
    setOffer(null);
    await onChanged();
  };

  // Keep today in view: on first draw, on a zoom change and on the Today button.
  const showToday = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, LABEL_W + lay.dayToX(today) - el.clientWidth / 2);
  }, [lay, today]);
  useLayoutEffect(showToday, [zoomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayX = lay.dayToX(today) + zoom / 2;
  const chartH = rows.length * ROW;

  // Arrow endpoints: the bar being dragged is drawn where the pointer has it.
  const rectOf = (task, i) => {
    const shown = drag && drag.taskId === task.id ? dragResult(task, drag.mode, drag.delta) : task;
    const r = barRect(shown, lay);
    return r && { ...r, y: i * ROW + ROW / 2 };
  };
  const links = useMemo(() => {
    const at = new Map(rows.map((r, i) => [r.task?.id, i]).filter(([id]) => id != null));
    const task = new Map(rows.filter((r) => r.task).map((r) => [r.task.id, r.task]));
    return deps.map((d) => {
      const pi = at.get(d.predecessorId);
      const si = at.get(d.successorId);
      if (pi == null || si == null) return null;
      const from = rectOf(task.get(d.predecessorId), pi);
      const to = rectOf(task.get(d.successorId), si);
      return from && to ? { id: d.id, from, to } : null;
    }).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, rows, lay, drag]);

  const weekends = [];
  for (let i = 0; i < days; i += 1) if (isWeekend(addDays(from, i))) weekends.push(i);

  const marks = ticks(lay, zoomKey);
  const gridW = LABEL_W + lay.width;

  return (
    <div>
      {offer && <ShiftBanner offer={offer} busy={shifting} onMove={shiftThem} onLeave={() => setOffer(null)} />}
      <div className="my-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Zoom" className="inline-flex overflow-hidden rounded-lg border border-navy-100">
          {ZOOMS.map(([key, label]) => (
            <button
              key={key} type="button" aria-pressed={zoomKey === key} onClick={() => setZoomKey(key)}
              className="h-8 px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:min-h-[44px]"
              style={zoomKey === key
                ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
                : { color: 'var(--color-text-secondary)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={showToday}>Today</Button>
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-4 text-[13px] text-navy-500">
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-[22px] rounded-[3px]" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)' }} />Planned</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-[22px] rounded-[3px]" style={{ background: 'var(--color-border-strong)' }} />Done</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-[22px] rounded-[3px]" style={{ background: 'var(--color-waiting-bg)', border: '1px solid var(--color-warning)' }} />Waiting</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-[22px] rounded-[3px]" style={{ border: '1px dashed var(--color-text-faint)' }} />No one assigned</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: 'var(--color-text-primary)' }} />Milestone</span>
        </div>
      </div>

      <div ref={scroller} data-timeline-scroll className="overflow-x-auto rounded-xl border border-navy-100 bg-surface">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-navy-400">Nothing is scheduled yet. Give a task a start or due date to see it here.</p>
        ) : (
          <div className="relative" style={{ width: gridW }}>
            <div className="flex border-b border-navy-100" style={{ height: HEAD_H }}>
              <div className="sticky left-0 z-30 flex items-center bg-surface px-4 text-[12.5px] font-medium text-navy-500" style={{ width: LABEL_W, flex: 'none' }}>Task</div>
              <div className="relative" style={{ width: lay.width }}>
                {marks.map((m) => (
                  <span
                    key={m.date} className="absolute flex h-full items-center border-l border-navy-100 pl-1.5 text-[12.5px] text-navy-500"
                    style={{ left: m.x }}
                  >
                    {m.strong || m.text}
                  </span>
                ))}
                <span
                  className="absolute top-2.5 rounded-full px-2 text-[11px] font-bold"
                  style={{ left: todayX + 4, background: 'var(--color-danger)', color: 'var(--color-bg)' }}
                >
                  Today
                </span>
              </div>
            </div>
            <div className="flex">
              <div className="sticky left-0 z-30 bg-surface" style={{ width: LABEL_W, flex: 'none' }}>
                {rows.map((r) => (
                  <div
                    key={r.key} className="flex items-center gap-2 overflow-hidden whitespace-nowrap border-b border-navy-100 px-4"
                    style={{ height: ROW, fontWeight: r.phase ? 650 : 400, background: r.phase ? 'var(--color-hover)' : undefined }}
                  >
                    {r.task && <span className="num w-[34px] flex-none text-[12.5px] text-navy-500">{shortCode(r.task.code)}</span>}
                    <span className="min-w-0 flex-1 truncate text-sm text-navy-900">{r.phase ? r.phase.name : r.task.title}</span>
                  </div>
                ))}
              </div>
              <div className="relative" style={{ width: lay.width, height: chartH }}>
                {weekends.map((i) => (
                  <div key={i} className="absolute top-0 h-full" style={{ left: i * zoom, width: zoom, background: 'var(--color-hover)', opacity: 0.55 }} />
                ))}
                <TimelineBars rows={rows} lay={lay} drag={drag} isDone={isDone} onBegin={canDrag ? begin : undefined} />
                <DependencyArrows links={links} width={lay.width} height={chartH} rowHeight={ROW} />
                <div
                  data-today-line className="pointer-events-none absolute top-0 z-10 h-full w-0.5"
                  style={{ left: todayX - 1, background: 'var(--color-danger)', opacity: 0.8 }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {unscheduled.length > 0 && (
        <section className="mt-5" aria-label="Not scheduled">
          <h3 className="eyebrow">Not scheduled</h3>
          <ul className="mt-2 divide-y divide-navy-100 rounded-xl border border-navy-100 bg-surface text-sm">
            {unscheduled.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                <span className="num w-[34px] text-[12.5px] text-navy-500">{shortCode(t.code)}</span>
                <span className="min-w-0 flex-1 truncate text-navy-900">{t.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-3 text-[13px] text-navy-500">
        {canDrag
          ? 'Drag a bar to move it. Drag either end to change how long it takes. Arrows show what each task waits on; add them from the task’s details.'
          : 'Arrows show what each task waits on. Open a task from the Tasks tab to change its dates.'}
      </p>
    </div>
  );
}
