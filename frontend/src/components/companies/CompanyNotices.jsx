import { useCallback, useEffect, useState } from 'react';
import Notice from '../ui/Notice';
import api, { errMessage } from '../../api/api';
import { fmtDateTime } from '../../utils/formatDate';

const MUTED = 'var(--color-text-muted)';
// "Take it down" choices: the notice clears itself, so a stale one never lingers.
const UNTIL = [['2', 'In 2 hours'], ['eod', 'End of today'], ['24', 'In 24 hours'], ['72', 'In 3 days'], ['', 'When I take it down']];

function untilDate(choice) {
  if (!choice) return null;
  if (choice === 'eod') { const d = new Date(); d.setHours(23, 59, 0, 0); return d.toISOString(); }
  return new Date(Date.now() + Number(choice) * 3600 * 1000).toISOString();
}

// Agent notices (owner, 2026-11-13): a short notice shown in the PRISM
// agent on this company's computers (its window, and a dot on its icon
// until each person has seen it).
export default function CompanyNotices({ company }) {
  const [notices, setNotices] = useState([]);
  const [canPostToAll, setCanPostToAll] = useState(false);
  const [form, setForm] = useState({ headline: '', message: '', until: 'eod', everyone: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get('/agent-notices', { params: { companyId: company.id } })
      .then(({ data }) => { setNotices(data.notices); setCanPostToAll(!!data.canPostToAll); })
      .catch((err) => setError(errMessage(err)));
  }, [company.id]);
  useEffect(load, [load]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const post = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/agent-notices', {
        companyId: form.everyone ? null : company.id, headline: form.headline, message: form.message || null, expiresAt: untilDate(form.until),
      });
      setForm({ headline: '', message: '', until: 'eod', everyone: false });
      load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const takeDown = async (n) => {
    setError('');
    try {
      await api.delete(`/agent-notices/${n.id}`);
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card min-w-0">
        <h2 className="panel-header text-[15px] font-semibold text-navy-900">Showing now</h2>
        <p className="px-5 pt-3 text-sm" style={{ color: MUTED }}>
          People at {company.name}&apos;s computers see these at the top of the PRISM agent&apos;s window. Its icon carries a dot until they&apos;ve looked.
        </p>
        <ul className="divide-y divide-navy-100 text-sm" data-testid="agent-notices">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="break-words font-semibold text-navy-900">{n.headline}</p>
                {n.message && <p className="break-words text-navy-700">{n.message}</p>}
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {n.companyId ? company.name : 'Every company'} · posted {fmtDateTime(n.createdAt)}{n.author ? ` by ${n.author.displayName}` : ''}
                  {' · '}{n.expiresAt ? `comes down ${fmtDateTime(n.expiresAt)}` : 'stays until taken down'}
                </p>
              </div>
              {(n.companyId || canPostToAll) && (
                <button type="button" className="flex-shrink-0 text-xs font-semibold hover:underline" style={{ color: 'var(--color-danger)' }} onClick={() => takeDown(n)}>Take down</button>
              )}
            </li>
          ))}
          {!notices.length && <li className="px-5 py-4" style={{ color: MUTED }}>No notices are showing.</li>}
        </ul>
      </section>

      <section className="card min-w-0">
        <h2 className="panel-header text-[15px] font-semibold text-navy-900">New notice</h2>
        <form onSubmit={post} className="space-y-4 p-5">
          {error && <Notice tone="bad">{error}</Notice>}
          <div>
            <label className="label" htmlFor="notice-headline">Headline</label>
            <input id="notice-headline" className="input" maxLength={120} required value={form.headline} onChange={set('headline')} placeholder="Email is slow this morning" />
          </div>
          <div>
            <label className="label" htmlFor="notice-message">Message (optional)</label>
            <textarea id="notice-message" className="input" rows={3} maxLength={500} value={form.message} onChange={set('message')} placeholder="We're on it. No need to send a ticket." />
          </div>
          <div>
            <label className="label" htmlFor="notice-until">Take it down</label>
            <select id="notice-until" className="input" value={form.until} onChange={set('until')}>
              {UNTIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {canPostToAll && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.everyone} onChange={set('everyone')} /> Show it to every company, not only {company.name}</label>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !form.headline.trim()}>{busy ? 'Posting…' : 'Post notice'}</button>
        </form>
      </section>
    </div>
  );
}
