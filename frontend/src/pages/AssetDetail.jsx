import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconFile, IconUpload, IconTrash, IconDownload } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import AssetFormModal from '../components/AssetFormModal';
import { StatusBadge, CategoryBadge, dateUrgencyColor } from './Assets';
import { formatTicketId } from '../utils/ticketId';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const BG = 'var(--color-bg)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

const PRIORITY_META = {
  critical: { label: 'Urgent', color: 'var(--color-danger)' },
  high: { label: 'High', color: 'var(--color-warning)' },
  medium: { label: 'Medium', color: 'var(--color-accent)' },
  low: { label: 'Low', color: 'var(--color-text-muted)' },
};

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: color || TEXT }}>{value}</p>
    </div>
  );
}

function daysLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  return `${days}d`;
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <div className="mt-0.5 text-sm" style={{ color: TEXT }}>{children ?? <span style={{ color: MUTED }}>—</span>}</div>
    </div>
  );
}

// Subscription renewal uses its own thresholds — green >60 days, amber
// 30-60, red <30 or past due — distinct from dateUrgencyColor's 90-day
// warranty/replacement threshold (see Assets.jsx).
function subscriptionUrgencyColor(dateStr) {
  if (!dateStr) return MUTED;
  const days = Math.round((new Date(`${dateStr}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  if (days < 30) return 'var(--color-danger)';
  if (days <= 60) return 'var(--color-warning)';
  return 'var(--color-success)';
}

const SUBSCRIPTION_FIELD_KEYS = new Set(['subscriptionProvider', 'subscriptionCost', 'billingCycle', 'nextRenewalDate', 'autoRenews']);

function formatFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (field.fieldType === 'toggle') return value === 'true' || value === true ? 'Yes' : 'No';
  return value;
}

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canEdit = usePermission('assets.edit');
  const canDelete = usePermission('assets.delete');
  const canLinkTickets = usePermission('assets.link_tickets');

  const [asset, setAsset] = useState(null);
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    api.get(`/assets/${id}`)
      .then(({ data }) => { setAsset(data.asset); setStats(data.stats); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/assets/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, []);

  const patchAsset = async (changes) => {
    try {
      const { data } = await api.patch(`/assets/${id}`, changes);
      setAsset(data.asset);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const deleteAsset = async (force) => {
    setDeleting(true);
    try {
      await api.delete(`/assets/${id}`, { params: force ? { force: 'true' } : {} });
      navigate('/assets');
    } catch (err) {
      if (err?.response?.data?.code === 'HAS_LINKED_TICKETS') {
        setDeleteWarning(err.response.data);
      } else {
        alert(errMessage(err));
        setShowDeleteConfirm(false);
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>;
  if (!asset) return null;

  return (
    <div className="space-y-5">
      <Link to="/assets" className="text-sm hover:underline" style={{ color: MUTED }}>← Back to assets</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg font-bold" style={{ color: TEXT }}>{asset.assetTag}</span>
            <CategoryBadge category={asset.category} />
            <StatusBadge status={asset.status} />
          </div>
          <h1 className="mt-1 text-xl font-bold" style={{ color: TEXT }}>{asset.name}</h1>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {canEdit && <button type="button" onClick={() => setShowEditForm(true)} className="btn-secondary">Edit</button>}
          {canDelete && <button type="button" onClick={() => { setShowDeleteConfirm(true); setDeleteWarning(null); }} className="btn-danger">Delete</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total tickets linked" value={stats.totalTicketsLinked} />
        <StatCard label="Open tickets linked" value={stats.openTicketsLinked} />
        <StatCard
          label="Warranty expiry"
          value={daysLabel(stats.daysUntilWarrantyExpiry)}
          color={stats.daysUntilWarrantyExpiry !== null && stats.daysUntilWarrantyExpiry < 0 ? 'var(--color-danger)' : undefined}
        />
        <StatCard
          label="Replacement due"
          value={daysLabel(stats.daysUntilReplacement)}
          color={stats.daysUntilReplacement !== null && stats.daysUntilReplacement < 0 ? 'var(--color-danger)' : undefined}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: BORDER }}>
        {[
          ['overview', 'Overview'], ['tickets', 'Tickets'], ['activity', 'Activity'],
          ['attachments', 'Attachments'], ['checkouts', 'Checkout History'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="flex-shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium"
            style={{ borderColor: tab === key ? BLUE : 'transparent', color: tab === key ? BLUE : MUTED }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab asset={asset} departments={departments} onPatch={patchAsset} onCheckedOut={load} />}
      {tab === 'tickets' && <TicketsTab assetId={id} asset={asset} canLinkTickets={canLinkTickets} navigate={navigate} />}
      {tab === 'activity' && <ActivityTab assetId={id} />}
      {tab === 'attachments' && <AttachmentsTab assetId={id} />}
      {tab === 'checkouts' && <CheckoutsTab assetId={id} asset={asset} onChanged={load} />}

      {showEditForm && (
        <AssetFormModal
          asset={asset}
          categories={categories}
          departments={departments}
          onClose={() => setShowEditForm(false)}
          onSaved={(updated) => { setAsset(updated); setShowEditForm(false); }}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-5 shadow-lg sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-base font-semibold text-navy-900">Delete &quot;{asset.name}&quot;?</h2>
            {deleteWarning ? (
              <p className="mb-4 text-sm text-red-700">{deleteWarning.message}</p>
            ) : (
              <p className="mb-4 text-sm text-navy-600">This cannot be undone.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={() => deleteAsset(!!deleteWarning)} disabled={deleting} className="btn-danger">
                {deleting ? 'Deleting…' : deleteWarning ? 'Delete anyway' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ asset, departments, onPatch, onCheckedOut }) {
  const [notes, setNotes] = useState(asset.notes || '');
  const notesTimer = useRef(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  useEffect(() => setNotes(asset.notes || ''), [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNotesChange = (value) => {
    setNotes(value);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => onPatch({ notes: value || null }), 800);
  };

  const allFieldValues = asset.fieldValues || [];
  const subscriptionValues = allFieldValues.filter((fv) => SUBSCRIPTION_FIELD_KEYS.has(fv.field?.fieldKey));
  const deviceValues = allFieldValues.filter((fv) => !SUBSCRIPTION_FIELD_KEYS.has(fv.field?.fieldKey));
  const renewalValue = subscriptionValues.find((fv) => fv.field?.fieldKey === 'nextRenewalDate');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-[10px] border p-5" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Device info</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Make">{asset.make}</Field>
          <Field label="Model">{asset.model}</Field>
        </div>
        <Field label="Serial number">{asset.serialNumber}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Operating system">{asset.operatingSystem}</Field>
          <Field label="OS version">{asset.osVersion}</Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Processor">{asset.processor}</Field>
          <Field label="RAM">{asset.ram}</Field>
          <Field label="Storage">{asset.storage}</Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="IP address">{asset.ipAddress}</Field>
          <Field label="MAC address">{asset.macAddress}</Field>
        </div>
        <Field label="Firmware version">{asset.firmwareVersion}</Field>
        {asset.deployedDate && <Field label="Deployed date">{asset.deployedDate}</Field>}
        {deviceValues.length > 0 && (
          <div className="grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: BORDER }}>
            {deviceValues.map((fv) => (
              <Field key={fv.id} label={fv.field?.label}>{formatFieldValue(fv.field, fv.value)}</Field>
            ))}
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Notes</p>
          <textarea
            className="input mt-1 resize-y text-sm"
            style={{ ...fieldStyle, minHeight: '90px' }}
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-4 rounded-[10px] border p-5" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
        <h2 className="font-semibold" style={{ color: TEXT }}>Assignment &amp; lifecycle</h2>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Assigned to</p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-sm" style={{ color: TEXT }}>
              {asset.assignedToContact ? `${asset.assignedToContact.displayName} (Contact)`
                : asset.assignedToUser ? `${asset.assignedToUser.displayName} (User)`
                : <span style={{ color: MUTED }}>Unassigned</span>}
            </p>
            {asset.assignedToContact && (
              <button type="button" onClick={() => setShowCheckoutModal(true)} className="btn-secondary flex-shrink-0 text-xs">Check out</button>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>Use Edit to change assignment.</p>
        </div>
        <Field label="Department">{asset.department?.name}</Field>
        <Field label="Location">
          {[asset.locationBuilding, asset.locationFloor && `Floor ${asset.locationFloor}`, asset.locationRoom && `Room ${asset.locationRoom}`].filter(Boolean).join(' · ') || undefined}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Purchase date">{asset.purchaseDate}</Field>
          <Field label="Purchase price">{asset.purchasePrice ? `$${Number(asset.purchasePrice).toLocaleString()}` : undefined}</Field>
        </div>
        <Field label="Vendor">{asset.vendorName}</Field>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Warranty expiry date</p>
          <p className="mt-0.5 text-sm" style={{ color: dateUrgencyColor(asset.warrantyExpiryDate) }}>{asset.warrantyExpiryDate || '—'}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Replacement plan date</p>
          <p className="mt-0.5 text-sm" style={{ color: dateUrgencyColor(asset.replacementPlanDate) }}>{asset.replacementPlanDate || '—'}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Status</p>
          <select
            className="input h-9 w-full text-sm"
            style={fieldStyle}
            value={asset.status}
            onChange={(e) => onPatch({ status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="in_repair">In repair</option>
            <option value="retired">Retired</option>
            <option value="in_storage">In storage</option>
            <option value="lost">Lost</option>
          </select>
        </div>
      </div>

      {subscriptionValues.length > 0 && (
        <div className="space-y-4 rounded-[10px] border p-5 lg:col-span-2" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
          <h2 className="font-semibold" style={{ color: TEXT }}>Subscription</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {subscriptionValues.map((fv) => (
              <div key={fv.id}>
                <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{fv.field?.label}</p>
                <p
                  className="mt-0.5 text-sm"
                  style={{ color: fv.field?.fieldKey === 'nextRenewalDate' ? subscriptionUrgencyColor(fv.value) : TEXT }}
                >
                  {formatFieldValue(fv.field, fv.value) ?? <span style={{ color: MUTED }}>—</span>}
                </p>
              </div>
            ))}
          </div>
          {renewalValue?.value && (
            <p className="text-xs" style={{ color: subscriptionUrgencyColor(renewalValue.value) }}>
              {subscriptionUrgencyColor(renewalValue.value) === 'var(--color-danger)' ? 'Renews soon or overdue'
                : subscriptionUrgencyColor(renewalValue.value) === 'var(--color-warning)' ? 'Renewing within 60 days'
                : 'Renewal not due soon'}
            </p>
          )}
        </div>
      )}

      {showCheckoutModal && (
        <CheckoutModal
          assetId={asset.id}
          contact={asset.assignedToContact}
          onClose={() => setShowCheckoutModal(false)}
          onCheckedOut={() => { setShowCheckoutModal(false); onCheckedOut?.(); }}
        />
      )}
    </div>
  );
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Checkout creation, followed by an inline "send the generated form now?"
// step when a PDF was generated — matches the spec's flow of "Send checkout
// form" appearing right after generation, without a second trip back to
// this asset's Checkout History tab.
function CheckoutModal({ assetId, contact, onClose, onCheckedOut }) {
  const [step, setStep] = useState('form'); // 'form' | 'sent-prompt'
  const [checkedOutAt, setCheckedOutAt] = useState(todayStr());
  const [notes, setNotes] = useState('');
  const [generateForm, setGenerateForm] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [checkout, setCheckout] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [emailTo, setEmailTo] = useState(contact?.email || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('Please find attached your equipment checkout form. Please sign and return to the IT department.');
  const [sending, setSending] = useState(false);

  const submitCheckout = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { data } = await api.post(`/assets/${assetId}/checkouts`, {
        contactId: contact.id, checkedOutAt, notes: notes || undefined, generateForm,
      });
      if (data.attachment) {
        setCheckout(data.checkout);
        setAttachment(data.attachment);
        setEmailSubject(`Equipment Checkout Form — ${data.checkout.asset?.assetTag || ''} ${data.checkout.asset?.name || ''}`.trim());
        setStep('sent-prompt');
      } else {
        onCheckedOut();
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sendForm = async () => {
    setSending(true);
    setError('');
    try {
      await api.post(`/assets/${assetId}/checkouts/${checkout.id}/send-form`, {
        attachmentId: attachment.id, to: emailTo, subject: emailSubject, body: emailBody,
      });
      onCheckedOut();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" style={{ backgroundColor: CARD_BG }} onClick={(e) => e.stopPropagation()}>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {step === 'form' ? (
          <form onSubmit={submitCheckout} className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: TEXT }}>Check out equipment</h2>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Contact</p>
              <p className="text-sm" style={{ color: TEXT }}>{contact?.displayName}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Checkout date</label>
              <input type="date" className="input" style={fieldStyle} value={checkedOutAt} onChange={(e) => setCheckedOutAt(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Notes</label>
              <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '70px' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
              <input type="checkbox" checked={generateForm} onChange={(e) => setGenerateForm(e.target.checked)} className="h-4 w-4" />
              Generate checkout form
            </label>
            <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Checking out…' : 'Check out'}</button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: TEXT }}>Send checkout form?</h2>
            <p className="text-sm" style={{ color: MUTED }}>The checkout form PDF was generated and saved to this asset&apos;s attachments.</p>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>To</label>
              <input className="input" style={fieldStyle} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Subject</label>
              <input className="input" style={fieldStyle} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Body</label>
              <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '80px' }} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
              <button type="button" onClick={onCheckedOut} className="btn-secondary">Skip</button>
              <button type="button" onClick={sendForm} disabled={sending || !emailTo} className="btn-primary">{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TicketsTab({ assetId, asset, canLinkTickets, navigate }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLink, setShowLink] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/assets/${assetId}/tickets`).then(({ data }) => setTickets(data.tickets)).finally(() => setLoading(false));
  };
  useEffect(load, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlink = async (ticketId) => {
    if (!confirm('Unlink this ticket from the asset?')) return;
    await api.delete(`/assets/${assetId}/tickets/${ticketId}`);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: TEXT }}>Linked tickets</h2>
        <div className="flex gap-2">
          {canLinkTickets && <button type="button" onClick={() => setShowLink(true)} className="btn-secondary text-sm">+ Link ticket</button>}
          <button
            type="button"
            onClick={() => navigate(`/tickets/new?assetId=${assetId}`)}
            className="btn-primary text-sm"
          >
            Create ticket for this asset
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
          No tickets linked yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
          <table className="min-w-full">
            <thead>
              <tr>
                {['#', 'Title', 'Status', 'Priority', 'Assignee', 'Created', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ borderBottom: `1px solid ${BORDER}`, color: MUTED }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: `1px solid ${BORDER}` }} className="hover:bg-[var(--color-hover)]">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs" style={{ color: MUTED }}>
                    <Link to={`/tickets/${t.id}`} className="hover:underline">#{t.ticketNumber}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Link to={`/tickets/${t.id}`} className="hover:underline" style={{ color: TEXT }}>{t.title}</Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: TEXT }}>{t.status}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: (PRIORITY_META[t.priority] || PRIORITY_META.medium).color }}>
                    {(PRIORITY_META[t.priority] || PRIORITY_META.medium).label}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{t.assignee?.displayName || 'Unassigned'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm" style={{ color: MUTED }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    {canLinkTickets && <button type="button" onClick={() => unlink(t.id)} style={{ color: 'var(--color-danger)' }}>Unlink</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showLink && (
        <LinkTicketModal assetId={assetId} onClose={() => setShowLink(false)} onLinked={() => { setShowLink(false); load(); }} />
      )}
    </div>
  );
}

function LinkTicketModal({ assetId, onClose, onLinked }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/tickets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.tickets.slice(0, 10)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const link = async (ticketId) => {
    setLinking(true);
    setError('');
    try {
      await api.post(`/assets/${assetId}/tickets`, { ticketId });
      onLinked();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" style={{ backgroundColor: CARD_BG }} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>Link a ticket</h2>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by ticket number or title…"
          className="input h-9 text-sm"
          style={fieldStyle}
          autoFocus
        />
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={linking}
              onClick={() => link(t.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-[var(--color-hover)]"
            >
              <span className="min-w-0">
                <span className="mr-2 font-mono text-xs" style={{ color: MUTED }}>{formatTicketId(t)}</span>
                <span className="text-sm" style={{ color: TEXT }}>{t.title}</span>
              </span>
            </button>
          ))}
          {query.trim() && results.length === 0 && (
            <p className="px-3 py-2 text-sm" style={{ color: MUTED }}>No tickets found.</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_LABEL = {
  created: 'Asset created',
  updated: 'Fields updated',
  status_changed: 'Status changed',
  assignment_changed: 'Assignment changed',
  ticket_linked: 'Ticket linked',
  ticket_unlinked: 'Ticket unlinked',
  checked_out: 'Checked out',
  checked_in: 'Checked in',
  checkout_form_generated: 'Checkout form generated',
  checkout_form_sent: 'Checkout form sent',
  checkout_form_received: 'Checkout form received',
  attachment_added: 'Attachment added',
  attachment_removed: 'Attachment removed',
  subscription_alert_ticket_created: 'Subscription renewal alert created',
};

function activityDescription(a) {
  const d = a.detail || {};
  if (a.action === 'created') return `Asset ${d.assetTag || ''} "${d.name || ''}" created`;
  if (a.action === 'status_changed') return `Status changed from "${d.from}" to "${d.to}"`;
  if (a.action === 'assignment_changed') return 'Assignment changed';
  if (a.action === 'ticket_linked' || a.action === 'ticket_unlinked') return `Ticket #${d.ticketNumber} — ${d.ticketTitle || ''}`;
  if (a.action === 'updated') return `Updated: ${(d.fields || []).join(', ')}`;
  if (a.action === 'checked_out') return `Checked out to ${d.contactName || 'a contact'}`;
  if (a.action === 'checkout_form_sent') return `Sent to ${d.to || ''}`;
  if (a.action === 'attachment_added' || a.action === 'attachment_removed') return d.originalName || '';
  if (a.action === 'subscription_alert_ticket_created') return `Ticket #${d.ticketNumber} created — renews ${d.renewalDate}`;
  return a.action;
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Attachments tab ----

function AttachmentsTab({ assetId }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef(null);

  const load = () => {
    api.get(`/assets/${assetId}/attachments`).then(({ data }) => setAttachments(data.attachments)).finally(() => setLoading(false));
  };
  useEffect(load, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    setUploadError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/assets/${assetId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err) {
      setUploadError(errMessage(err));
    }
  };
  const handleFiles = (files) => Array.from(files).forEach((f) => upload(f));

  const remove = async (attachmentId) => {
    if (!confirm('Delete this attachment?')) return;
    await api.delete(`/assets/${assetId}/attachments/${attachmentId}`);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {uploadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>}
      {attachments.length === 0 ? (
        <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
          No attachments yet — invoices, receipts, warranty documents, signed checkout forms, or photos of the equipment.
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-[10px] border p-3" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              <IconFile size={24} style={{ color: MUTED, flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: TEXT }}>{a.originalName}</p>
                <p className="text-xs" style={{ color: MUTED }}>
                  {formatFileSize(a.size)} · Uploaded by {a.uploadedBy?.displayName || 'System'} · {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
              <a
                href={`/api/v1/assets/${assetId}/attachments/${a.id}/download`}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
                style={{ color: BLUE }}
                title="Download"
              >
                <IconDownload size={16} />
              </a>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-danger)' }}
                title="Delete"
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or browse</p>
        <p className="mt-1 text-xs" style={{ color: MUTED }}>PDF, JPG, PNG, DOCX, XLSX — max 25MB</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ---- Checkout History tab ----

function CheckoutsTab({ assetId, asset, onChanged }) {
  const [checkouts, setCheckouts] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [sendPrompt, setSendPrompt] = useState(null); // { checkout, attachment }

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get(`/assets/${assetId}/checkouts`),
      api.get(`/assets/${assetId}/attachments`),
    ]).then(([c, a]) => { setCheckouts(c.data.checkouts); setAttachments(a.data.attachments); }).finally(() => setLoading(false));
  };
  useEffect(load, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkIn = async (checkoutId) => {
    setBusyId(checkoutId);
    try {
      await api.post(`/assets/${assetId}/checkouts/${checkoutId}/check-in`);
      onChanged?.();
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const markReceived = async (checkoutId) => {
    setBusyId(checkoutId);
    try {
      await api.patch(`/assets/${assetId}/checkouts/${checkoutId}`, { formReceived: true });
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {checkouts.length === 0 ? (
        <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
          No checkout history yet.
        </div>
      ) : (
        <div className="space-y-2">
          {checkouts.map((c) => {
            const active = !c.checkedInAt;
            const durationDays = c.checkedInAt
              ? Math.round((new Date(c.checkedInAt) - new Date(c.checkedOutAt)) / 86400000)
              : Math.round((Date.now() - new Date(c.checkedOutAt)) / 86400000);
            return (
              <div key={c.id} className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: active ? BLUE : BORDER }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium" style={{ color: TEXT }}>
                      {c.contact?.displayName}
                      {active && <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: BLUE }}>Current</span>}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                      Checked out {new Date(c.checkedOutAt).toLocaleDateString()}
                      {c.checkedInAt ? ` · Checked in ${new Date(c.checkedInAt).toLocaleDateString()}` : ' · Still out'}
                      {' · '}{durationDays}d
                    </p>
                    {c.notes && <p className="mt-1 text-xs" style={{ color: MUTED }}>{c.notes}</p>}
                    <p className="mt-1 text-xs" style={{ color: MUTED }}>
                      {c.checkoutFormReturnedAt
                        ? `Checkout form: Received ${new Date(c.checkoutFormReturnedAt).toLocaleDateString()}`
                        : c.checkoutFormSentAt
                        ? `Checkout form sent ${new Date(c.checkoutFormSentAt).toLocaleDateString()} — awaiting return`
                        : null}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-2">
                    {active && (
                      <button type="button" onClick={() => checkIn(c.id)} disabled={busyId === c.id} className="btn-secondary text-xs">
                        {busyId === c.id ? 'Checking in…' : 'Check in'}
                      </button>
                    )}
                    {!c.checkoutFormSentAt && attachments.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSendPrompt({ checkout: c, attachment: attachments[0] })}
                        className="btn-secondary text-xs"
                      >
                        Send checkout form
                      </button>
                    )}
                    {c.checkoutFormSentAt && !c.checkoutFormReturnedAt && (
                      <button type="button" onClick={() => markReceived(c.id)} disabled={busyId === c.id} className="btn-secondary text-xs">
                        Mark form received
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sendPrompt && (
        <SendCheckoutFormModal
          assetId={assetId}
          asset={asset}
          checkout={sendPrompt.checkout}
          attachment={sendPrompt.attachment}
          onClose={() => setSendPrompt(null)}
          onSent={() => { setSendPrompt(null); load(); }}
        />
      )}
    </div>
  );
}

function SendCheckoutFormModal({ assetId, asset, checkout, attachment, onClose, onSent }) {
  const [to, setTo] = useState(checkout.contact?.email || '');
  const [subject, setSubject] = useState(`Equipment Checkout Form — ${asset.assetTag} ${asset.name}`);
  const [body, setBody] = useState('Please find attached your equipment checkout form. Please sign and return to the IT department.');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setSending(true);
    setError('');
    try {
      await api.post(`/assets/${assetId}/checkouts/${checkout.id}/send-form`, { attachmentId: attachment.id, to, subject, body });
      onSent();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-none p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-lg" style={{ backgroundColor: CARD_BG }} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>Send checkout form</h2>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>To</label>
            <input className="input" style={fieldStyle} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Subject</label>
            <input className="input" style={fieldStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: TEXT }}>Body</label>
            <textarea className="input resize-y" style={{ ...fieldStyle, minHeight: '80px' }} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={send} disabled={sending || !to} className="btn-primary">{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ assetId }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/assets/${assetId}/activity`).then(({ data }) => setActivity(data.activity)).finally(() => setLoading(false));
  }, [assetId]);

  if (loading) return <Spinner />;
  if (activity.length === 0) {
    return (
      <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
        No activity yet.
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {activity.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: BLUE }} />
            <div className="min-w-0 flex-1">
              <p style={{ color: TEXT }}>
                <strong>{a.user?.displayName || 'System'}</strong> — {ACTIVITY_LABEL[a.action] || a.action}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>{activityDescription(a)}</p>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{new Date(a.createdAt).toLocaleString()}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
