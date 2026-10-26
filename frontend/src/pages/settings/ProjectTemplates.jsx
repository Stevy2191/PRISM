// Settings → Project templates (sub-project 6): the templates New project
// starts from. Editing happens on the next page; a project can be saved as a
// template from its own menu.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import { hoursInput } from '../projects/detail/budgetFormat';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const summaryLine = (t) => [
  plural(t.phaseCount, 'phase'),
  plural(t.taskCount, 'task'),
  t.hourBudgetMinutes ? `${hoursInput(t.hourBudgetMinutes)} h` : null,
].filter(Boolean).join(' · ');

export default function ProjectTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => api.get('/project-templates')
    .then(({ data }) => setTemplates(data.templates))
    .catch((err) => setError(errMessage(err)))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const remove = async (t) => {
    if (!confirm(`Delete "${t.name}"? Projects already made from it keep everything.`)) return;
    try { await api.delete(`/project-templates/${t.id}`); load(); } catch (err) { setError(errMessage(err)); }
  };

  if (loading) return <Spinner />;
  return (
    <SettingsPage actions={<Link to="/settings/project-templates/new" className="btn-primary">New template</Link>}>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="card divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {templates.length === 0 && <p className="p-5 text-sm text-navy-400">No templates yet. Make one here, or open a project and choose Save as template from its menu.</p>}
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="template-row">
            <div className="min-w-0">
              <Link to={`/settings/project-templates/${t.id}`} className="font-semibold hover:underline" style={{ color: 'var(--color-text-primary)' }}>{t.name}</Link>
              {t.description && <p className="text-sm text-navy-500">{t.description}</p>}
              <p className="num text-xs text-navy-400">{summaryLine(t)} · used for {plural(t.usedCount, 'project')}</p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Link to={`/projects/new?template=${t.id}`} className="text-xs hover:underline" style={{ color: 'var(--color-accent)' }}>Start a project</Link>
              <Link to={`/settings/project-templates/${t.id}`} className="text-xs hover:underline" style={{ color: 'var(--color-accent)' }}>Edit</Link>
              <Button variant="quiet" size="sm" onClick={() => remove(t)} style={{ color: 'var(--color-danger)' }}>Delete</Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsPage>
  );
}
