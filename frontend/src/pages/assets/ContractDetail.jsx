import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconFile, IconUpload, IconTrash, IconDownload } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';
import ContractFormModal from '../../components/ContractFormModal';
import { CONTRACT_TYPE_LABELS, ContractTypeBadge, StatusPill, contractStatus, contractRenewsOn } from './Contracts';

const BORDER = 'var(--color-border)';
const CARD_BG = 'var(--color-card)';
const BG = 'var(--color-bg)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };

function StatCard({ label, value }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: TEXT }}>{value}</p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-0.5 text-sm" style={{ color: TEXT }}>{children ?? <span style={{ color: MUTED }}>—</span>}</p>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function daysUntilLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  return `${days}d`;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Assets' },
  { key: 'attachments', label: 'Attachments' },
];

export default function ContractDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canManage = usePermission('assets.manage_contracts');

  const [contract, setContract] = useState(null);
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/contracts/${id}`)
      .then(({ data }) => { setContract(data.contract); setStats(data.stats); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, []);

  const remove = async () => {
    if (!confirm(`Delete "${contract.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/contracts/${id}`);
      navigate('/assets/contracts');
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!contract) return null;

  const status = contractStatus(contract);

  return (
    <div className="space-y-5">
      <Link to="/assets/contracts" className="text-sm hover:underline" style={{ color: BLUE }}>← Back to Contracts</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold" style={{ color: TEXT }}>{contract.name}</h1>
            <ContractTypeBadge type={contract.contractType} />
            <StatusPill status={status} />
          </div>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>{contract.vendor || 'No vendor set'}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowEdit(true)} className="btn-secondary">Edit</button>
            <button type="button" onClick={remove} className="btn-danger">Delete</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Days until renewal" value={daysUntilLabel(stats.daysUntilRenewal)} />
        <StatCard label="Annual cost" value={contract.annualCost ? `$${Number(contract.annualCost).toLocaleString()}` : '—'} />
        <StatCard label="Total value" value={contract.totalValue ? `$${Number(contract.totalValue).toLocaleString()}` : '—'} />
        <StatCard label="Assets covered" value={stats.assetsCoveredCount} />
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: BORDER }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="border-b-2 px-3 py-2 text-sm font-medium transition"
            style={{ color: tab === t.key ? TEXT : MUTED, borderColor: tab === t.key ? BLUE : 'transparent' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab contract={contract} canManage={canManage} onChanged={load} />}
      {tab === 'assets' && <AssetsTab contractId={id} canManage={canManage} />}
      {tab === 'attachments' && <AttachmentsTab contractId={id} />}

      {showEdit && (
        <ContractFormModal
          contract={contract}
          departments={departments}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}

function OverviewTab({ contract, canManage, onChanged }) {
  const renewsOn = contractRenewsOn(contract);

  const toggleAutoRenews = async () => {
    if (!canManage) return;
    try {
      await api.patch(`/contracts/${contract.id}`, { autoRenews: !contract.autoRenews });
      onChanged();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 rounded-[10px] border p-5 sm:grid-cols-2 lg:grid-cols-3" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <Field label="Contract type">{CONTRACT_TYPE_LABELS[contract.contractType] || contract.contractType}</Field>
      <Field label="Vendor">{contract.vendor}</Field>
      <Field label="Department">{contract.department?.name}</Field>
      <Field label="Start date">{contract.startDate}</Field>
      <Field label="End date">{contract.endDate}</Field>
      <Field label="Renewal date">{contract.renewalDate}{renewsOn && !contract.renewalDate ? ` (from end date)` : ''}</Field>
      <Field label="Annual cost">{contract.annualCost ? `$${Number(contract.annualCost).toLocaleString()}` : undefined}</Field>
      <Field label="Total contract value">{contract.totalValue ? `$${Number(contract.totalValue).toLocaleString()}` : undefined}</Field>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Auto-renews</p>
        <button
          type="button"
          onClick={toggleAutoRenews}
          disabled={!canManage}
          className="mt-1 inline-flex items-center gap-2 text-sm"
          style={{ color: contract.autoRenews ? 'var(--color-success)' : MUTED, cursor: canManage ? 'pointer' : 'default' }}
        >
          <span
            className="inline-block h-5 w-9 flex-shrink-0 rounded-full transition"
            style={{ backgroundColor: contract.autoRenews ? 'var(--color-success)' : BORDER }}
          >
            <span
              className="block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition"
              style={{ transform: contract.autoRenews ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </span>
          {contract.autoRenews ? 'Yes' : 'No'}
        </button>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Vendor contact</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name">{contract.contactPerson}</Field>
          <Field label="Email">{contract.contactEmail}</Field>
          <Field label="Phone">{contract.contactPhone}</Field>
        </div>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>Notes</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm" style={{ color: TEXT }}>{contract.notes || <span style={{ color: MUTED }}>—</span>}</p>
      </div>
    </div>
  );
}

function AssetSearchPicker({ onPick, excludeIds }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/assets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.assets.filter((a) => !excludeIds.includes(a.id)).slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="relative">
      <input className="input" style={fieldStyle} placeholder="Search assets by tag or name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
          {results.map((a) => (
            <button key={a.id} type="button" onClick={() => { onPick(a); setQuery(''); setResults([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]" style={{ color: TEXT }}>
              <span className="font-mono text-xs" style={{ color: MUTED }}>{a.assetTag}</span> — {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetsTab({ contractId, canManage }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLink, setShowLink] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/contracts/${contractId}/assets`).then(({ data }) => setLinks(data.links)).finally(() => setLoading(false));
  };
  useEffect(load, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (asset) => {
    await api.post(`/contracts/${contractId}/assets`, { assetId: asset.id });
    setShowLink(false);
    load();
  };
  const unlink = async (assetId) => {
    if (!confirm('Remove this asset link?')) return;
    await api.delete(`/contracts/${contractId}/assets/${assetId}`);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {canManage && (
        showLink ? (
          <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium" style={{ color: TEXT }}>Link an asset</p>
              <button type="button" onClick={() => setShowLink(false)} style={{ color: MUTED }}>✕</button>
            </div>
            <AssetSearchPicker onPick={link} excludeIds={links.map((l) => l.asset.id)} />
          </div>
        ) : (
          <button type="button" onClick={() => setShowLink(true)} className="btn-secondary text-sm">+ Link asset</button>
        )
      )}

      {links.length === 0 ? (
        <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
          No assets linked to this contract yet.
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 rounded-[10px] border p-3" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              <div className="min-w-0">
                <Link to={`/assets/${l.asset.id}`} className="text-sm font-medium hover:underline" style={{ color: TEXT }}>
                  <span className="font-mono text-xs" style={{ color: MUTED }}>{l.asset.assetTag}</span> — {l.asset.name}
                </Link>
                <p className="text-xs" style={{ color: MUTED }}>Linked {new Date(l.linkedAt).toLocaleDateString()}{l.linkedByUser ? ` by ${l.linkedByUser.displayName}` : ''}</p>
              </div>
              {canManage && <button type="button" onClick={() => unlink(l.asset.id)} className="flex-shrink-0 text-sm" style={{ color: 'var(--color-danger)' }}>Remove</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentsTab({ contractId }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef(null);

  const load = () => {
    api.get(`/contracts/${contractId}/attachments`).then(({ data }) => setAttachments(data.attachments)).finally(() => setLoading(false));
  };
  useEffect(load, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    setUploadError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/contracts/${contractId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err) {
      setUploadError(errMessage(err));
    }
  };
  const handleFiles = (files) => Array.from(files).forEach((f) => upload(f));

  const remove = async (attachmentId) => {
    if (!confirm('Delete this attachment?')) return;
    await api.delete(`/contracts/${contractId}/attachments/${attachmentId}`);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {uploadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>}
      {attachments.length === 0 ? (
        <div className="rounded-[10px] border p-8 text-center text-sm" style={{ backgroundColor: CARD_BG, borderColor: BORDER, color: MUTED }}>
          No attachments yet — contract PDFs, amendments, SOWs, or purchase orders.
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
                href={`/api/v1/contracts/${contractId}/attachments/${a.id}/download`}
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
