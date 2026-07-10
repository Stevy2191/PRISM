import { useEffect, useState } from 'react';

// Three side-by-side dropdowns (Hour / Minute / AM-PM), 5-minute increments —
// same visual pattern as TicketDetail.jsx's time-entry-modal TimePicker, but
// this variant supports a genuinely blank/unset state (allowBlank, on by
// default) for optional times like a ticket's due time, where the modal's
// picker always has a real start/end time and never needs a placeholder.
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5);

function parseValue(value) {
  if (!value) return { hour: null, minute: null, meridiem: null };
  const [hStr, mStr] = String(value).split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h24) || Number.isNaN(m)) return { hour: null, minute: null, meridiem: null };
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  let hour = h24 % 12;
  if (hour === 0) hour = 12;
  return { hour, minute: m - (m % 5), meridiem };
}
function toValue(hour, minute, meridiem) {
  if (hour == null || minute == null || !meridiem) return null;
  let h24 = hour % 12;
  if (meridiem === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// value/onChange use a plain 24h "HH:MM" string (or null when unset) — the
// same shape a native <input type="time"> already produces, so this is a
// drop-in replacement with no changes needed to surrounding form state.
export default function TimeDropdownPicker({ value, onChange, allowBlank = true, disabled = false, fieldStyle, selectClassName = 'input h-9 text-sm' }) {
  const [local, setLocal] = useState(() => parseValue(value));

  // Re-sync from the parent only when its value doesn't match what our own
  // local selection would currently produce — that gap means the parent
  // reset us from outside (e.g. due date cleared), not that we're just
  // seeing the echo of our own onChange. Without this check, a partial
  // selection (Hour picked, Minute/AM-PM still blank) would get wiped on
  // every render since a partial pick never produces a non-null value to
  // echo back.
  useEffect(() => {
    const derived = toValue(local.hour, local.minute, local.meridiem);
    if ((value || null) !== (derived || null)) setLocal(parseValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (hour, minute, meridiem) => {
    setLocal({ hour, minute, meridiem });
    if (!allowBlank) {
      onChange(toValue(hour ?? 12, minute ?? 0, meridiem || 'AM'));
      return;
    }
    onChange(toValue(hour, minute, meridiem));
  };

  return (
    <div className="flex gap-2">
      <select
        disabled={disabled}
        value={local.hour ?? ''}
        onChange={(e) => update(e.target.value === '' ? null : Number(e.target.value), local.minute, local.meridiem)}
        className={selectClassName}
        style={fieldStyle}
      >
        {allowBlank && <option value="">Hour</option>}
        {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select
        disabled={disabled}
        value={local.minute ?? ''}
        onChange={(e) => update(local.hour, e.target.value === '' ? null : Number(e.target.value), local.meridiem)}
        className={selectClassName}
        style={fieldStyle}
      >
        {allowBlank && <option value="">Min</option>}
        {MINUTES_5.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select
        disabled={disabled}
        value={local.meridiem ?? ''}
        onChange={(e) => update(local.hour, local.minute, e.target.value || null)}
        className={selectClassName}
        style={fieldStyle}
      >
        {allowBlank && <option value="">AM/PM</option>}
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
