import { useRef, useState } from 'react';
import { IconUpload, IconAlertTriangle } from '@tabler/icons-react';
import api, { errMessage } from '../api/api';

const CARD_BG = 'var(--color-card)';
const BORDER = 'var(--color-border)';
const TEXT = 'var(--color-text-primary)';
const MUTED = 'var(--color-text-muted)';
const BLUE = 'var(--color-accent)';
const AMBER = 'var(--color-warning)';
const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: TEXT };
const MAX_SIZE = 10 * 1024 * 1024;

const FIELD_OPTIONS = [
  { value: 'skip', label: 'Skip column' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'department', label: 'Department' },
  { value: 'jobTitle', label: 'Job title' },
];

const FIELD_SYNONYMS = {
  firstName: ['firstname', 'first name', 'first'],
  lastName: ['lastname', 'last name', 'last', 'surname'],
  email: ['email', 'email address', 'e-mail', 'e-mail address'],
  phone: ['phone', 'phone number', 'telephone'],
  mobile: ['mobile', 'mobile number', 'cell', 'cell phone'],
  department: ['department', 'dept'],
  jobTitle: ['jobtitle', 'job title', 'title', 'position'],
};

function autoDetectMapping(headers) {
  const mapping = {};
  headers.forEach((h) => {
    const norm = h.toLowerCase().trim();
    const match = Object.entries(FIELD_SYNONYMS).find(([, syns]) => syns.includes(norm));
    mapping[h] = match ? match[0] : 'skip';
  });
  return mapping;
}

function unmatchedDepartmentValues(headers, rows, mapping, departments) {
  const deptHeader = headers.find((h) => mapping[h] === 'department');
  if (!deptHeader) return [];
  const known = new Set(departments.map((d) => d.name.toLowerCase()));
  const bad = new Set();
  rows.forEach((r) => {
    const v = (r[deptHeader] || '').trim();
    if (v && !known.has(v.toLowerCase())) bad.add(v);
  });
  return [...bad];
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[100dvh] w-full flex-col rounded-none border p-5 sm:max-h-[85vh] sm:max-w-4xl sm:rounded-[10px]"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 flex-shrink-0 text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

const STEPS = ['upload', 'mapping', 'preview', 'results'];
const STEP_LABELS = { upload: 'Upload', mapping: 'Map columns', preview: 'Preview', results: 'Done' };

function StepIndicator({ step }) {
  const idx = STEPS.indexOf(step);
  return (
    <div className="mb-4 flex items-center gap-2 text-xs font-medium" style={{ color: MUTED }}>
      {STEPS.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-[11px]"
            style={i <= idx ? { backgroundColor: BLUE, color: 'white' } : { backgroundColor: BORDER, color: MUTED }}
          >
            {i + 1}
          </span>
          <span style={i === idx ? { color: TEXT, fontWeight: 600 } : undefined}>{STEP_LABELS[s]}</span>
          {i < STEPS.length - 1 && <span className="mx-1">→</span>}
        </span>
      ))}
    </div>
  );
}

export default function ImportContactsModal({ departments, onClose, onImported }) {
  const [step, setStep] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});

  const [validated, setValidated] = useState(null); // { rows, summary }
  const [validating, setValidating] = useState(false);

  const [results, setResults] = useState(null); // { created, skipped, failed, errors }
  const [committing, setCommitting] = useState(false);

  // ---- Step 1: upload ----
  const downloadSample = async () => {
    try {
      const res = await api.get('/contacts/import/sample', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prism-contacts-import-sample.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Only .csv files are supported');
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError('File is larger than 10MB');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/contacts/import/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setHeaders(data.headers);
      setRows(data.rows);
      setMapping(autoDetectMapping(data.headers));
      setStep('mapping');
    } catch (err) {
      setUploadError(errMessage(err));
    } finally {
      setUploading(false);
    }
  };

  // ---- Step 2: mapping ----
  const mappedFields = new Set(Object.values(mapping));
  const mappingValid = mappedFields.has('firstName') || mappedFields.has('email');
  const badDeptValues = unmatchedDepartmentValues(headers, rows, mapping, departments);

  const goToPreview = async () => {
    setValidating(true);
    try {
      const { data } = await api.post('/contacts/import/validate', { rows, mapping });
      setValidated(data);
      setStep('preview');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setValidating(false);
    }
  };

  // ---- Step 3: preview & commit ----
  const commitImport = async () => {
    setCommitting(true);
    try {
      const { data } = await api.post('/contacts/import', { rows, mapping });
      setResults(data);
      setStep('results');
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setCommitting(false);
    }
  };

  const finish = () => {
    onImported();
    onClose();
  };

  return (
    <Modal title="Import contacts" onClose={onClose}>
      <StepIndicator step={step} />

      {step === 'upload' && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-md border-2 border-dashed p-10 text-center transition"
            style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : 'var(--color-bg)' }}
          >
            <IconUpload size={30} style={{ color: MUTED, margin: '0 auto' }} />
            <p className="mt-2 text-sm font-medium" style={{ color: TEXT }}>
              {uploading ? 'Uploading…' : 'Drag & drop a CSV file here or click to browse'}
            </p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>.csv only — max 10MB</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>
          {uploadError && <p className="mt-2 text-sm" style={{ color: 'var(--color-danger)' }}>{uploadError}</p>}
          <button type="button" onClick={downloadSample} className="mt-4 text-sm font-medium hover:underline" style={{ color: BLUE }}>
            Download sample CSV
          </button>
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium" style={{ color: TEXT }}>Preview (first 3 rows)</p>
            <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER }}>
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold" style={{ backgroundColor: 'var(--color-bg)', color: MUTED }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 3).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: BORDER }}>
                      {headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-3 py-2" style={{ color: TEXT }}>{r[h] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium" style={{ color: TEXT }}>Map columns to PRISM fields</p>
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <span className="w-40 flex-shrink-0 truncate text-sm" style={{ color: TEXT }} title={h}>{h}</span>
                  <span style={{ color: MUTED }}>→</span>
                  <select
                    className="input h-9 flex-1 text-sm"
                    style={fieldStyle}
                    value={mapping[h] || 'skip'}
                    onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                  >
                    {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {badDeptValues.length > 0 && (
            <div className="flex items-start gap-2 rounded-md p-3 text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-bg))', color: AMBER }}>
              <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {badDeptValues.length} value{badDeptValues.length === 1 ? '' : 's'} don&apos;t match any department
                ({badDeptValues.slice(0, 5).join(', ')}{badDeptValues.length > 5 ? '…' : ''}) — these contacts will have no department assigned.
              </span>
            </div>
          )}

          {!mappingValid && (
            <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Map at least First name or Email to continue.</p>
          )}

          <div className="flex justify-between border-t pt-4" style={{ borderColor: BORDER }}>
            <button type="button" onClick={() => setStep('upload')} className="btn-secondary">Back</button>
            <button type="button" onClick={goToPreview} disabled={!mappingValid || validating} className="btn-primary">
              {validating ? 'Checking…' : 'Next: Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && validated && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--color-success)' }}>{validated.summary.willCreate}</p>
              <p style={{ color: MUTED }}>will be created</p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: MUTED }}>{validated.summary.willSkip}</p>
              <p style={{ color: MUTED }}>skipped (duplicate)</p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: AMBER }}>{validated.summary.warnings}</p>
              <p style={{ color: MUTED }}>have warnings</p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--color-danger)' }}>{validated.summary.errors}</p>
              <p style={{ color: MUTED }}>errors</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER }}>
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  {['#', 'First name', 'Last name', 'Email', 'Department', 'Status', 'Issues'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold" style={{ backgroundColor: 'var(--color-bg)', color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {validated.rows.map((r) => {
                  const hasIssue = r.issues.length > 0;
                  return (
                    <tr
                      key={r.rowIndex}
                      className="border-t"
                      style={{ borderColor: BORDER, backgroundColor: hasIssue ? 'color-mix(in srgb, var(--color-warning) 10%, transparent)' : undefined }}
                    >
                      <td className="px-3 py-2" style={{ color: MUTED }}>{r.rowIndex + 1}</td>
                      <td className="px-3 py-2" style={{ color: TEXT }}>{r.record.firstName || '—'}</td>
                      <td className="px-3 py-2" style={{ color: TEXT }}>{r.record.lastName || '—'}</td>
                      <td className="px-3 py-2" style={{ color: TEXT }}>{r.record.email || '—'}</td>
                      <td className="px-3 py-2" style={{ color: TEXT }}>{r.record.department || '—'}</td>
                      <td className="px-3 py-2 font-medium" style={{ color: r.action === 'error' ? 'var(--color-danger)' : r.action === 'skip' ? MUTED : 'var(--color-success)' }}>
                        {r.action === 'error' ? 'Error' : r.action === 'skip' ? 'Skip' : 'Create'}
                      </td>
                      <td className="px-3 py-2" style={{ color: AMBER }}>{r.issues.map((i) => i.message).join('; ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between border-t pt-4" style={{ borderColor: BORDER }}>
            <button type="button" onClick={() => setStep('mapping')} className="btn-secondary">Back</button>
            <button
              type="button"
              onClick={commitImport}
              disabled={validated.summary.errors > 0 || committing}
              className="btn-primary"
              title={validated.summary.errors > 0 ? 'Fix rows with errors before importing' : undefined}
            >
              {committing ? 'Importing…' : 'Proceed with import'}
            </button>
          </div>
        </div>
      )}

      {step === 'results' && results && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 text-center text-sm sm:grid-cols-3">
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--color-success)' }}>{results.created}</p>
              <p style={{ color: MUTED }}>created</p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: MUTED }}>{results.skipped}</p>
              <p style={{ color: MUTED }}>skipped (duplicates)</p>
            </div>
            <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--color-danger)' }}>{results.failed}</p>
              <p style={{ color: MUTED }}>failed</p>
            </div>
          </div>

          {results.errors.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium" style={{ color: TEXT }}>Failed rows</p>
              <ul className="space-y-1 rounded-md border p-3 text-sm" style={{ borderColor: BORDER }}>
                {results.errors.map((e) => (
                  <li key={e.rowIndex} style={{ color: 'var(--color-danger)' }}>Row {e.rowIndex + 1}: {e.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end border-t pt-4" style={{ borderColor: BORDER }}>
            <button type="button" onClick={finish} className="btn-primary">Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
