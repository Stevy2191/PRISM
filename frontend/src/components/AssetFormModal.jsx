import { useEffect, useRef, useState } from 'react';
import api, { errMessage } from '../api/api';
import Modal from './Modal';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const BG = 'var(--color-bg)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

function Label({ children, required }) {
  return (
    <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>
      {children}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0" style={{ borderColor: BORDER }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// Toggle between searching Contacts (live API search, like TicketNew's
// ContactPicker) and Users (client-side filter over the full directory,
// like WatchersField) — there's no dedicated live-search user endpoint, so
// the User side fetches /users/directory once and filters locally.
function AssignedToPicker({ contact, user, onChangeContact, onChangeUser }) {
  const [mode, setMode] = useState(contact ? 'contact' : 'user');
  const [query, setQuery] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    api.get('/users/directory').then(({ data }) => setDirectory(data.users || data.directory || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'contact' || !query.trim()) { setContactResults([]); return; }
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: query.trim() } })
        .then(({ data }) => setContactResults(data.contacts.slice(0, 8)))
        .catch(() => setContactResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [mode, query]);

  useEffect(() => {
    function handleOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const userResults = query.trim()
    ? directory.filter((u) => u.displayName.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  const clear = () => { onChangeContact(null); onChangeUser(null); };
  const pickContact = (c) => { onChangeUser(null); onChangeContact(c); setQuery(''); setOpen(false); };
  const pickUser = (u) => { onChangeContact(null); onChangeUser(u); setQuery(''); setOpen(false); };

  const selected = contact || user;

  return (
    <div>
      <Label>Assigned to</Label>
      {selected ? (
        <div className="flex items-center justify-between rounded-md border p-2.5" style={{ borderColor: BORDER, backgroundColor: BG }}>
          <div>
            <p className="text-sm font-medium" style={{ color: TEXT }}>{selected.displayName}</p>
            <p className="text-xs" style={{ color: MUTED }}>{contact ? 'Contact' : 'User'}{contact?.email ? ` · ${contact.email}` : ''}</p>
          </div>
          <button type="button" onClick={clear} style={{ color: MUTED }}>✕</button>
        </div>
      ) : (
        <div className="relative" ref={boxRef}>
          <div className="mb-2 flex overflow-hidden rounded-md border" style={{ borderColor: BORDER, width: 'fit-content' }}>
            <button
              type="button"
              onClick={() => { setMode('contact'); setQuery(''); }}
              className="px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: mode === 'contact' ? 'var(--color-accent)' : CARD_BG, color: mode === 'contact' ? 'white' : TEXT }}
            >
              Contact
            </button>
            <button
              type="button"
              onClick={() => { setMode('user'); setQuery(''); }}
              className="px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: mode === 'user' ? 'var(--color-accent)' : CARD_BG, color: mode === 'user' ? 'white' : TEXT }}
            >
              User
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={mode === 'contact' ? 'Search contacts…' : 'Search users…'}
            className="input h-9 text-sm"
            style={fieldStyle}
          />
          {open && query.trim() && (
            <div className="absolute z-20 mt-1 w-full rounded-md border shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {(mode === 'contact' ? contactResults : userResults).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => (mode === 'contact' ? pickContact(r) : pickUser(r))}
                  className="block w-full px-3 py-2 text-left hover:bg-[var(--color-hover)]"
                >
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{r.displayName}</p>
                  {mode === 'contact' && <p className="text-xs" style={{ color: MUTED }}>{r.department?.name || 'No department'}{r.email ? ` · ${r.email}` : ''}</p>}
                </button>
              ))}
              {(mode === 'contact' ? contactResults : userResults).length === 0 && (
                <p className="px-3 py-2 text-sm" style={{ color: MUTED }}>No {mode === 'contact' ? 'contact' : 'user'} found.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_FORM = {
  assetTag: '', name: '', categoryId: '', status: 'active',
  make: '', model: '', serialNumber: '',
  operatingSystem: '', osVersion: '', processor: '', ram: '', storage: '',
  ipAddress: '', macAddress: '', firmwareVersion: '',
  departmentId: '', locationBuilding: '', locationFloor: '', locationRoom: '',
  purchaseDate: '', purchasePrice: '', vendorName: '', warrantyExpiryDate: '', replacementPlanDate: '',
  notes: '',
};

export default function AssetFormModal({ asset, categories, departments, onClose, onSaved }) {
  const isEdit = !!asset;
  const [form, setForm] = useState(() => {
    if (!asset) return DEFAULT_FORM;
    const f = { ...DEFAULT_FORM };
    Object.keys(f).forEach((k) => { if (asset[k] !== undefined && asset[k] !== null) f[k] = asset[k]; });
    return f;
  });
  const [contact, setContact] = useState(asset?.assignedToContact || null);
  const [user, setUser] = useState(asset?.assignedToUser || null);
  const [tagTouched, setTagTouched] = useState(isEdit);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Auto-fill the suggested tag whenever category changes, unless the admin
  // already edited the tag field themselves.
  useEffect(() => {
    if (tagTouched || !form.categoryId) return;
    const cat = categories.find((c) => String(c.id) === String(form.categoryId));
    if (cat?.nextTagSuggestion) setForm((f) => ({ ...f, assetTag: cat.nextTagSuggestion }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryId, categories]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.categoryId) { setError('Category is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      payload.assignedToContactId = contact?.id || null;
      payload.assignedToUserId = user?.id || null;

      const { data } = isEdit
        ? await api.patch(`/assets/${asset.id}`, payload)
        : await api.post('/assets', payload);
      onSaved(data.asset);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit asset' : 'New asset'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <Section title="Basic info">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>Asset tag</Label>
              <input
                className="input font-mono"
                style={fieldStyle}
                value={form.assetTag}
                onChange={(e) => { setTagTouched(true); setForm((f) => ({ ...f, assetTag: e.target.value })); }}
                required
              />
            </div>
            <div>
              <Label required>Name</Label>
              <input className="input" style={fieldStyle} value={form.name} onChange={set('name')} placeholder="e.g. Sean's Laptop" required />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>Category</Label>
              <select className="input" style={fieldStyle} value={form.categoryId} onChange={set('categoryId')} required>
                <option value="">Select category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Status</Label>
              <select className="input" style={fieldStyle} value={form.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="in_repair">In repair</option>
                <option value="retired">Retired</option>
                <option value="in_storage">In storage</option>
                <option value="lost">Lost</option>
              </select>
            </div>
          </div>
        </Section>

        <Section title="Device details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>Make</Label><input className="input" style={fieldStyle} value={form.make} onChange={set('make')} /></div>
            <div><Label>Model</Label><input className="input" style={fieldStyle} value={form.model} onChange={set('model')} /></div>
            <div><Label>Serial number</Label><input className="input" style={fieldStyle} value={form.serialNumber} onChange={set('serialNumber')} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Operating system</Label><input className="input" style={fieldStyle} value={form.operatingSystem} onChange={set('operatingSystem')} /></div>
            <div><Label>OS version</Label><input className="input" style={fieldStyle} value={form.osVersion} onChange={set('osVersion')} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>Processor</Label><input className="input" style={fieldStyle} value={form.processor} onChange={set('processor')} /></div>
            <div><Label>RAM</Label><input className="input" style={fieldStyle} value={form.ram} onChange={set('ram')} placeholder="16GB" /></div>
            <div><Label>Storage</Label><input className="input" style={fieldStyle} value={form.storage} onChange={set('storage')} placeholder="512GB SSD" /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>IP address</Label><input className="input" style={fieldStyle} value={form.ipAddress} onChange={set('ipAddress')} /></div>
            <div><Label>MAC address</Label><input className="input" style={fieldStyle} value={form.macAddress} onChange={set('macAddress')} /></div>
            <div><Label>Firmware version</Label><input className="input" style={fieldStyle} value={form.firmwareVersion} onChange={set('firmwareVersion')} /></div>
          </div>
        </Section>

        <Section title="Assignment">
          <AssignedToPicker contact={contact} user={user} onChangeContact={setContact} onChangeUser={setUser} />
          <div>
            <Label>Department</Label>
            <select className="input" style={fieldStyle} value={form.departmentId} onChange={set('departmentId')}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>Building</Label><input className="input" style={fieldStyle} value={form.locationBuilding} onChange={set('locationBuilding')} /></div>
            <div><Label>Floor</Label><input className="input" style={fieldStyle} value={form.locationFloor} onChange={set('locationFloor')} /></div>
            <div><Label>Room</Label><input className="input" style={fieldStyle} value={form.locationRoom} onChange={set('locationRoom')} /></div>
          </div>
        </Section>

        <Section title="Lifecycle">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>Purchase date</Label><input type="date" className="input" style={fieldStyle} value={form.purchaseDate || ''} onChange={set('purchaseDate')} /></div>
            <div><Label>Purchase price</Label><input type="number" min="0" step="0.01" className="input" style={fieldStyle} value={form.purchasePrice} onChange={set('purchasePrice')} /></div>
            <div><Label>Vendor name</Label><input className="input" style={fieldStyle} value={form.vendorName} onChange={set('vendorName')} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Warranty expiry date</Label><input type="date" className="input" style={fieldStyle} value={form.warrantyExpiryDate || ''} onChange={set('warrantyExpiryDate')} /></div>
            <div><Label>Replacement plan date</Label><input type="date" className="input" style={fieldStyle} value={form.replacementPlanDate || ''} onChange={set('replacementPlanDate')} /></div>
          </div>
        </Section>

        <Section title="Notes">
          <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '80px' }} value={form.notes} onChange={set('notes')} />
        </Section>

        <div className="flex justify-end gap-3 border-t pt-4" style={{ borderColor: BORDER }}>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create asset'}</button>
        </div>
      </form>
    </Modal>
  );
}
