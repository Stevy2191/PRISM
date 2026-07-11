import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Switch from '../../components/Switch';
import Modal from '../../components/Modal';

const DELAY_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '1', label: '1 hour after close' },
  { value: '4', label: '4 hours after close' },
  { value: '24', label: '24 hours after close' },
];

const EXPIRY_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

export default function CustomerHappiness() {
  const [form, setForm] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        const s = data.settings;
        setForm({
          'csat.enabled': s['csat.enabled'] === 'true',
          'csat.sendDelayHours': s['csat.sendDelayHours'] || '0',
          'csat.surveyQuestion': s['csat.surveyQuestion'] || 'How satisfied were you with the support you received?',
          'csat.expiryDays': s['csat.expiryDays'] || '7',
          'csat.minTicketsToShowRating': s['csat.minTicketsToShowRating'] || '3',
        });
        setCompanyName(s['company.name'] || 'Your company');
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', {
        settings: {
          'csat.enabled': String(form['csat.enabled']),
          'csat.sendDelayHours': form['csat.sendDelayHours'],
          'csat.surveyQuestion': form['csat.surveyQuestion'],
          'csat.expiryDays': form['csat.expiryDays'],
          'csat.minTicketsToShowRating': form['csat.minTicketsToShowRating'],
        },
      });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Customer Happiness</h1>
        <p className="text-sm text-navy-500">
          Automatically email a satisfaction survey to the contact when a ticket is closed. Ratings feed
          into technician performance stats on their profile, the dashboard, and reports.
        </p>
      </div>
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      <form onSubmit={save} className="card space-y-5 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-navy-900">Enable CSAT surveys</p>
            <p className="text-xs text-navy-400">Send a survey email to the contact whenever a ticket is closed.</p>
          </div>
          <Switch
            checked={form['csat.enabled']}
            onChange={(v) => setForm((f) => ({ ...f, 'csat.enabled': v }))}
            label="Enable CSAT surveys"
          />
        </div>

        <div>
          <label className="label">Survey question</label>
          <textarea
            className="input resize-y"
            style={{ minHeight: '70px' }}
            value={form['csat.surveyQuestion']}
            onChange={set('csat.surveyQuestion')}
            maxLength={500}
          />
          <p className="mt-1 text-xs text-navy-400">Shown to the contact in the survey email and on the survey page.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Send delay</label>
            <select className="input" value={form['csat.sendDelayHours']} onChange={set('csat.sendDelayHours')}>
              {DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Survey expiry</label>
            <select className="input" value={form['csat.expiryDays']} onChange={set('csat.expiryDays')}>
              {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Minimum responses before showing a tech's rating</label>
          <input
            type="number"
            min="1"
            className="input w-32"
            value={form['csat.minTicketsToShowRating']}
            onChange={set('csat.minTicketsToShowRating')}
          />
          <p className="mt-1 text-xs text-navy-400">
            A technician's CSAT star rating stays hidden on their profile, the dashboard, and reports until
            they have at least this many survey responses — protects against one bad (or one lucky) rating
            skewing a small sample.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-navy-100 pt-4">
          <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)}>
            Preview survey email
          </button>
          <div className="flex items-center gap-3">
            {savedAt && <span className="text-xs text-green-600">Saved</span>}
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>

      {previewOpen && (
        <SurveyEmailPreview
          question={form['csat.surveyQuestion']}
          expiryDays={form['csat.expiryDays']}
          companyName={companyName}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function SurveyEmailPreview({ question, expiryDays, companyName, onClose }) {
  return (
    <Modal title="Survey email preview" onClose={onClose} wide>
      <div className="rounded-md border border-navy-100 bg-navy-50 p-3 text-xs text-navy-500">
        Subject: How did we do? — Ticket #00114 Printer not connecting to network
      </div>
      <div className="mt-3 rounded-md border border-navy-100 bg-white p-6 font-sans text-sm text-navy-900">
        <p>Hi Jordan,</p>
        <p className="mt-2">Your recent support request has been resolved. We&apos;d love to hear how we did.</p>
        <p className="mt-4 font-semibold">{question || 'How satisfied were you with the support you received?'}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className="rounded-lg px-3 py-2 text-lg tracking-widest"
              style={{ backgroundColor: '#fef3c7', color: '#b45309' }}
            >
              {'★'.repeat(n)}{'☆'.repeat(5 - n)}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center">
          <span className="text-prism">Or click here to leave detailed feedback</span>
        </p>
        <hr className="my-4 border-navy-100" />
        <p className="text-xs text-navy-400">
          {companyName}
          <br />
          This survey expires in {expiryDays} day{Number(expiryDays) === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
