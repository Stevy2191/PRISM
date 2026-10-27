// "Assign…": the keyboard and touch way to hand out work on the Workload
// screen. It sends exactly what a drag onto that person and day would (see
// dropPatch), so the two paths can't disagree.
import { useEffect, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import { NO_DATE, longDay } from './dispatch';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled])';

export default function AssignDialog({
  item, people, days, onAssign, onClose,
}) {
  const ref = useRef(null);
  const [personId, setPersonId] = useState('');
  const [day, setDay] = useState(NO_DATE);
  const [saving, setSaving] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves in; Tab stays in; Esc closes; focus goes back to the opener.
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector(FOCUSABLE)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const list = [...ref.current.querySelectorAll(FOCUSABLE)];
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!personId) return;
    setSaving(true);
    try {
      await onAssign(item, people.find((p) => String(p.id) === personId), day);
    } finally {
      setSaving(false);
    }
  };

  const title = `Assign ${item.title}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full space-y-4 rounded-t-2xl border border-navy-100 bg-surface p-5 shadow-lg sm:max-w-sm sm:rounded-xl"
      >
        <div>
          <h2 className="text-base font-semibold text-navy-900">Assign</h2>
          <p className="mt-0.5 truncate text-sm text-navy-500"><span className="num">{item.code}</span> · {item.title}</p>
        </div>
        <div>
          <label className="label" htmlFor="assign-person">Person</label>
          <select id="assign-person" className="input h-11" value={personId} onChange={(e) => setPersonId(e.target.value)} required>
            <option value="">Choose a person…</option>
            {people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="assign-day">Day</label>
          <select id="assign-day" className="input h-11" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value={NO_DATE}>Don&apos;t change the date</option>
            {days.map((d) => <option key={d.date} value={d.date}>{longDay(d.date)}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!personId || saving}>{saving ? 'Assigning…' : 'Assign'}</Button>
        </div>
      </form>
    </div>
  );
}
