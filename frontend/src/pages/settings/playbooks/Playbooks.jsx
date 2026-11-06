// Settings → Playbooks (PB): forms applied to a ticket together. Workflow
// rules can suggest one; a person applies it from the ticket.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';
import { exportAll, ImportDialog } from './Transfer';

const APPLIES = { once: 'once', person_devices: "per person's device", ticket_devices: 'per device on the ticket' };

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const load = () => api.get('/playbooks').then(({ data }) => setPlaybooks(data.playbooks)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const setActive = async (p, isActive) => {
    try { await api.patch(`/playbooks/${p.id}`, { isActive }); load(); } catch (err) { alert(errMessage(err)); }
  };
  if (!playbooks) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  return (
    <SettingsPage
      description="Forms applied to a ticket together, with an Apply playbook button on the ticket. Workflow rules can suggest one; they never apply it."
      actions={<>
        <Button onClick={exportAll}>Export</Button>
        <Button onClick={() => setImporting(true)}>Import…</Button>
        <Link to="/settings/playbooks/new" className="btn-primary">New playbook</Link>
      </>}
    >
      <div className="card divide-y divide-navy-100">
        {playbooks.length === 0 && <p className="p-4 text-sm text-navy-400">No playbooks yet.</p>}
        {playbooks.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link to={`/settings/playbooks/${p.id}`} className="font-semibold text-navy-900 hover:underline">{p.name}</Link>
              <div className="text-[12.5px] text-navy-400">
                {p.needsPerson ? 'For a person · ' : ''}{p.blocks.map((b) => `${b.form?.name || 'Missing form'} (${APPLIES[b.applies]})`).join(', ') || 'No forms'}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={p.isActive} onChange={(e) => setActive(p, e.target.checked)} aria-label={`${p.name} active`} />Active</label>
          </div>
        ))}
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={() => { setImporting(false); load(); }} />}
    </SettingsPage>
  );
}
