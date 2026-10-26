// People x days. Today is tinted, holidays are hatched, over-capacity cells are
// red; a click lists what fills a cell and a drop dispatches work to it.
import Avatar from '../../components/ui/Avatar';
import {
  NO_DATE, cellState, dayHeader, hoursLabel, longDay,
} from './dispatch';

const HATCH = 'repeating-linear-gradient(135deg, var(--color-hover) 0 6px, var(--color-border) 6px 12px)';
const OVER_BG = 'color-mix(in srgb, var(--color-danger) 14%, var(--color-card))';
const TODAY_BG = 'color-mix(in srgb, var(--color-accent-soft) 60%, transparent)';

function personSummary(person, days) {
  let booked = 0;
  let capacity = 0;
  const perDay = new Set();
  for (const d of days) {
    const c = person.cells[d.date];
    if (!c) continue; // eslint-disable-line no-continue
    booked += c.minutes;
    capacity += c.capacity;
    if (c.capacity > 0) perDay.add(c.capacity);
  }
  const steady = perDay.size === 1 ? ` · ${hoursLabel([...perDay][0])} a day` : '';
  return `${hoursLabel(booked)} of ${hoursLabel(capacity)}${steady}`;
}

function Cell({
  person, dateKey, cell, day, today, weekStart, hover, canDropHere, onOpen, onHover, onDrop, tip,
}) {
  const noDate = dateKey === NO_DATE;
  const state = noDate ? (cell.count ? 'normal' : 'free') : cellState(cell);
  const off = state === 'off' && !hover;
  const over = state === 'over';
  const pct = cell.capacity ? Math.min(100, Math.round((cell.minutes / cell.capacity) * 100)) : (cell.minutes ? 100 : 0);
  let background;
  if (hover) background = 'var(--color-accent-soft)';
  else if (off) background = HATCH;
  else if (over) background = OVER_BG;
  else if (dateKey === today) background = TODAY_BG;
  const label = noDate
    ? `${person.name}, no date: ${cell.count} items`
    : `${person.name}, ${longDay(dateKey)}: ${hoursLabel(cell.minutes)} of ${hoursLabel(cell.capacity)}, ${cell.count} items`;
  const empty = noDate && !cell.count;
  return (
    <div
      role="button"
      tabIndex={0}
      data-cell
      data-person={person.id}
      data-date={dateKey}
      data-state={state}
      aria-label={label}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e.currentTarget.getBoundingClientRect()); } }}
      onDragOver={canDropHere ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
      onDragEnter={canDropHere ? () => onHover(true) : undefined}
      onDragLeave={canDropHere ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) onHover(false); } : undefined}
      onDrop={canDropHere ? (e) => { e.preventDefault(); onHover(false); onDrop(); } : undefined}
      className="relative flex h-[76px] flex-col gap-1.5 border-b border-l px-2.5 pt-2.5 hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-prism-accent"
      style={{
        borderColor: 'var(--color-border)',
        borderLeftWidth: weekStart ? 2 : 1,
        background,
        outline: hover ? '2px solid var(--color-accent)' : undefined,
        outlineOffset: -2,
        cursor: 'pointer',
      }}
    >
      {off || (empty) ? (
        <span className="m-auto text-[12.5px] text-navy-400">{noDate ? '' : (day.holiday ? 'Holiday' : 'Off')}</span>
      ) : (
        <>
          <span className="num font-semibold" style={{ color: over ? 'var(--color-danger)' : state === 'free' ? 'var(--color-text-muted)' : undefined }}>
            {state === 'free' ? 'Free' : hoursLabel(cell.minutes)}
          </span>
          {!noDate && (
            <span className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
              <i className="block h-full" style={{ width: `${pct}%`, backgroundColor: over ? 'var(--color-danger)' : 'var(--color-accent)' }} />
            </span>
          )}
          {cell.count > 0 && (
            <span className="text-[12px] text-navy-400">
              {cell.count} {cell.count === 1 ? 'item' : 'items'}{cell.overdue ? ' · overdue' : ''}
            </span>
          )}
        </>
      )}
      {hover && tip && (
        <span className="pointer-events-none absolute left-2 top-[84px] z-20 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold" style={{ backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg)' }}>{tip}</span>
      )}
    </div>
  );
}

export default function WorkloadGrid({
  data, today, dragging, hoverKey, setHoverKey, onOpenCell, onDropOn,
}) {
  const { days, people } = data;
  const columns = `180px repeat(${days.length}, minmax(64px, 1fr)) minmax(78px, 0.8fr)`;
  return (
    <div className="card min-w-0 flex-1 overflow-x-auto" data-workload-grid>
      <div className="grid" style={{ gridTemplateColumns: columns, minWidth: 180 + days.length * 64 + 78 }}>
        <div className="flex h-[52px] items-center border-b px-4 text-[12.5px] text-navy-500" style={{ borderColor: 'var(--color-border)' }}>Person</div>
        {days.map((d, i) => {
          const h = dayHeader(d.date);
          const isToday = d.date === today;
          return (
            <div
              key={d.date}
              className="flex h-[52px] flex-col items-center justify-center border-b border-l text-[12.5px] text-navy-500"
              style={{ borderColor: 'var(--color-border)', borderLeftWidth: i === 5 ? 2 : 1, backgroundColor: isToday ? 'var(--color-accent-soft)' : undefined }}
              aria-current={isToday ? 'date' : undefined}
            >
              {isToday ? 'Today' : h.weekday}
              <b className="num text-[15px] font-semibold" style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{h.day}</b>
            </div>
          );
        })}
        <div className="flex h-[52px] items-center justify-center border-b border-l text-[12.5px] text-navy-500" style={{ borderColor: 'var(--color-border)' }}>No date</div>

        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            days={days}
            today={today}
            dragging={dragging}
            hoverKey={hoverKey}
            setHoverKey={setHoverKey}
            onOpenCell={onOpenCell}
            onDropOn={onDropOn}
          />
        ))}
      </div>
      {!people.length && <p className="p-6 text-sm text-navy-400">No one to show for this team.</p>}
    </div>
  );
}

function PersonRow({
  person, days, today, dragging, hoverKey, setHoverKey, onOpenCell, onDropOn,
}) {
  const keys = [...days.map((d) => d.date), NO_DATE];
  return (
    <>
      <div className="flex h-[76px] items-center gap-2.5 border-b px-4" style={{ borderColor: 'var(--color-border)' }}>
        <Avatar name={person.name} size={30} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy-900">{person.name}</div>
          <div className="num text-[12.5px] text-navy-400">{personSummary(person, days)}</div>
        </div>
      </div>
      {keys.map((key, i) => {
        const day = days.find((d) => d.date === key) || {};
        const cell = person.cells[key];
        const here = `${person.id}|${key}`;
        const off = key !== NO_DATE && cell.capacity === 0 && cell.minutes === 0;
        const canDropHere = !!dragging && !off;
        const tip = dragging
          ? (key === NO_DATE
            ? `Assign to ${person.name}`
            : `Assign to ${person.name} · ${dragging.kind === 'ticket' ? 'plan for' : 'start on'} ${longDay(key)}`)
          : null;
        return (
          <Cell
            key={key}
            person={person}
            dateKey={key}
            cell={cell}
            day={day}
            today={today}
            weekStart={i === 5}
            hover={hoverKey === here}
            canDropHere={canDropHere}
            tip={tip}
            onOpen={(rect) => onOpenCell(person, key, rect)}
            onHover={(on) => setHoverKey(on ? here : (hoverKey === here ? null : hoverKey))}
            onDrop={() => onDropOn(person, key)}
          />
        );
      })}
    </>
  );
}
