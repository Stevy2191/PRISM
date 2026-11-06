// Settings → MDMs (PB): the device management tools this organization uses.
// Devices pick from the list and forms can show steps for one MDM only.
// Nothing is built in. A retired MDM stays on its devices but can't be
// picked for new ones; there is no delete.
import { useEffect, useState } from 'react';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';

const inputClass = 'h-9 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm';

export default function Mdms() {
  const [mdms, setMdms] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', consoleUrl: '' });
  const load = () => api.get('/mdms').then(({ data }) => setMdms(data.mdms)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);

  const patch = async (m, changes) => {
    try {
      const { data } = await api.patch(`/mdms/${m.id}`, changes);
      setMdms((list) => list.map((x) => (x.id === m.id ? data.mdm : x)));
    } catch (err) { alert(errMessage(err)); load(); }
  };
  const add = async () => {
    try {
      await api.post('/mdms', { name: draft.name, consoleUrl: draft.consoleUrl || null });
      setDraft({ name: '', consoleUrl: '' });
      load();
    } catch (err) { alert(errMessage(err)); }
  };
  const move = async (i, by) => {
    const ids = mdms.map((m) => m.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { const { data } = await api.post('/mdms/reorder', { ids }); setMdms(data.mdms); } catch (err) { alert(errMessage(err)); }
  };

  if (!mdms) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  return (
    <SettingsPage description="The device management tools your organization uses. Devices pick from this list, and forms can show steps for one MDM only.">
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-[12.5px] text-navy-400">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Console address</th>
              <th className="px-4 py-2.5 font-semibold">Devices</th>
              <th className="px-4 py-2.5 font-semibold">Active</th>
              <th className="px-4 py-2.5"><span className="sr-only">Order</span></th>
            </tr>
          </thead>
          <tbody>
            {mdms.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-navy-400">No MDMs yet. Add the ones your organization uses below.</td></tr>}
            {mdms.map((m, i) => (
              <tr key={m.id} className="border-b border-navy-50 last:border-b-0">
                <td className="px-4 py-2"><input className={inputClass} defaultValue={m.name} aria-label={`${m.name} name`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) patch(m, { name: v }); else e.target.value = m.name; }} /></td>
                <td className="px-4 py-2"><input className={inputClass} defaultValue={m.consoleUrl || ''} placeholder="https://…/devices/{id}" aria-label={`${m.name} console address`} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.consoleUrl || '')) patch(m, { consoleUrl: v || null }); }} /></td>
                <td className="num px-4 py-2">{m.deviceCount}</td>
                <td className="px-4 py-2"><label className="flex items-center gap-1.5"><input type="checkbox" checked={m.isActive} onChange={(e) => patch(m, { isActive: e.target.checked })} aria-label={`${m.name} active`} />{m.isActive ? '' : 'Retired'}</label></td>
                <td className="whitespace-nowrap px-2 py-2">
                  <Button size="sm" variant="quiet" aria-label={`Move ${m.name} up`} onClick={() => move(i, -1)} disabled={i === 0}><IconArrowUp size={14} /></Button>
                  <Button size="sm" variant="quiet" aria-label={`Move ${m.name} down`} onClick={() => move(i, 1)} disabled={i === mdms.length - 1}><IconArrowDown size={14} /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-navy-400">A retired MDM stays on the devices that have it but can&apos;t be picked for new ones. <code>{'{id}'}</code> in the console address is replaced with the device&apos;s MDM ID to make a link.</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} max-w-xs`} placeholder="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-label="New MDM name" />
        <input className={`${inputClass} max-w-sm`} placeholder="Console address (optional)" value={draft.consoleUrl} onChange={(e) => setDraft((d) => ({ ...d, consoleUrl: e.target.value }))} aria-label="New MDM console address" />
        <Button variant="primary" onClick={add} disabled={!draft.name.trim()}>Add MDM</Button>
      </div>
    </SettingsPage>
  );
}
