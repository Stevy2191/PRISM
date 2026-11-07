// Try it (PB2): the checklist as one device would see it. Asks the server
// (POST /forms/try); nothing is saved. Reports the lines that would be
// hidden so the editor can grey them.
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import api, { errMessage } from '../../../api/api';

const selectClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-2 text-sm';

export default function TryIt({
  usage, definition, lookups, onResult,
}) {
  const [categoryId, setCategoryId] = useState('');
  const [mdm, setMdm] = useState('none');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (usage !== 'device') return null;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/forms/try', {
        usage, definition: definition(), device: { categoryId: categoryId ? Number(categoryId) : null, mdm: mdm === 'none' ? 'none' : Number(mdm) },
      });
      const hidden = new Set(data.evaluation.sections.flatMap((s) => s.items.filter((i) => !(s.shown && i.shown)).map((i) => i.key)));
      setResult(data);
      onResult(hidden);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const clear = () => { setResult(null); onResult(null); };

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold">Try it</h3>
      <p className="mt-1 text-xs text-navy-400">See the checklist as a technician would for one device.</p>
      <div className="mt-3 grid gap-2">
        <select className={selectClass} aria-label="Device type" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Any type</option>
          {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={selectClass} aria-label="MDM" value={mdm} onChange={(e) => setMdm(e.target.value)}>
          {lookups.mdms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="none">Not managed</option>
        </select>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={run} disabled={busy}>{busy ? 'Trying…' : 'Try it'}</Button>
        {result && <Button size="sm" variant="quiet" onClick={clear}>Show all</Button>}
      </div>
      {result && (
        <p className="mt-3 text-sm" role="status">
          <b>{result.shown}</b> {result.shown === 1 ? 'step would show' : 'steps would show'}; <b>{result.hidden}</b> {result.hidden === 1 ? 'is' : 'are'} hidden by Only for.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
