// A company's satisfaction surveys (CS part 3), on its page under Setup ›
// Surveys. The question, delay and expiry are shared, in Settings › Customer
// happiness.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Switch from '../Switch';
import Notice from '../ui/Notice';

export default function CompanySurveys({ company }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/companies/${company.id}/portal`).then(({ data: d }) => setData(d)).catch((err) => setError(errMessage(err)));
  }, [company.id]);
  const toggle = async (on) => {
    setBusy(true); setError('');
    try { setData((await api.put(`/companies/${company.id}/surveys`, { enabled: on })).data); } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };
  if (!data) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const whose = company.isInternal ? 'your company' : company.name;
  return (
    <div className="space-y-4">
      {error && <Notice tone="bad">{error}</Notice>}
      <section aria-label="Surveys" className="card flex items-center justify-between gap-4 p-5">
        <div>
          <p className="font-semibold text-navy-900">Satisfaction surveys</p>
          <p className="text-xs text-navy-400">When one of {whose}&apos;s tickets is closed, its contact is emailed a short survey.</p>
        </div>
        <span className="flex items-center gap-2 text-sm font-medium">
          {data.portal.surveys ? 'On' : 'Off'}
          <Switch checked={data.portal.surveys} disabled={!data.canChangeSurveys || busy} onChange={toggle} label="Send surveys" />
        </span>
      </section>
      <p className="text-sm text-navy-500">
        The question, when it is sent and how long it stays open are the same for every company, in{' '}
        <Link to="/settings/customer-happiness" className="font-medium hover:underline" style={{ color: 'var(--color-accent)' }}>Customer happiness</Link>.
      </p>
    </div>
  );
}
