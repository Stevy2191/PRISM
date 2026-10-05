import { useAuth } from '../../context/AuthContext';
import { useCompanySummary } from '../../context/CompanyContext';
import { useCompanyOptions } from '../../hooks/useCompanyOptions';
import SitePicker from './SitePicker';

// Company and site on the contact page. Moving a contact to another company
// takes all its tickets with it and clears a department or site from the
// old company (spec), so it asks first. Moving needs people.edit_users.
export default function ContactCompanyFields({ contact, canEdit, onSave }) {
  const { multiCompany } = useCompanySummary();
  const { hasPermission } = useAuth();
  const companies = useCompanyOptions();
  if (!multiCompany) return null;
  const canMove = canEdit && hasPermission('people.edit_users');
  const listed = companies.some((c) => c.id === contact.companyId) || !contact.company
    ? companies
    : [contact.company, ...companies];

  const move = (raw) => {
    const companyId = Number(raw);
    if (!companyId || companyId === contact.companyId) return;
    const target = companies.find((c) => c.id === companyId);
    const ok = window.confirm(
      `Move ${contact.displayName} to ${target ? target.name : 'that company'}? `
      + `All of their tickets move too, and a department or site from ${contact.company?.name || 'the current company'} is cleared.`
    );
    if (ok) onSave({ companyId });
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 text-left">
      <div>
        <label className="label" htmlFor="contact-company">Company</label>
        <select id="contact-company" className="input h-9 text-sm" disabled={!canMove} value={contact.companyId || ''} onChange={(e) => move(e.target.value)}>
          {listed.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <span className="label">Site</span>
        <SitePicker
          companyId={contact.companyId}
          value={contact.siteId || ''}
          disabled={!canEdit}
          className="input h-9 text-sm"
          onChange={(siteId) => onSave({ siteId: siteId ? Number(siteId) : null })}
        />
      </div>
    </div>
  );
}
