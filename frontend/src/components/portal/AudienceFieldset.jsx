import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import api from '../../api/api';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';

const SCOPES = [
  ['all', 'All companies', 'Everyone who can sign in to the portal.'],
  ['companies', 'Chosen companies', 'Everyone in the companies you pick.'],
  ['departments', 'Chosen departments', 'Only contacts in the departments you pick.'],
];

// Mockup KbAudience: who can read a Portal article. value: { scope,
// companyIds, departmentIds }.
export default function AudienceFieldset({ value, onChange }) {
  const companies = useCompanyOptions();
  const [departments, setDepartments] = useState([]);
  useEffect(() => { api.get('/departments').then(({ data }) => setDepartments(data.departments || [])).catch(() => {}); }, []);
  const companyName = (id) => companies.find((c) => c.id === id)?.name;
  const deptLabel = (d) => [companyName(d.companyId), d.name].filter(Boolean).join(' › ');
  const clients = companies.filter((c) => !c.isInternal);
  const clientDepts = departments.filter((d) => clients.some((c) => c.id === d.companyId));

  const picking = value.scope === 'companies' ? 'companyIds' : 'departmentIds';
  const chosen = value.scope === 'all' ? [] : value[picking];
  const options = value.scope === 'companies'
    ? clients.map((c) => ({ id: c.id, label: c.name }))
    : clientDepts.map((d) => ({ id: d.id, label: deptLabel(d) }));
  const labelOf = (id) => options.find((o) => o.id === id)?.label || `#${id}`;
  const set = (ids) => onChange({ ...value, [picking]: ids });

  return (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-semibold">Who can read it in the portal</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {SCOPES.map(([key, label, hint]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm" style={{ borderColor: value.scope === key ? 'var(--color-accent)' : 'var(--color-border)' }}>
            <input type="radio" name="portal-audience" className="mt-0.5" checked={value.scope === key} onChange={() => onChange({ ...value, scope: key })} />
            <span><span className="block font-medium">{label}</span><span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span></span>
          </label>
        ))}
      </div>
      {value.scope !== 'all' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chosen.map((id) => (
            <span key={id} className="inline-flex min-w-0 items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm" style={{ backgroundColor: 'var(--color-hover)' }}>
              <span className="min-w-0 truncate">{labelOf(id)}</span>
              <button type="button" aria-label={`Remove ${labelOf(id)}`} onClick={() => set(chosen.filter((x) => x !== id))} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ color: 'var(--color-text-muted)' }}>
                <IconX size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          <select
            aria-label={value.scope === 'companies' ? 'Add a company' : 'Add a department'}
            className="input h-9 w-auto max-w-full text-sm"
            value=""
            onChange={(e) => { if (e.target.value) set([...chosen, Number(e.target.value)]); }}
          >
            <option value="">{value.scope === 'companies' ? 'Add a company…' : 'Add a department…'}</option>
            {options.filter((o) => !chosen.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {!chosen.length && <span className="text-xs" style={{ color: 'var(--color-warning)' }}>Nobody can read it until you pick at least one.</span>}
        </div>
      )}
    </fieldset>
  );
}
