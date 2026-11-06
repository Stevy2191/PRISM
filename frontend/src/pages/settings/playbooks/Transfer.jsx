// Export and import of forms and playbooks (PB). An export names MDMs,
// device types, companies and departments; importing matches those names
// here and asks about any it can't, then saves everything switched off for
// review.
import { useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import api, { errMessage } from '../../../api/api';

const KIND_LABELS = { mdm: 'MDM', category: 'Device type', company: 'Company', department: 'Department' };
const OPTION_URLS = { mdm: '/mdms', category: '/assets/categories' };

export async function exportAll() {
  try {
    const [f, p] = await Promise.all([api.get('/forms'), api.get('/playbooks')]);
    const { data } = await api.post('/playbooks/export', { formIds: f.data.forms.map((x) => x.id), playbookIds: p.data.playbooks.map((x) => x.id) });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prism-playbooks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { alert(errMessage(err)); }
}

export function ImportDialog({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const [options, setOptions] = useState({});
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');

  const read = async (f) => {
    setError('');
    try {
      const parsed = JSON.parse(await f.text());
      setFile(parsed);
      const { data } = await api.post('/playbooks/import', { file: parsed, dryRun: true });
      setCheck(data);
      const kinds = [...new Set(data.needs.filter((n) => !n.resolved).map((n) => n.kind))];
      const loaded = {};
      for (const k of kinds) {
        if (OPTION_URLS[k]) {
          const { data: d } = await api.get(OPTION_URLS[k]); // eslint-disable-line no-await-in-loop
          loaded[k] = d.mdms || d.categories || [];
        }
      }
      setOptions(loaded);
    } catch (err) { setError(err instanceof SyntaxError ? "That file isn't valid JSON" : errMessage(err)); }
  };
  const setMap = (kind, name, value) => setMapping((m) => ({ ...m, [kind]: { ...(m[kind] || {}), [name]: value } }));
  const unresolved = check ? check.needs.filter((n) => !n.resolved) : [];
  const ready = unresolved.every((n) => mapping[n.kind] && Object.prototype.hasOwnProperty.call(mapping[n.kind], n.name));
  const run = async () => {
    try {
      const { data } = await api.post('/playbooks/import', { file, mapping });
      onImported(data);
    } catch (err) { setError(errMessage(err)); }
  };

  return (
    <Modal title="Import forms and playbooks" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm">
        <input type="file" accept="application/json,.json" onChange={(e) => e.target.files[0] && read(e.target.files[0])} aria-label="File to import" />
        {check && <p>{check.forms} form{check.forms === 1 ? '' : 's'} and {check.playbooks} playbook{check.playbooks === 1 ? '' : 's'}. They arrive switched off, for you to review first.</p>}
        {unresolved.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">These names aren&apos;t in PRISM. Choose what each means here, or drop it:</p>
            {unresolved.map((n) => (
              <label key={`${n.kind}:${n.name}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                <span>{KIND_LABELS[n.kind]}: <b>{n.name}</b></span>
                {options[n.kind] ? (
                  <select className="h-9 rounded-md border border-navy-200 bg-surface px-2" value={mapping[n.kind]?.[n.name] ?? ''} onChange={(e) => setMap(n.kind, n.name, e.target.value === 'drop' ? null : Number(e.target.value))}>
                    <option value="" disabled>Choose…</option>
                    <option value="drop">Drop it</option>
                    {options[n.kind].map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : (
                  <select className="h-9 rounded-md border border-navy-200 bg-surface px-2" value={mapping[n.kind]?.[n.name] === null ? 'drop' : ''} onChange={() => setMap(n.kind, n.name, null)}>
                    <option value="" disabled>Choose…</option>
                    <option value="drop">Drop it</option>
                  </select>
                )}
              </label>
            ))}
          </div>
        )}
        {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div className="flex justify-end gap-2 border-t border-navy-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!check || !ready} onClick={run}>Import</Button>
        </div>
      </div>
    </Modal>
  );
}
