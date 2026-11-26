// Timesheets (Phase 3, step 3): my week (built from the time I logged; I
// submit it, and it's locked until my manager sends it back) and, for
// approvers, the weeks waiting for them.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../api/api';
import { usePermission } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Tabs from '../components/ui/Tabs';
import Notice from '../components/ui/Notice';
import Spinner from '../components/Spinner';
import StatusChip from '../components/ui/StatusChip';

const TONE = { open: 'neutral', submitted: 'info', approved: 'good', rejected: 'bad' };
const LABEL = { open: 'Open', submitted: 'Submitted', approved: 'Approved', rejected: 'Sent back' };
const hours = (s) => `${(s / 3600).toFixed(2).replace(/\.?0+$/, '')} h`;
const shift = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function MyWeek() {
  const [week, setWeek] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const load = (w) => api.get('/timesheets/mine', { params: w ? { week: w } : {} }).then(({ data }) => setSheet(data.timesheet)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(week); }, [week]);
  if (!sheet) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const submit = async () => {
    setError('');
    try { const { data } = await api.post('/timesheets/mine/submit', { week: sheet.weekStart }); setSheet(data.timesheet); } catch (err) { setError(errMessage(err)); }
  };
  return (
    <section aria-label="My week" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => setWeek(shift(sheet.weekStart, -7))}>Previous week</button>
        <span className="text-sm font-medium">Week of {sheet.weekStart}</span>
        <button type="button" className="btn-secondary" onClick={() => setWeek(shift(sheet.weekStart, 7))}>Next week</button>
        <StatusChip tone={TONE[sheet.status]}>{LABEL[sheet.status]}</StatusChip>
      </div>
      {sheet.status === 'rejected' && sheet.note && <Notice tone="bad">Sent back: {sheet.note}</Notice>}
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="timesheet">
          <thead><tr><th className="table-th">Day</th><th className="table-th">Work</th><th className="table-th text-right">Time</th></tr></thead>
          <tbody>
            {sheet.days.map((d) => (
              <tr key={d.date} className="border-t border-navy-100">
                <td className="table-td whitespace-nowrap">{weekday(d.date)}</td>
                <td className="table-td text-xs">{d.entries.map((e) => <div key={e.id}>{e.note || (e.ticketId ? `Ticket #${e.ticketId}` : `Project #${e.projectId}`)} — {hours(e.durationSeconds)}</div>)}</td>
                <td className="table-td num text-right">{d.seconds ? hours(d.seconds) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-navy-200 font-semibold"><td className="table-td" colSpan={2}>Week</td><td className="table-td num text-right" data-testid="timesheet-total">{hours(sheet.totalSeconds)}</td></tr>
          </tbody>
        </table>
      </div>
      {['open', 'rejected'].includes(sheet.status) && <button type="button" className="btn-primary" onClick={submit}>Submit this week</button>}
    </section>
  );
}

function Approvals() {
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/timesheets/pending').then(({ data }) => setSheets(data.timesheets)).catch((err) => setError(errMessage(err)));
  useEffect(() => { load(); }, []);
  const decide = async (s, approve) => {
    const note = approve ? '' : window.prompt('What needs changing?');
    if (!approve && !note) return;
    setError('');
    try { await api.post(`/timesheets/${s.id}/${approve ? 'approve' : 'reject'}`, { note }); load(); } catch (err) { setError(errMessage(err)); }
  };
  if (!sheets) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  return (
    <section aria-label="Approvals" className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="timesheet-approvals">
          <thead><tr>{['Person', 'Week of', 'Time', ''].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.id} className="border-t border-navy-100">
                <td className="table-td font-medium">{s.user?.displayName}</td>
                <td className="table-td">{s.weekStart}</td>
                <td className="table-td num">{hours(s.totalSeconds)}</td>
                <td className="table-td space-x-3 text-right">
                  <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => decide(s, true)}>Approve</button>
                  <button type="button" className="text-xs underline" onClick={() => decide(s, false)}>Send back</button>
                </td>
              </tr>
            ))}
            {!sheets.length && <tr><td className="table-td" colSpan={4}>Nothing waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Timesheets() {
  const canApprove = usePermission('money.timesheets.approve');
  const [tab, setTab] = useState('mine');
  const tabs = [{ id: 'mine', label: 'My week' }, ...(canApprove ? [{ id: 'approvals', label: 'To approve' }] : [])];
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader title="Timesheets" sub="Your week of logged time: submit it when it's complete." />
      {tabs.length > 1 && <Tabs items={tabs} value={tab} onChange={setTab} label="Timesheet sections" className="mt-5" />}
      <div className="mt-5">{tab === 'approvals' ? <Approvals /> : <MyWeek />}</div>
    </div>
  );
}
