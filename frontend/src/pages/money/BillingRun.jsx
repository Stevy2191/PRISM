// The billing run (Phase 3, step 3): on the 1st PRISM drafts every
// customer's invoice by itself; here it can be previewed or run for a
// month by hand. Running twice changes nothing. Drafts are reviewed and
// sent from Invoices.
import { useState } from 'react';
import api, { errMessage } from '../../api/api';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import { usd } from './fmt';

const firstOfMonth = () => `${new Date().toLocaleDateString('en-CA').slice(0, 7)}-01`;

export default function BillingRun() {
  const [runDate, setRunDate] = useState(firstOfMonth());
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  return (
    <section aria-label="Billing run" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <p className="text-sm text-navy-600">Each customer gets one draft for the month: the coming month's agreement fees and last month's extras (billable time after the billing rules, trip charges, materials, rebilled expenses). Covered time is listed at $0.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Run for<input type="date" className="input mt-1" aria-label="Run date" value={runDate} onChange={(e) => setRunDate(e.target.value)} /></label>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => go(async () => { setResult(null); setPreview((await api.get('/money/billing-run/preview', { params: { runDate } })).data); })}>Preview</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => go(async () => { setPreview(null); setResult((await api.post('/money/billing-run', { runDate })).data); })}>Draft the invoices</button>
      </div>
      {busy && <Spinner />}
      {preview && (
        <div className="card overflow-x-auto" data-testid="billing-preview">
          <table className="min-w-full text-sm">
            <thead><tr>{['Customer', 'Lines', 'Total'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {preview.drafts.map((d) => (
                <tr key={d.companyId} className="border-t border-navy-100">
                  <td className="table-td font-medium">{d.companyName}</td>
                  <td className="table-td text-xs">{d.lines.map((l, i) => <div key={i}>{l.description} — {usd(l.amount)}</div>)}</td>
                  <td className="table-td num">{usd(d.total)}</td>
                </tr>
              ))}
              {!preview.drafts.length && <tr><td className="table-td" colSpan={3}>Nothing to bill for that month.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <Notice tone="info">
          {result.drafted.length ? `Drafted ${result.drafted.length} invoice${result.drafted.length === 1 ? '' : 's'}: ${result.drafted.map((d) => `${d.companyName} ${usd(d.total)}`).join(', ')}. Review and send them from Invoices.` : 'No new drafts.'}
          {result.skipped.length > 0 && ` Skipped: ${result.skipped.map((s) => `${s.companyName} (${s.reason})`).join(', ')}.`}
        </Notice>
      )}
    </section>
  );
}
