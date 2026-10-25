// Quick time buttons on the task panel: one click logs 15 min, 30 min, 1 h or
// 2 h to today on this task (the server fills in the default work type).
import { useState } from 'react';
import api, { errMessage } from '../../../api/api';
import Button from '../../../components/ui/Button';
import Pill from '../../../components/ui/Pill';

const QUICK = [['15 min', 15], ['30 min', 30], ['1 h', 60], ['2 h', 120]];

export default function QuickTime({ timePath, taskId, today, onLogged }) {
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(null); // null: closed, else the minutes typed
  const [done, setDone] = useState('');

  const log = async (minutes, label) => {
    setBusy(true);
    setDone('');
    try {
      await api.post(timePath, { taskId, durationMinutes: minutes, entryDate: today });
      setDone(`Logged ${label}`);
      setOther(null);
      await onLogged();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const minutes = Number(other);
  const valid = other !== null && other !== '' && Number.isInteger(minutes) && minutes > 0;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map(([label, m]) => (
          <Pill key={label} disabled={busy} aria-pressed={undefined} onClick={() => log(m, label)}>{label}</Pill>
        ))}
        <Pill disabled={busy} aria-pressed={undefined} onClick={() => setOther(other === null ? '' : null)}>Other…</Pill>
      </div>
      {other !== null && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number" min="1" step="1" autoFocus aria-label="Minutes to log" placeholder="Minutes"
            className="input !h-8 !w-28" value={other} onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid) { e.preventDefault(); log(minutes, `${minutes} min`); } }}
          />
          <Button size="sm" variant="primary" disabled={busy || !valid} onClick={() => log(minutes, `${minutes} min`)}>Log</Button>
        </div>
      )}
      <p className="mt-1.5 text-[12.5px] text-navy-400" aria-live="polite">
        {done || 'Logs to today with your default work type.'}
      </p>
    </div>
  );
}
