// What applies to a company (CS part 4), on its page under Setup: which
// checklist bundles are offered on its tickets (set here), and the workflow
// rules, recurring tickets and custom fields that reach it. Those are built
// in Settings, because one can serve many companies; each links there.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../Spinner';
import Switch from '../Switch';
import Notice from '../ui/Notice';

const MUTED = { color: 'var(--color-text-muted)' };
const LINK = { color: 'var(--color-accent)' };

function Card({ title, sub, action, children }) {
  return (
    <section aria-label={title} className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-navy-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
          {sub && <p className="text-xs" style={MUTED}>{sub}</p>}
        </div>
        {action}
      </div>
      <ul className="divide-y divide-navy-100 text-sm">{children}</ul>
    </section>
  );
}

function Row({ children, aside }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      {aside}
    </li>
  );
}

const Edit = ({ to, label }) => <Link to={to} className="text-sm font-medium hover:underline" style={LINK} aria-label={label}>Edit ›</Link>;

export default function CompanyApplies({ company }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const who = company.isInternal ? 'your company' : company.name;

  useEffect(() => {
    api.get(`/companies/${company.id}/applies`).then(({ data: d }) => setData(d)).catch((err) => setError(errMessage(err)));
  }, [company.id]);

  const offer = async (bundle, offered) => {
    setBusy(true); setError('');
    try {
      const { data: d } = await api.put(`/companies/${company.id}/bundles/${bundle.id}`, { offered });
      setData((prev) => ({ ...prev, bundles: d.bundles }));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;
  const { can } = data;
  return (
    <div className="space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}

      <Card title="Checklist bundles" sub={`Which bundles are offered on ${who}'s tickets. This is set here.`}>
        {data.bundles.map((b) => (
          <Row
            key={b.id}
            aside={<Switch checked={b.offered} disabled={!can.bundles || busy} onChange={(on) => offer(b, on)} label={`Offer ${b.name}`} />}
          >
            <span className="font-semibold">{b.name}</span>
            <span className="block text-xs" style={MUTED}>
              {b.forOthers ? 'Built for another customer' : (b.suggestedOn.length ? `Suggested on ${b.suggestedOn.join(', ')}` : 'Added by hand on a ticket')}
            </span>
          </Row>
        ))}
        {!data.bundles.length && <Row><span style={MUTED}>No bundles yet. They are made in Settings › Checklists.</span></Row>}
      </Card>

      <Card title="Workflow rules" sub={`Rules that name ${who}'s departments`}>
        {data.rules.map((r) => (
          <Row key={r.id} aside={can.rules && <Edit to={`/settings/workflow-rules/${r.id}`} label={`Edit ${r.name}`} />}>
            <span className="font-semibold">{r.name}</span>
            <span className="block text-xs" style={MUTED}>{r.departments.join(', ')}{r.isActive ? '' : ' · Off'}</span>
          </Row>
        ))}
        {!data.rules.length && <Row><span style={MUTED}>No rule names {who}&apos;s departments.</span></Row>}
        {data.rulesForAll > 0 && (
          <Row>
            <span style={MUTED}>{data.rulesForAll} more rule{data.rulesForAll === 1 ? ' applies' : 's apply'} to every company. </span>
            {can.rules && <Link to="/settings/workflow-rules" className="font-medium hover:underline" style={LINK}>See all rules</Link>}
          </Row>
        )}
      </Card>

      <Card
        title="Recurring tickets"
        sub={`Opened on a schedule for ${who}`}
        action={can.recurring && <Link to={`/settings/recurring-tickets/new?companyId=${company.id}`} className="btn-secondary h-8 px-3 text-[13px]">New for {company.isInternal ? 'your company' : company.name}</Link>}
      >
        {data.recurring.map((r) => (
          <Row key={r.id} aside={can.recurring && <Edit to={`/settings/recurring-tickets/${r.id}`} label={`Edit ${r.title}`} />}>
            <span className="font-semibold">{r.title}</span>
            <span className="block text-xs" style={MUTED}>{r.schedule}{r.active ? '' : ' · Paused'}</span>
          </Row>
        ))}
        {!data.recurring.length && <Row><span style={MUTED}>None yet.</span></Row>}
      </Card>

      <Card title="Custom fields" sub={`Extra fields on ${who}'s categories`}>
        {data.fields.map((f) => (
          <Row key={f.id} aside={can.fields && <Edit to="/settings/layouts" label={`Edit ${f.label}`} />}>
            <span className="font-semibold">{f.label}</span>
            <span className="block text-xs" style={MUTED}>{f.categories.join(', ')}</span>
          </Row>
        ))}
        {!data.fields.length && <Row><span style={MUTED}>No field is only on {who}&apos;s categories.</span></Row>}
        {data.fieldsForAll > 0 && <Row><span style={MUTED}>{data.fieldsForAll} more field{data.fieldsForAll === 1 ? ' shows' : 's show'} on every company&apos;s tickets.</span></Row>}
      </Card>

      <p className="text-sm text-navy-500">
        Rules, recurring tickets and custom fields are built in Settings, because one can serve many companies. This page shows which ones reach {who}, with a link to each.
      </p>
    </div>
  );
}
