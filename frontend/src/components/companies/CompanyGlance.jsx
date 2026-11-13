import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/api';
import { useAuth } from '../../context/AuthContext';

const MUTED = 'var(--color-text-muted)';

function Figure({ label, value, note, to }) {
  const Box = to ? Link : 'div';
  return (
    <Box {...(to ? { to } : {})} className={`card block p-4 ${to ? 'transition-colors hover:border-[var(--color-accent)]' : ''}`}>
      <p className="text-xs" style={{ color: MUTED }}>{label}</p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight text-navy-900">{value}</p>
      {note && <p className="mt-1 text-xs" style={{ color: MUTED }}>{note}</p>}
    </Box>
  );
}

// Overview: the company at a glance, and what's set up and what's missing.
// Each checklist line opens the place that fixes it.
export default function CompanyGlance({ company, onOpen }) {
  const { hasPermission } = useAuth();
  const [g, setG] = useState(null);
  useEffect(() => {
    api.get(`/companies/${company.id}/glance`).then(({ data }) => setG(data.glance)).catch(() => {});
  }, [company.id, company.updatedAt]);
  if (!g) return null;

  const canManage = hasPermission('companies.manage');
  const names = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', '));
  const steps = [
    {
      key: 'contacts', done: g.contacts > 0, label: 'Contacts',
      detail: g.contacts > 0 ? `${g.contacts} ${g.contacts === 1 ? 'person' : 'people'}` : 'the people who raise tickets', action: 'Add contacts', open: ['people', 'contacts'],
    },
    {
      key: 'departments', done: g.departments.length > 0, label: 'Departments',
      detail: g.departments.length ? names(g.departments) : 'none yet', action: 'Add a department', open: ['people', 'departments'],
    },
    ...(g.categories === null || !(company.isClient || company.isInternal) ? [] : [{
      key: 'categories', done: g.categories > 0, label: 'Ticket categories',
      detail: g.categories > 0 ? `${g.categories}` : 'what people choose from when they raise a ticket', action: 'Add categories', open: ['setup', 'categories'],
    }]),
    ...(g.devices === null ? [] : [{
      key: 'agent', done: g.devices > 0, label: 'Agent installed',
      detail: g.devices > 0 ? `${g.devices} ${g.devices === 1 ? 'computer' : 'computers'} reporting` : 'no computers yet', action: 'Install the agent', open: ['assets', 'devices'],
    }]),
    {
      key: 'domains', done: g.domains > 0, label: 'Email domain',
      detail: g.domains > 0 ? (company.domains || []).map((d) => d.domain).join(', ') : `so new senders are filed under ${company.name}`, action: 'Add a domain', open: ['setup', 'details'],
    },
    {
      key: 'portal', done: g.portalContacts > 0, label: 'Portal access',
      detail: g.portalContacts > 0 ? `${g.portalContacts} of ${g.contacts} can sign in` : 'nobody can sign in yet', action: 'Invite contacts', open: ['people', 'contacts'],
    },
    {
      key: 'manager', done: !!company.accountManager, label: 'Account manager',
      detail: company.accountManager ? company.accountManager.displayName : 'not set', action: canManage ? 'Choose one' : null, open: ['setup', 'details'],
    },
    {
      key: 'sites', done: g.sites > 0, label: 'Sites',
      detail: g.sites > 0 ? `${g.sites}` : 'none (only needed with more than one location)', action: 'Add a site', open: ['people', 'sites'],
    },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure label="Open tickets" value={g.openTickets} note={g.pastSla ? `${g.pastSla} past SLA` : 'none past SLA'} to={`/tickets?companyId=${company.id}`} />
        <Figure label="Contacts" value={g.contacts} note={`${g.portalContacts} with portal access`} />
        {g.devices !== null && <Figure label="Computers" value={g.devices} note={g.devices ? `${g.devicesOnline} online` : 'no agent installed'} />}
        <Figure label="Account manager" value={<span className="text-base">{company.accountManager?.displayName || 'Not set'}</span>} />
      </div>
      <section className="card" data-testid="company-setup">
        <h2 className="panel-header text-[15px] font-semibold text-navy-900">Setup · {done} of {steps.length} done</h2>
        <ul className="divide-y divide-navy-100 text-sm">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-3 px-5 py-3">
              <span aria-hidden="true" className="w-4 flex-shrink-0 text-center font-semibold" style={{ color: s.done ? 'var(--color-success)' : MUTED }}>{s.done ? '✓' : '○'}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-navy-900">{s.label}</span>
                <span className="sr-only">{s.done ? ' (done)' : ' (not done)'}</span>
                <span style={{ color: MUTED }}> · {s.detail}</span>
              </span>
              {s.action && (
                <button type="button" onClick={() => onOpen(...s.open)} className="flex-shrink-0 text-xs font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>
                  {s.done ? 'Open' : s.action}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
