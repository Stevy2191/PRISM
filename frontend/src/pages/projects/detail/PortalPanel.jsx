// CN: a customer project in its company's portal. The customer contacts
// named here see it (with the company's admins, and the admins of the
// department it's for); Show in the portal hides or shows it for everyone.
import { useCallback, useEffect, useState } from 'react';
import api, { errMessage } from '../../../api/api';
import ContactPicker from '../../../components/portal/ContactPicker';
import Notice from '../../../components/ui/Notice';
import { CARD_BG, BORDER, TEXT, MUTED } from '../theme';

export default function PortalPanel({ project, canEdit, onChanged }) {
  const [contacts, setContacts] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.get(`/projects/${project.id}/contacts`).then(({ data }) => setContacts(data.contacts)).catch((err) => setError(errMessage(err)));
  }, [project.id]);
  useEffect(load, [load]);
  if (!project.company || project.company.isInternal) return null;

  const save = async (ids) => {
    setError('');
    try {
      const { data } = await api.put(`/projects/${project.id}/contacts`, { contactIds: ids });
      setContacts(data.contacts);
    } catch (err) { setError(errMessage(err)); }
  };
  const toggle = async () => {
    setError('');
    try {
      await api.patch(`/projects/${project.id}`, { showInPortal: !project.showInPortal });
      if (onChanged) onChanged();
    } catch (err) { setError(errMessage(err)); }
  };

  return (
    <section aria-label="In the portal" className="space-y-3 rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold" style={{ color: TEXT }}>In {project.company.name}&apos;s portal</h3>
          <p className="text-xs" style={{ color: MUTED }}>Status, progress, phases and milestones only: no tasks, people, time, costs, files or notes.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(project.showInPortal)} disabled={!canEdit} onChange={toggle} />
          Show in the portal
        </label>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div>
        <p className="text-sm font-medium" style={{ color: TEXT }}>Customer contacts</p>
        <p className="text-xs" style={{ color: MUTED }}>
          They see this project, as do {project.company.name}&apos;s company admins{project.forDepartment ? ` and ${project.forDepartment.name}'s admins` : ''}.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {contacts.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm" style={{ borderColor: BORDER }}>
              {c.displayName}
              {canEdit && <button type="button" aria-label={`Remove ${c.displayName}`} className="hover:underline" style={{ color: MUTED }} onClick={() => save(contacts.filter((x) => x.id !== c.id).map((x) => x.id))}>×</button>}
            </span>
          ))}
          {!contacts.length && <span className="text-sm" style={{ color: MUTED }}>None yet.</span>}
          {canEdit && (
            <ContactPicker
              companyId={project.companyId}
              exclude={contacts.map((c) => c.id)}
              label="Add a customer contact"
              onPick={(c) => save([...contacts.map((x) => x.id), c.id])}
            />
          )}
        </div>
      </div>
    </section>
  );
}
