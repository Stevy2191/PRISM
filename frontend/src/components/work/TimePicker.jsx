// A time of day in 5-minute steps, as hour / minute / AM-PM selects. Values
// are minutes since midnight.
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
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

// Minutes since midnight, rounded to the nearest 5.
export function roundToNearest5(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.round(mins / 5) * 5;
}

// The instant, as ISO (UTC), of a wall-clock time on a date in the browser's
// time zone. Sending it with its zone keeps a server in any zone from reading
// it as its own local time (plan 3c review).
export function localDateTime(dateStr, minutesOfDay) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60).toISOString();
}

export default function TimePicker({ minutesOfDay, onChange, idPrefix }) {
  const { h12, m, meridiem } = minutesOfDayToParts(minutesOfDay);
  const update = (nh12, nm, nMeridiem) => onChange(partsToMinutesOfDay(nh12, nm, nMeridiem));
  return (
    <div className="flex gap-2">
      <select aria-label={idPrefix ? `${idPrefix} hour` : 'Hour'} value={h12} onChange={(e) => update(Number(e.target.value), m, meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {PICKER_HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select aria-label={idPrefix ? `${idPrefix} minute` : 'Minute'} value={m} onChange={(e) => update(h12, Number(e.target.value), meridiem)} className="input h-9 text-sm" style={fieldStyle}>
        {/* A recorded time (a timer's) can fall between the 5-minute steps: show it as it is. */}
        {(PICKER_MINUTES_5.includes(m) ? PICKER_MINUTES_5 : [...PICKER_MINUTES_5, m].sort((a, b) => a - b))
          .map((mm) => <option key={mm} value={mm}>{String(mm).padStart(2, '0')}</option>)}
      </select>
      <select aria-label={idPrefix ? `${idPrefix} AM or PM` : 'AM or PM'} value={meridiem} onChange={(e) => update(h12, m, e.target.value)} className="input h-9 text-sm" style={fieldStyle}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
