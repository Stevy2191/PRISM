// Settings › Checklists › a bundle (PB2), written as a sentence: who it's
// for, one line per checklist, and the ticket categories it suggests itself
// on. A device gets the first line it fits. Stored as the playbook's blocks;
// limits other than device types (MDMs, managed, cellular, agent) set in the
// old editor are kept as they are.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconPlus, IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import Modal from '../../../components/Modal';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import Button from '../../../components/ui/Button';
import { buildIndex, pathLabel } from '../../../components/categoryTree';
import TryOnSomeone from './TryOnSomeone';

const slot = 'inline-flex min-h-[36px] items-center rounded-md border border-navy-200 bg-surface px-2 text-sm font-semibold text-navy-800';

function PickMany({
  title, hint, options, value, onDone, onClose,
}) {
  const [chosen, setChosen] = useState(value);
  return (
    <Modal title={title} onClose={onClose}>
      {hint && <p className="mb-3 text-sm text-navy-500">{hint}</p>}
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-[40px] items-center gap-3 rounded-md px-2 text-sm hover:bg-navy-50">
            <input type="checkbox" className="h-4 w-4" checked={chosen.includes(o.id)}
              onChange={() => setChosen((c) => (c.includes(o.id) ? c.filter((x) => x !== o.id) : [...c, o.id]))} />
            {o.name}
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => onDone([])}>Clear</Button>
        <Button variant="primary" onClick={() => onDone(chosen)}>Done</Button>
      </div>
    </Modal>
  );
}

const extraLimits = (limits = {}) => Object.keys(limits).some((k) => k !== 'categoryIds' && limits[k] !== undefined && !(Array.isArray(limits[k]) && !limits[k].length));

export default function BundleEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [pb, setPb] = useState(isNew ? {
    name: '', description: '', needsPerson: true, companyIds: null, blocks: [], suggestCategoryIds: null,
  } : null);
  const [forms, setForms] = useState([]);
  const [types, setTypes] = useState([]);
  const [ticketCategories, setTicketCategories] = useState([]);
  const [picking, setPicking] = useState(null); // { what: 'types', i } | { what: 'categories' }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isNew) api.get(`/playbooks/${id}`).then(({ data }) => setPb(data.playbook)).catch((err) => setError(errMessage(err)));
    api.get('/forms').then(({ data }) => setForms(data.forms)).catch(() => {});
    api.get('/assets/categories').then(({ data }) => setTypes(data.categories || [])).catch(() => {});
    api.get('/ticket-categories').then(({ data }) => setTicketCategories(data.categories || [])).catch(() => {});
  }, [id, isNew]);
  const categoryIndex = useMemo(() => buildIndex(ticketCategories), [ticketCategories]);

  if (!pb) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const set = (patch) => { setPb((p) => ({ ...p, ...patch })); setSaved(false); };
  const setBlock = (i, patch) => set({ blocks: pb.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const formOf = (b) => forms.find((f) => f.id === Number(b.formId)) || null;
  const typeNames = (ids) => ids.map((tid) => (types.find((t) => t.id === tid) || {}).name || `#${tid}`).join(', ');
  const suggest = pb.suggestCategoryIds || [];

  const chooseForm = (i, formId) => {
    const form = forms.find((f) => f.id === Number(formId));
    const applies = !form || form.usage === 'ticket' ? 'once' : (pb.needsPerson ? 'person_devices' : 'ticket_devices');
    setBlock(i, { formId: Number(formId), applies, limits: {} });
  };
  const setNeedsPerson = (needsPerson) => set({
    needsPerson,
    // Without a person there are no "their devices": those lines become "devices added to the ticket".
    blocks: needsPerson ? pb.blocks : pb.blocks.map((b) => (b.applies === 'person_devices' ? { ...b, applies: 'ticket_devices' } : b)),
  });

  const save = async () => {
    setSaving(true);
    setError('');
    const body = {
      name: pb.name,
      description: pb.description || null,
      needsPerson: pb.needsPerson,
      companyIds: pb.companyIds,
      blocks: pb.blocks.filter((b) => b.formId).map((b) => ({ formId: Number(b.formId), applies: b.applies, limits: b.limits || {} })),
      suggestCategoryIds: suggest.length ? suggest : null,
    };
    try {
      if (isNew) {
        const { data } = await api.post('/playbooks', body);
        navigate(`/settings/checklists/bundles/${data.playbook.id}`, { replace: true });
      } else {
        const { data } = await api.put(`/playbooks/${id}`, body);
        setPb(data.playbook);
        setSaved(true);
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs className="mb-1" items={[{ label: 'Settings', to: '/settings' }, { label: 'Checklists', to: '/settings/checklists' }, { label: 'Bundles', current: true }]} />
          <input className="page-title w-full rounded border-0 bg-transparent px-0 focus:outline-none focus:ring-1 focus:ring-navy-200" aria-label="Bundle name"
            placeholder="Name this bundle" value={pb.name} onChange={(e) => set({ name: e.target.value })} />
          <p className="mt-1 text-sm text-navy-500">Adds several checklists to a ticket in one click.</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-navy-400">Saved</span>}
          <Button variant="primary" onClick={save} disabled={saving || !pb.name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </header>
      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="flex flex-wrap items-start gap-6">
        <div className="card flex min-w-0 flex-[999_1_520px] flex-col gap-3 px-4 py-5 sm:px-6">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            It's for
            <select className={slot} aria-label="It's for" value={pb.needsPerson ? 'person' : 'ticket'} onChange={(e) => setNeedsPerson(e.target.value === 'person')}>
              <option value="person">a person</option>
              <option value="ticket">the ticket</option>
            </select>
            and adds:
          </p>
          {pb.blocks.map((b, i) => {
            const form = formOf(b);
            const device = form && form.usage === 'device';
            const cats = (b.limits && b.limits.categoryIds) || [];
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-navy-100 bg-surface px-3 py-3 text-[15px]">
                <select className={slot} aria-label={`Checklist ${i + 1}`} value={b.formId || ''} onChange={(e) => chooseForm(i, e.target.value)}>
                  <option value="">Choose a checklist</option>
                  {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isActive ? '' : ' (off)'}</option>)}
                </select>
                {!form && b.formId && <span className="text-sm text-red-700">This checklist no longer exists.</span>}
                {form && !device && <span>for the ticket</span>}
                {device && (
                  <>
                    <select className={slot} aria-label={`Which devices for checklist ${i + 1}`} value={b.applies}
                      onChange={(e) => setBlock(i, { applies: e.target.value })}>
                      {pb.needsPerson && <option value="person_devices">for each of their</option>}
                      <option value="ticket_devices">for each device added to the ticket</option>
                    </select>
                    {b.applies === 'person_devices' && (
                      <>
                        <button type="button" className={slot} onClick={() => setPicking({ what: 'types', i })}>{cats.length ? typeNames(cats) : 'other'} ▾</button>
                        <span>devices</span>
                      </>
                    )}
                    {b.applies === 'ticket_devices' && cats.length > 0 && (
                      <button type="button" className={slot} onClick={() => setPicking({ what: 'types', i })}>{typeNames(cats)} ▾</button>
                    )}
                    {extraLimits(b.limits) && <span className="text-xs text-navy-400">(with more limits from before; kept)</span>}
                  </>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="quiet" aria-label="Move up" disabled={i === 0} onClick={() => { const all = [...pb.blocks]; [all[i - 1], all[i]] = [all[i], all[i - 1]]; set({ blocks: all }); }}>↑</Button>
                  <Button size="sm" variant="quiet" aria-label={`Remove checklist ${i + 1}`} onClick={() => set({ blocks: pb.blocks.filter((_, j) => j !== i) })}><IconX size={14} /></Button>
                </div>
              </div>
            );
          })}
          <Button size="sm" variant="quiet" className="self-start" style={{ color: 'var(--color-accent)' }}
            onClick={() => set({ blocks: [...pb.blocks, { formId: '', applies: 'once', limits: {} }] })}>
            <IconPlus size={14} />{pb.blocks.length ? 'Add another checklist' : 'Add a checklist'}
          </Button>
          <p className="flex flex-wrap items-center gap-2 border-t border-navy-100 pt-4 text-[15px]">
            Suggest it on new tickets in
            <button type="button" className={slot} onClick={() => setPicking({ what: 'categories' })}>
              {suggest.length ? suggest.map((cid) => pathLabel(categoryIndex, cid)).join(', ') : 'a category'} ▾
            </button>
            <span className="text-sm text-navy-400">(optional)</span>
          </p>
          <p className="text-sm text-navy-400">A device gets the first line it fits. Devices that fit none are listed on the ticket so nobody misses them.</p>
        </div>
        <aside className="max-w-full flex-[1_1_260px] sm:max-w-[320px]">
          {!isNew ? <TryOnSomeone playbookId={id} /> : <div className="card p-4 text-sm text-navy-400">Save the bundle to try it on someone.</div>}
        </aside>
      </div>

      {picking && picking.what === 'types' && (
        <PickMany title="Which device types" hint="Leave all unticked for “other”: every device not matched by a line above."
          options={types} value={(pb.blocks[picking.i].limits && pb.blocks[picking.i].limits.categoryIds) || []}
          onClose={() => setPicking(null)}
          onDone={(ids) => { setBlock(picking.i, { limits: { ...(pb.blocks[picking.i].limits || {}), categoryIds: ids.length ? ids : undefined } }); setPicking(null); }} />
      )}
      {picking && picking.what === 'categories' && (
        <PickMany title="Suggest on tickets in" hint="Tickets created in these categories, or under them, or moved into them, get this bundle suggested."
          options={ticketCategories.map((c) => ({ id: c.id, name: pathLabel(categoryIndex, c.id) }))} value={suggest}
          onClose={() => setPicking(null)}
          onDone={(ids) => { set({ suggestCategoryIds: ids }); setPicking(null); }} />
      )}
    </div>
  );
}
