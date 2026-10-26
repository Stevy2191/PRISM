// New project (sub-project 6, look A): start from a blank project, a template
// or a copy of a project you can see; the form; and a live preview of the
// phases with the dates they will get (the server works the dates out).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import CompanyPicker from '../components/companies/CompanyPicker';
import TagInput from '../components/TagInput';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Notice from '../components/ui/Notice';
import { hoursInput, parseHours } from './projects/detail/budgetFormat';
import { localToday } from './projects/detail/taskFilters';
import { createBody, previewSummary } from './projects/newProject';
import StartFromCards from './projects/new/StartFromCards';
import PlanPreview from './projects/new/PlanPreview';

const FromTemplate = () => (
  <span className="ml-auto rounded-full px-2 text-xs font-semibold" style={{ color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)' }}>from template</span>
);

// Field, for controls wrapped in a box (so the label points at the input by id).
function Boxed({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-navy-500">{label}</label>
      {children}
      {hint && <p className="text-[12.5px] text-navy-400">{hint}</p>}
    </div>
  );
}

export default function ProjectNew() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get('template') ? 'template' : 'blank');
  const [form, setForm] = useState({
    name: '', ownerDepartmentId: '', forDepartmentId: '', companyId: '', assignedToUserId: '', startDate: localToday(), finishDate: '', templateId: params.get('template') || '',
  });
  const [finishTouched, setFinishTouched] = useState(false);
  const [budgetText, setBudgetText] = useState('');
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [tags, setTags] = useState([]);
  const [copyId, setCopyId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(null);
  const [projects, setProjects] = useState(null);
  const [owners, setOwners] = useState([]);
  const [leads, setLeads] = useState([]);
  // "For department" belongs to the project's company; "Owned by" is always one of ours.
  const [forDepartments, setForDepartments] = useState([]);
  const [plan, setPlan] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    api.get('/project-templates').then(({ data }) => setTemplates(data.templates)).catch(() => {});
    api.get('/users/assignable').then(({ data }) => setLeads(data.users)).catch(() => {});
    api.get('/departments/owners').then(({ data }) => {
      setOwners(data.departments);
      const mine = data.departments.find((d) => String(d.id) === String(user?.departmentId));
      const pick = mine || (data.departments.length === 1 ? data.departments[0] : null);
      if (pick) setForm((f) => (f.ownerDepartmentId ? f : { ...f, ownerDepartmentId: String(pick.id) }));
    }).catch(() => {});
  }, [user?.departmentId]);

  useEffect(() => {
    api.get('/departments', { params: form.companyId ? { companyId: form.companyId } : {} })
      .then(({ data }) => setForDepartments(data.departments)).catch(() => {});
  }, [form.companyId]);

  // Picking a template brings its tags and hour budget along.
  useEffect(() => {
    if (origin !== 'template' || !form.templateId) { setTemplate(null); setPlan(null); return; }
    let live = true;
    api.get(`/project-templates/${form.templateId}`).then(({ data }) => {
      if (!live) return;
      setTemplate(data.template);
      setTags(data.template.tags || []);
      setBudgetTouched(false);
    }).catch((err) => { if (live) setError(errMessage(err)); });
    return () => { live = false; };
  }, [origin, form.templateId]);

  // Copy lists the projects the normal list lets you see.
  useEffect(() => {
    if (origin !== 'copy' || projects) return;
    api.get('/projects', { params: { limit: 200 } }).then(({ data }) => setProjects(data.projects)).catch((err) => { setProjects([]); setError(errMessage(err)); });
  }, [origin, projects]);

  // The preview, a moment after the dates settle. Until you pick a finish date
  // it is the template's own length, and that fills the Finish date box.
  const finishBeforeStart = form.finishDate && form.startDate && form.finishDate < form.startDate;
  useEffect(() => {
    if (origin !== 'template' || !form.templateId || !form.startDate || (finishTouched && finishBeforeStart)) return undefined;
    const mine = seq.current + 1;
    seq.current = mine;
    const timer = setTimeout(() => {
      const query = { startDate: form.startDate };
      if (finishTouched && form.finishDate) query.finishDate = form.finishDate;
      api.get(`/project-templates/${form.templateId}/preview`, { params: query }).then(({ data }) => {
        if (seq.current !== mine) return;
        setPlan(data);
        setPreviewError('');
        if (!finishTouched) patch({ finishDate: data.finishDate || '' });
      }).catch((err) => { if (seq.current === mine) setPreviewError(errMessage(err)); });
    }, 300);
    return () => clearTimeout(timer);
  }, [origin, form.templateId, form.startDate, form.finishDate, finishTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseOrigin = (next, extra = {}) => {
    setOrigin(next);
    setFinishTouched(false);
    setBudgetTouched(false);
    setPlan(null);
    setPreviewError('');
    setError('');
    setForm((f) => ({ ...f, finishDate: '', templateId: '', ...extra }));
    if (next !== 'template') setTags([]);
  };

  const shownBudget = budgetTouched ? budgetText : (origin === 'template' && template ? hoursInput(template.hourBudgetMinutes) : '');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.ownerDepartmentId) { setError('Owned by department is required'); return; }
    if (origin === 'template' && !form.templateId) { setError('Pick a template, or start from a blank project'); return; }
    if (origin === 'copy' && !copyId) { setError('Pick the project to copy'); return; }
    if (origin !== 'blank' && !form.startDate) { setError('A start date is required'); return; }
    if (finishBeforeStart) { setError("Finish date can't be before the start date"); return; }
    let budget;
    if (budgetTouched) {
      budget = parseHours(budgetText);
      if (Number.isNaN(budget)) { setError('Hour budget must be a number of hours, like 80 or 7.5'); return; }
    }
    setSaving(true);
    try {
      const { data } = await api.post('/projects', createBody({
        form, tags, origin, copyId, budget, memberIds: [],
      }));
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const summary = plan ? previewSummary(plan) : null;
  const ownerDepartment = owners.find((d) => String(d.id) === String(form.ownerDepartmentId));
  const copySource = (projects || []).find((p) => String(p.id) === String(copyId));

  return (
    <div className="mx-auto max-w-[1280px]">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] text-navy-400">
        <Link to="/projects" className="hover:underline" style={{ color: 'var(--color-accent)' }}>Projects</Link>
        <span>/</span>
        <span>New project</span>
      </nav>
      <h1 className="page-title mt-2 max-md:text-2xl">New project</h1>
      <div className="mt-5 flex flex-wrap items-start gap-6">
        <form onSubmit={submit} aria-label="New project" className="card flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-6">
          {error && <Notice tone="bad">{error}</Notice>}
          <StartFromCards
            origin={origin}
            templates={templates}
            templateId={form.templateId}
            onBlank={() => chooseOrigin('blank')}
            onTemplate={(id) => chooseOrigin('template', { templateId: String(id) })}
            onCopy={() => chooseOrigin('copy')}
          />
          {origin === 'copy' && (
            <Field label="Project to copy" hint="Phases, tasks and links come across; people, time and files do not.">
              <select className="input" value={copyId} onChange={(e) => setCopyId(e.target.value)}>
                <option value="">{projects ? 'Choose a project' : 'Loading…'}</option>
                {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.projectCode} {p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Project name"><input className="input" required maxLength={255} value={form.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CompanyPicker label="Client company" value={form.companyId} onChange={(v) => patch({ companyId: v, forDepartmentId: '' })} />
            <Field label="Lead">
              <select className="input" value={form.assignedToUserId} onChange={(e) => patch({ assignedToUserId: e.target.value })}>
                <option value="">Unassigned</option>
                {leads.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </Field>
            <Field label="Owned by department" hint={ownerDepartment && !ownerDepartment.shortCode ? 'No short code set for this department, so the project ID starts with DEPT.' : 'Which team does the work.'}>
              <select className="input" required value={form.ownerDepartmentId} onChange={(e) => patch({ ownerDepartmentId: e.target.value })}>
                <option value="">Select department…</option>
                {owners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="For department" hint="Which department benefits.">
              <select className="input" value={form.forDepartmentId} onChange={(e) => patch({ forDepartmentId: e.target.value })}>
                <option value="">Same as owned by</option>
                {forDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start date"><input type="date" className="input num" value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} /></Field>
            <Boxed
              id="finish-date"
              label="Finish date"
              hint={origin === 'template' ? 'Worked out from the template. Change it and every date stretches to fit.' : (origin === 'copy' ? 'Change it and every date stretches to fit.' : 'Optional.')}
            >
              <div className="relative">
                <input
                  id="finish-date"
                  type="date"
                  className="input num"
                  value={form.finishDate}
                  onChange={(e) => { setFinishTouched(Boolean(e.target.value)); patch({ finishDate: e.target.value }); }}
                />
                {origin === 'template' && !finishTouched && form.finishDate && <span className="pointer-events-none absolute right-10 top-1/2 flex -translate-y-1/2"><FromTemplate /></span>}
              </div>
            </Boxed>
            <Boxed id="hour-budget" label="Hour budget" hint="Leave empty for no budget.">
              <div className="relative">
                <input
                  id="hour-budget"
                  className="input num"
                  inputMode="decimal"
                  placeholder="e.g. 120"
                  value={shownBudget}
                  onChange={(e) => { setBudgetTouched(true); setBudgetText(e.target.value); }}
                />
                {origin === 'template' && !budgetTouched && shownBudget && <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2"><FromTemplate /></span>}
              </div>
            </Boxed>
            <Field label="Tags"><TagInput tags={tags} onChange={setTags} /></Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-navy-100 pt-4">
            <Button onClick={() => navigate('/projects')}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</Button>
          </div>
        </form>
        <PlanPreview origin={origin} template={template} summary={summary} error={previewError} finishBeforeStart={finishBeforeStart} copyName={copySource?.name} />
      </div>
    </div>
  );
}
