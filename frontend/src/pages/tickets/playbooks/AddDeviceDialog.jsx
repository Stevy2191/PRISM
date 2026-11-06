// Add a device to the ticket (PB): pick one of the company's devices (ready
// to issue first) or create one, which is saved as an asset of the ticket's
// company. An applied playbook adds the form the device needs.
import { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Notice from '../../../components/ui/Notice';
import DeviceFields, { deviceFieldsBody, useMdms } from '../../../components/assets/DeviceFields';
import api, { errMessage } from '../../../api/api';
import { usePermission } from '../../../context/AuthContext';

const inputClass = 'h-10 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900';
const WARNINGS = {
  SERIAL_EMPTY: 'No serial number: the PRISM agent finds a computer by its serial number, so add it once you have it.',
  IMEI_IN_USE: 'Another device in use has this IMEI.',
  PHONE_IN_USE: 'Another device in use has this phone number.',
};

export default function AddDeviceDialog({ ticket, onClose, onAdded }) {
  const canCreate = usePermission('assets.create');
  const [mode, setMode] = useState('pick');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [categories, setCategories] = useState([]);
  const mdms = useMdms();
  const [device, setDevice] = useState({ name: '', categoryId: '', make: '', model: '', serialNumber: '', assetTag: '' });
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/assets/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
  }, []);
  useEffect(() => {
    if (mode !== 'pick') return undefined;
    const t = setTimeout(() => {
      const params = { companyId: ticket.companyId, limit: 20, ...(query.trim() ? { search: query.trim() } : { status: 'ready_to_issue' }) };
      api.get('/assets', { params }).then(({ data }) => setFound(data.assets || [])).catch(() => setFound([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, query, ticket.companyId]);

  const category = useMemo(() => categories.find((c) => String(c.id) === String(device.categoryId)), [categories, device.categoryId]);
  const set = (patch) => setDevice((d) => ({ ...d, ...patch }));
  const pickCategory = (id) => {
    const c = categories.find((x) => String(x.id) === String(id));
    set({ categoryId: id, assetTag: c?.nextTagSuggestion || '', hasCellular: !!c?.cellularByDefault });
  };

  const link = async (asset) => {
    setSaving(true);
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/devices`, { assetId: asset.id });
      onAdded(data);
    } catch (err) { setError(errMessage(err)); setSaving(false); }
  };
  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/devices/new`, {
        name: device.name, categoryId: device.categoryId, make: device.make || null, model: device.model || null,
        serialNumber: device.serialNumber || null, assetTag: device.assetTag || undefined, ...deviceFieldsBody(device),
      });
      if (data.warnings?.length) { setWarnings(data.warnings); setSaving(false); onAdded(data, { keepOpen: true }); return; }
      onAdded(data);
    } catch (err) { setError(errMessage(err)); setSaving(false); }
  };

  return (
    <Modal title="Add a device" onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-navy-500">Pick one in stock, or create it here. A created device is saved as an asset of this ticket&apos;s company.</p>
      <div role="tablist" aria-label="Pick or create" className="mb-4 inline-flex overflow-hidden rounded-md border border-navy-100">
        {[['pick', 'Pick an existing device'], ['create', 'Create a new device']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} disabled={k === 'create' && !canCreate} onClick={() => setMode(k)}
            className={`h-8 px-3 text-sm ${mode === k ? 'font-semibold' : 'font-medium text-navy-500'} disabled:opacity-50`}
            style={mode === k ? { backgroundColor: 'var(--color-accent-soft)' } : undefined}>{label}</button>
        ))}
      </div>
      {warnings.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Notice tone="warn"><span>Added. {warnings.map((w) => WARNINGS[w] || w).join(' ')}</span></Notice>
          <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      ) : mode === 'pick' ? (
        <div className="flex flex-col gap-2">
          <input className={inputClass} placeholder="Search by name, tag, serial, IMEI or phone…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search devices" />
          {!query.trim() && <p className="text-[12.5px] text-navy-400">Ready to issue:</p>}
          {found.length === 0 && <p className="text-sm text-navy-400">No devices found.</p>}
          {found.map((a) => (
            <button key={a.id} type="button" disabled={saving} onClick={() => link(a)} className="flex items-center justify-between rounded-md border border-navy-100 px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]">
              <span><b>{a.name}</b> <span className="num text-navy-400">{a.assetTag}</span></span>
              <span className="text-[12.5px] text-navy-500">{a.mdm?.name || (a.isManaged ? 'Managed' : 'Not managed')}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Type">
              <select className={inputClass} value={device.categoryId} onChange={(e) => pickCategory(e.target.value)} data-testid="device-type">
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input className={inputClass} value={device.name} onChange={(e) => set({ name: e.target.value })} data-testid="device-name" /></Field>
            <Field label="Make"><input className={inputClass} value={device.make} onChange={(e) => set({ make: e.target.value })} /></Field>
            <Field label="Model"><input className={inputClass} value={device.model} onChange={(e) => set({ model: e.target.value })} /></Field>
            <Field label="Serial number"><input className={inputClass} value={device.serialNumber} onChange={(e) => set({ serialNumber: e.target.value })} /></Field>
            <Field label="Asset tag" hint={category ? 'Next free tag. Change it if the device is already labelled.' : undefined}><input className={inputClass} value={device.assetTag} onChange={(e) => set({ assetTag: e.target.value })} /></Field>
          </div>
          <div className="border-t border-navy-100 pt-3.5">
            <DeviceFields value={device} onChange={set} mdms={mdms} columns={3} />
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {mode === 'create' && warnings.length === 0 && (
        <div className="mt-4 flex justify-end gap-2 border-t border-navy-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={saving || !device.name.trim() || !device.categoryId} data-testid="create-device">{saving ? 'Saving…' : 'Create and add'}</Button>
        </div>
      )}
    </Modal>
  );
}
