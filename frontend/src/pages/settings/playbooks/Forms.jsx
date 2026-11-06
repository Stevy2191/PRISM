// Settings → Forms (PB): reusable checklists of steps, fields and secure
// values. Every save is a new version; forms already on tickets keep theirs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';
import { exportAll, ImportDialog } from './Transfer';

export default function Forms() {
  const [forms, setForms] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const load = () => api.get('/forms').then(({ data }) => setForms(data.forms)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const setActive = async (f, isActive) => {
    try { await api.patch(`/forms/${f.id}`, { isActive }); load(); } catch (err) { alert(errMessage(err)); }
  };
  if (!forms) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  return (
    <SettingsPage
      description="Checklists of steps, fields and secure values that playbooks add to tickets. Every save is a new version; forms already on tickets keep theirs."
      actions={<>
        <Button onClick={exportAll}>Export</Button>
        <Button onClick={() => setImporting(true)}>Import…</Button>
        <Link to="/settings/forms/new" className="btn-primary">New form</Link>
      </>}
    >
      <div className="card divide-y divide-navy-100">
        {forms.length === 0 && <p className="p-4 text-sm text-navy-400">No forms yet.</p>}
        {forms.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link to={`/settings/forms/${f.id}`} className="font-semibold text-navy-900 hover:underline">{f.name}</Link>
              <div className="text-[12.5px] text-navy-400">{f.usage === 'device' ? 'Per device' : 'Once per ticket'} · version {f.version}{f.inUse ? ` · on ${f.inUse} open ticket form${f.inUse === 1 ? '' : 's'}` : ''}</div>
            </div>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setActive(f, e.target.checked)} aria-label={`${f.name} active`} />Active</label>
          </div>
        ))}
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={() => { setImporting(false); load(); }} />}
    </SettingsPage>
  );
}
