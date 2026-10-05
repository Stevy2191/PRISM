// Customer picker for the new-ticket form, with inline contact creation.
import { useEffect, useRef, useState } from 'react';
import { IconX, IconCheck } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { formatPhone } from '../../../utils/formatPhone';
import { contactLabel } from '../../../utils/contactLabel';
import { useCompanySummary } from '../../../context/CompanyContext';
import CompanyPicker from '../../../components/companies/CompanyPicker';
import { BG, CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle } from '../theme';

// Search-as-you-type contact picker for the Customer field. Falls back to a
// quick inline "create new contact" form when no existing contact matches.
//
// This whole component lives inside TicketNew's page-level <form> (the
// ticket-creation submit). The inline create-contact UI below deliberately
// renders as a <div>, never a nested <form> — a <button type="submit">
// inside a form nested in another form still resolves its "form owner" to
// the nearest ancestor form and fires a native submit; even with
// preventDefault() on that inner submit, the event keeps bubbling and lands
// on the outer ticket form's onSubmit too (preventDefault stops the
// browser's default action, not event propagation), which used to run
// ticket-submit validation ("Customer is required", since the contact
// hasn't been created yet) while the contact POST was still in flight —
// that's what looked like the page "resetting."
export function ContactPicker({ selectedContact, onSelect }) {
  const { multiCompany } = useCompanySummary();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [justCreated, setJustCreated] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/contacts', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.contacts.slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handleOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const pick = (contact, createdNow = false) => {
    onSelect(contact);
    setQuery('');
    setOpen(false);
    setJustCreated(createdNow);
  };

  const clear = () => {
    onSelect(null);
    setJustCreated(false);
  };

  const startCreate = () => {
    setShowCreate(true);
    setOpen(false);
  };

  const cancelCreate = () => {
    setShowCreate(false);
    setCreateError('');
    setQuery('');
  };

  return (
    <div className="relative" ref={boxRef}>
      {selectedContact ? (
        <div className="flex items-center justify-between rounded-md border p-2.5" style={{ borderColor: BORDER, backgroundColor: BG }}>
          <div>
            <p className="text-sm font-medium" style={{ color: TEXT }}>{selectedContact.displayName}</p>
            <p className="text-xs" style={{ color: MUTED }}>
              {selectedContact.department?.name || 'No department'}{selectedContact.email ? ` · ${selectedContact.email}` : ''}
            </p>
            {justCreated && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                <IconCheck size={13} />
                Contact created
              </p>
            )}
          </div>
          <button type="button" onClick={clear} style={{ color: MUTED }}>
            <IconX size={14} />
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search contacts by name or email…"
            className="input"
            style={fieldStyle}
          />
          {open && query.trim() && (
            <div className="absolute z-20 mt-1 w-full rounded-md border shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c)}
                  className="block w-full px-3 py-2 text-left hover:bg-[var(--color-hover)]"
                >
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{c.displayName}</p>
                  {/* Company · Department under the name (spec: contact labels). */}
                  <p className="text-xs" style={{ color: MUTED }}>{contactLabel(c, { multiCompany }).split(' · ').slice(1).join(' · ') || 'No department'}{c.email ? ` · ${c.email}` : ''}</p>
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-3 py-2 text-sm" style={{ color: MUTED }}>No contact found for "{query.trim()}".</p>
              )}
              <button
                type="button"
                onClick={startCreate}
                className="block w-full border-t px-3 py-2 text-left text-sm font-medium"
                style={{ borderColor: BORDER, color: BLUE }}
              >
                + Create new contact "{query.trim()}"
              </button>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <QuickCreateContact
          initialName={query}
          error={createError}
          creating={creating}
          onCancel={cancelCreate}
          onCreate={async (form) => {
            setCreating(true);
            setCreateError('');
            try {
              const { data } = await api.post('/contacts', form);
              setShowCreate(false);
              pick(data.contact, true);
            } catch (err) {
              setCreateError(errMessage(err));
            } finally {
              setCreating(false);
            }
          }}
        />
      )}
    </div>
  );
}

// Renders as a <div>, not a <form> — see the note on ContactPicker above for
// why a nested form here is exactly what caused the page-reset bug.
function QuickCreateContact({ initialName, error, creating, onCancel, onCreate }) {
  const parts = String(initialName || '').trim().split(/\s+/).filter(Boolean);
  const [firstName, setFirstName] = useState(parts[0] || '');
  const [lastName, setLastName] = useState(parts.slice(1).join(' '));
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [validationError, setValidationError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) {
      setValidationError('Enter a first or last name');
      return;
    }
    setValidationError('');
    onCreate({
      firstName: firstName.trim() || null, lastName: lastName.trim() || null, email: email || null, phone: phone || null,
      companyId: companyId || undefined,
    });
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border p-3" style={{ borderColor: BORDER, backgroundColor: BG }}>
      <p className="text-sm font-medium" style={{ color: TEXT }}>New contact</p>
      {validationError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{validationError}</p>}
      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className="input h-9 text-sm" style={fieldStyle} />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className="input h-9 text-sm" style={fieldStyle} />
      </div>
      <CompanyPicker value={companyId} onChange={setCompanyId} style={fieldStyle} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="input h-9 text-sm" style={fieldStyle} />
        <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(555) 123-4567" className="input h-9 text-sm" style={fieldStyle} inputMode="tel" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={(e) => { e.preventDefault(); onCancel(); }} className="btn-secondary h-8 px-3 text-xs">Cancel</button>
        <button type="button" disabled={creating} onClick={submit} className="btn-primary h-8 px-3 text-xs">{creating ? 'Creating…' : 'Create contact'}</button>
      </div>
    </div>
  );
}
