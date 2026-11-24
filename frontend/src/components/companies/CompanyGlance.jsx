import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/api';
import { showPhone } from '../../utils/formatPhone';
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
export default function CompanyGlance({ company, onOpen, justMade = false }) {
  const { hasPermission } = useAuth();
  const [g, setG] = useState(null);
  useEffect(() => {
    api.get(`/companies/${company.id}/glance`).then(({ data }) => setG(data.glance)).catch(() => {});
  }, [company.id, company.updatedAt]);
  if (!g) return null;

  const canManage = hasPermission('companies.manage');
  // Mockup NewCompany (CS): the nine things that finish setting up a company.
  const sla = g.sla;
  const steps = [
    {
      key: 'details', done: !!(company.phone || company.website), label: 'Details',
      detail: company.phone || company.website ? [showPhone(company.phone), company.website].filter(Boolean).join(' · ') : 'name, phone and website', action: 'Open', open: ['setup', 'details'],
    },
    ...(sla ? [{
      key: 'sla', done: sla.reviewed, label: 'SLA targets',
      detail: sla.reviewed ? 'reviewed' : 'copied from your starting values; review them for this customer', action: 'Review', open: ['setup', 'sla'],
    }, {
      key: 'hours', done: sla.reviewed, label: 'Support hours and holidays',
      detail: `${sla.hours}, ${sla.timezone}, ${sla.holidays} holiday${sla.holidays === 1 ? '' : 's'}${sla.reviewed ? '' : ' (copied)'}`, action: 'Review', open: ['setup', 'sla'],
    }] : []),
    {
      key: 'contacts', done: g.contacts > 0, label: 'Contacts',
      detail: g.contacts > 0 ? `${g.contacts} ${g.contacts === 1 ? 'person' : 'people'}` : 'the people who will ask for help, or link Microsoft 365 to bring them in', action: 'Add contacts', open: ['people', 'contacts'],
    },
    {
      key: 'domains', done: g.domains > 0, label: 'Email domain',
      detail: g.domains > 0 ? (company.domains || []).map((d) => d.domain).join(', ') : `so emails from it become ${company.name}'s tickets`, action: 'Add', open: ['setup', 'details'],
    },
    ...(g.categories === null || !company.isClient ? [] : [{
      key: 'categories', done: g.categories > 0, label: 'Ticket categories',
      detail: g.categories > 0 ? `${g.categories}` : `${company.name}'s own list; start from yours or from nothing`, action: 'Set up', open: ['setup', 'categories'],
    }]),
    ...(g.software === null || !company.isClient ? [] : [{
      key: 'software', done: g.software > 0, label: 'Software list',
      detail: g.software > 0 ? `${g.software} ${g.software === 1 ? 'app' : 'apps'}` : 'the apps their people use, for "which app?" questions; add them or pick from their computers', action: 'Add apps', open: ['setup', 'software'],
    }]),
    ...(!company.isClient ? [] : [{
      key: 'sites', done: g.sites > 0, label: 'Sites',
      detail: g.sites > 0 ? `${g.sites} ${g.sites === 1 ? 'site' : 'sites'}` : 'their offices and locations', action: 'Add', open: ['people', 'sites'],
    }, {
      key: 'departments', done: g.departments.length > 0, label: 'Departments',
      detail: g.departments.length > 0 ? `${g.departments.length} ${g.departments.length === 1 ? 'department' : 'departments'}` : 'optional; groups their people and tickets', action: 'Add', open: ['people', 'departments'],
    }]),
    ...(!company.isClient ? [] : [{
      key: 'portal', done: g.portal.enabled, label: 'Portal',
      detail: g.portal.enabled ? `on · ${g.portalContacts} of ${g.contacts} can sign in` : `off. Turn it on to give ${company.name} its own link.`, action: 'Set up', open: ['setup', 'portal'],
    }, {
      key: 'surveys', done: g.surveys.chosen, label: 'Satisfaction surveys',
      detail: g.surveys.enabled ? (g.surveys.chosen ? 'on' : 'on for new companies. Keep or turn off.') : 'off', action: 'Choose', open: ['setup', 'surveys'],
    }]),
    ...(g.devices === null ? [] : [{
      key: 'agent', done: g.devices > 0, label: 'Agent on their computers',
      detail: g.devices > 0 ? `${g.devices} ${g.devices === 1 ? 'computer' : 'computers'} reporting` : `make an install link for ${company.name}`, action: 'Open', open: ['assets', 'devices'],
    }]),
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure label="Open tickets" value={g.openTickets} note={g.pastSla ? `${g.pastSla} past SLA` : 'none past SLA'} to={`/tickets?companyId=${company.id}`} />
        <Figure label="Contacts" value={g.contacts} note={`${g.portalContacts} with portal access`} />
        {g.devices !== null && <Figure label="Computers" value={g.devices} note={g.devices ? `${g.devicesOnline} online` : 'no agent installed'} />}
        <Figure
          label="Account manager"
          value={<span className="text-base">{company.accountManager?.displayName || 'Not set'}</span>}
          note={canManage ? <button type="button" onClick={() => onOpen('setup', 'details')} className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>{company.accountManager ? 'Change' : 'Choose'}</button> : null}
        />
      </div>
      {justMade && (
        <div role="status" className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-accent-soft)' }}>
          {company.name} is created. It starts with a copy of your starting SLA targets, support hours and holidays. Work down the list to finish setting it up; everything for this company is on this page.
        </div>
      )}
      <section className="card" data-testid="company-setup">
        <h2 className="panel-header text-[15px] font-semibold text-navy-900">Set up this company · {done} of {steps.length} done</h2>
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
