// Time entry inputs shared by the time entry modal and the timer's log modal.
import { BG, TEXT, formatMinutes, fieldStyle } from '../theme';

// ---- Start/End time picker helpers (5-minute increments, 12h + AM/PM) ----

const PICKER_HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

const PICKER_MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5);

function minutesOfDayToParts(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, m, meridiem };
}

function partsToMinutesOfDay(h12, m, meridiem) {
  let h24 = h12 % 12;
  if (meridiem === 'PM') h24 += 12;
  return h24 * 60 + m;
}

function TimePicker({ minutesOfDay, onChange }) {
  const { h12, m, meridiem } = minutesOfDayToParts(minutesOfDay);
  const update = (nh12, nm, nMeridiem) => onChange(partsToMinutesOfDay(nh12, nm, nMeridiem));
  return (
    <div className="flex gap-2">
      <select value={h12} onChange={(e) => update(Number(e.target.value), m, meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={m} onChange={(e) => update(h12, Number(e.target.value), meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_MINUTES_5.map((mm) => <option key={mm} value={mm}>{String(mm).padStart(2, '0')}</option>)}
      </select>
      <select value={meridiem} onChange={(e) => update(h12, m, e.target.value)} className="input h-9 text-sm" style={fieldStyle}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

// Shared Date + Start Time + End Time + auto-calculated Duration block, used
// by both the manual time entry modal and the timer's log modal.
export function TimeEntryFields({ entryDate, onEntryDateChange, startMinutes, onStartMinutesChange, endMinutes, onEndMinutesChange, todayStr }) {
  const durationMin = endMinutes - startMinutes;
  const valid = durationMin > 0;
  return (
    <>
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Date</label>
      <input
        type="date"
        value={entryDate}
        max={todayStr}
        onChange={(e) => onEntryDateChange(e.target.value)}
        className="input mb-3"
        style={fieldStyle}
      />

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Start Time</label>
      <div className="mb-3">
        <TimePicker minutesOfDay={startMinutes} onChange={onStartMinutesChange} />
      </div>

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>End Time</label>
      <div className="mb-3">
        <TimePicker minutesOfDay={endMinutes} onChange={onEndMinutesChange} />
      </div>

      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Duration</label>
      <div
        className="mb-3 rounded-md border px-3 py-2 font-mono text-sm font-semibold"
        style={{
          borderColor: valid ? 'var(--color-success)' : 'var(--color-danger)',
          color: valid ? 'var(--color-success)' : 'var(--color-danger)',
          backgroundColor: BG,
        }}
      >
        {valid ? formatMinutes(durationMin) : 'End time must be after start time'}
      </div>
    </>
  );
}

// Shared by the manual time entry modal and the timer's log modal — only
// rendered at all when the caller has confirmed canLogTimeForOthers, so no
// permission check happens here.
export function LoggedForField({ assignableUsers, currentUser, value, onChange }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Logged for</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input h-9 text-sm"
        style={fieldStyle}
      >
        <option value={currentUser.id}>Yourself ({currentUser.displayName})</option>
        {assignableUsers
          .filter((u) => u.id !== currentUser.id)
          .map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
      </select>
    </div>
  );
}
