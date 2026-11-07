// Settings › Checklists (PB2): one page for checklists and, below them, the
// bundles that add several checklists to a ticket in one click. Export and
// import work as before.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import SettingsPage from '../../../components/settings/SettingsPage';
import Button from '../../../components/ui/Button';
import { exportAll, ImportDialog } from '../playbooks/Transfer';
import NewChecklistDialog from './NewChecklistDialog';

function Row({
  to, name, detail, active, onActive,
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link to={to} className="font-semibold text-navy-900 hover:underline">{name}</Link>
        <div className="text-[12.5px] text-navy-400">{detail}</div>
      </div>
      <label className="flex min-h-[40px] items-center gap-1.5 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => onActive(e.target.checked)} aria-label={`${name} on`} />On
      </label>
    </div>
  );
}

const FINISH = { check_out: 'checks the device out', check_in: 'checks the device in' };

export default function Checklists() {
  const [forms, setForms] = useState(null);
  const [bundles, setBundles] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const load = () => Promise.all([
    api.get('/forms').then(({ data }) => setForms(data.forms)),
    api.get('/playbooks').then(({ data }) => setBundles(data.playbooks)),
  ]).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const setActive = (kind, id, isActive) => api.patch(`/${kind}/${id}`, { isActive }).then(load).catch((err) => setError(errMessage(err)));

  if (!forms || !bundles) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;
  const group = (usage) => forms.filter((f) => f.usage === usage);
  const checklistDetail = (f) => [
    f.usage === 'device' ? 'For each device' : 'For the ticket',
    f.finish ? `when finished, ${FINISH[f.finish]}` : null,
    `version ${f.version}`,
    f.inUse ? `on ${f.inUse} open ticket${f.inUse === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <SettingsPage
      description="Checklists of steps for tickets. Paste a document to build one, or type it. Every save is a new version; tickets in progress keep theirs."
      actions={<>
        <Button onClick={exportAll}>Export</Button>
        <Button onClick={() => setImporting(true)}>Import…</Button>
        <Button variant="primary" onClick={() => setCreating(true)}>New checklist</Button>
      </>}
    >
      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      {[['ticket', 'For the ticket'], ['device', 'For devices']].map(([usage, title]) => (
        <section key={usage} aria-label={title}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">{title}</h2>
          <div className="card divide-y divide-navy-100">
            {group(usage).length === 0 && <p className="p-4 text-sm text-navy-400">None yet.</p>}
            {group(usage).map((f) => (
              <Row key={f.id} to={`/settings/checklists/${f.id}`} name={f.name} detail={checklistDetail(f)} active={f.isActive} onActive={(v) => setActive('forms', f.id, v)} />
            ))}
          </div>
        </section>
      ))}
      <section aria-label="Bundles">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-400">Bundles</h2>
            <p className="text-sm text-navy-500">Optional: add several checklists to a ticket in one click.</p>
          </div>
          <Link to="/settings/checklists/bundles/new" className="btn-secondary">New bundle</Link>
        </div>
        <div className="card divide-y divide-navy-100">
          {bundles.length === 0 && <p className="p-4 text-sm text-navy-400">No bundles yet.</p>}
          {bundles.map((b) => (
            <Row key={b.id} to={`/settings/checklists/bundles/${b.id}`} name={b.name}
              detail={`${b.needsPerson ? 'For a person' : 'For the ticket'} · adds ${b.blocks.map((x) => x.form?.name || 'a missing checklist').join(', ') || 'nothing yet'}`}
              active={b.isActive} onActive={(v) => setActive('playbooks', b.id, v)} />
          ))}
        </div>
      </section>
      {creating && <NewChecklistDialog onClose={() => setCreating(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={() => { setImporting(false); load(); }} />}
    </SettingsPage>
  );
}
