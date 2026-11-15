// New project (sub-project 6, look A): start from a blank project, a template
// or a copy of a project you can see; the form; and a live preview of the
// phases with the dates they will get (the server works the dates out).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import { useAuth } from '../context/AuthContext';
import CompanyPicker from '../components/companies/CompanyPicker';
import ContactPicker from '../components/portal/ContactPicker';
import { useCompanyOptions } from '../hooks/useCompanyOptions';
import TagInput from '../components/TagInput';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Notice from '../components/ui/Notice';
import { hoursInput, parseHours } from './projects/detail/budgetFormat';
import { localToday } from './projects/detail/taskFilters';
import { createBody, finishNote, previewSummary } from './projects/newProject';
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
    // CN: for the whole company or one of its departments; customer
    // contacts who follow it in the portal, and whether it shows there.
    forScope: 'company', contactIds: [], showInPortal: undefined,
  });
  const [contacts, setContacts] = useState([]);
  const [nextNumber, setNextNumber] = useState('');
  const companies = useCompanyOptions();
  const [finishTouched, setFinishTouched] = useState(false);
  const [budgetText, setBudgetText] = useState('');
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [tags, setTags] = useState([]);
  const [copyId, setCopyId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(null);
  const [projects, setProjects] = useState(null);
  const [copySearch, setCopySearch] = useState('');
  const [copyProject, setCopyProject] = useState(null); // the chosen one, kept even when a search drops it
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
    api.get('/project-templates').then(({ data }) => setTemplates(data.templates)).catch((err) => setError(`Couldn't load the templates: ${errMessage(err)}`));
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

  // The company: yours, or a customer's (whose contacts can follow it in the portal).
  const company = companies.find((c) => String(c.id) === String(form.companyId));
  const customer = Boolean(company && !company.isInternal);
  const forDepartment = forDepartments.find((d) => String(d.id) === String(form.forDepartmentId));

  // The number it will get (the next free one, taken when it's created).
  useEffect(() => {
    let live = true;
    const forDepartmentId = form.forScope === 'department' ? form.forDepartmentId : '';
    if (form.forScope === 'department' && !forDepartmentId) { setNextNumber(''); return undefined; }
    api.get('/projects/next-number', { params: { companyId: form.companyId || undefined, forDepartmentId: forDepartmentId || undefined } })
      .then(({ data }) => { if (live) setNextNumber(data.code || ''); })
      .catch(() => { if (live) setNextNumber(''); });
    return () => { live = false; };
  }, [form.companyId, form.forScope, form.forDepartmentId]);

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

  // Copy lists the projects the normal list lets you see, searched by name.
  useEffect(() => {
    if (origin !== 'copy') return undefined;
    const timer = setTimeout(() => {
      api.get('/projects', { params: { limit: 50, search: copySearch.trim() || undefined } })
        .then(({ data }) => setProjects(data.projects))
        .catch((err) => { setProjects([]); setError(errMessage(err)); });
    }, copySearch ? 250 : 0);
    return () => clearTimeout(timer);
  }, [origin, copySearch]);

  // The preview, a moment after the dates settle. Until you pick a finish date
  // it is the template's own length, and that fills the Finish date box.
  const finishBeforeStart = form.finishDate && form.startDate && form.finishDate < form.startDate;
  const askedFinish = finishTouched ? form.finishDate : ''; // the auto-filled finish is an answer, not a question
  useEffect(() => {
    const mine = seq.current + 1;
    seq.current = mine; // any older answer still on its way is now stale
    if (origin !== 'template' || !form.templateId || !form.startDate || (finishTouched && finishBeforeStart)) return undefined;
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
  }, [origin, form.templateId, form.startDate, askedFinish, finishTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseOrigin = (next, extra = {}) => {
    seq.current += 1;
    setOrigin(next);
    setCopyId('');
    setCopyProject(null);
    setCopySearch('');
    setFinishTouched(false);
    setBudgetTouched(false);
    setPlan(null);
    setPreviewError('');
    setError('');
    setForm((f) => ({ ...f, finishDate: '', templateId: '', ...extra }));
    setTags([]); // a template's effect fills its own tags back in on success
  };

  const shownBudget = budgetTouched ? budgetText : (origin === 'template' && template ? hoursInput(template.hourBudgetMinutes) : '');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.ownerDepartmentId) { setError('Done by is required'); return; }
    if (form.forScope === 'department' && !form.forDepartmentId) { setError('Pick the department it is for'); return; }
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
        form: {
          ...form,
          contactIds: customer ? contacts.map((c) => c.id) : [],
          showInPortal: customer ? form.showInPortal !== false : false,
        },
        tags,
        origin,
        copyId,
        budget,
        memberIds: [],
      }));
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const summary = plan ? previewSummary(plan) : null;
  const copySource = copyProject;

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
              <div className="flex flex-col gap-2">
                <input className="input" type="search" aria-label="Search projects" placeholder="Search projects by name" value={copySearch} onChange={(e) => setCopySearch(e.target.value)} />
                <select className="input" aria-label="Project to copy" value={copyId} onChange={(e) => {
                  const chosen = (projects || []).find((p) => String(p.id) === e.target.value) || null;
                  setCopyId(e.target.value);
                  setCopyProject(chosen);
                  setTags(chosen?.tags || []); // the copy's tags, shown and editable like a template's
                }}>
                  <option value="">{projects ? 'Choose a project' : 'Loading…'}</option>
                  {copyProject && !(projects || []).some((p) => p.id === copyProject.id) && <option value={copyProject.id}>{copyProject.projectCode} {copyProject.name}</option>}
                  {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.projectCode} {p.name}</option>)}
                </select>
              </div>
            </Field>
          )}
          <Field label="Project name"><input className="input" required maxLength={255} value={form.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CompanyPicker
              label="Company"
              value={form.companyId}
              onChange={(v) => { patch({ companyId: v, forDepartmentId: '', forScope: 'company', showInPortal: undefined }); setContacts([]); }}
            />
            <Field label="Lead">
              <select className="input" value={form.assignedToUserId} onChange={(e) => patch({ assignedToUserId: e.target.value })}>
                <option value="">Unassigned</option>
                {leads.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-navy-500" id="for-label">For</span>
            <div role="radiogroup" aria-labelledby="for-label" className="flex flex-wrap gap-2.5">
              {[['company', 'The whole company', company ? company.name : 'Its company'], ['department', 'One department', forDepartment ? `${forDepartment.name}${forDepartment.shortCode ? ` (${forDepartment.shortCode})` : ''}` : 'Pick it below']].map(([value, title, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.forScope === value}
                  onClick={() => patch({ forScope: value })}
                  className="min-w-[200px] flex-1 rounded-lg border px-3 py-2.5 text-left"
                  style={form.forScope === value
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'var(--color-accent-soft)' }
                    : { borderColor: 'var(--color-border)' }}
                >
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-[12.5px] text-navy-400">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {form.forScope === 'department' && (
              <Field label="Department">
                <select className="input" aria-label="Department it is for" value={form.forDepartmentId} onChange={(e) => patch({ forDepartmentId: e.target.value })}>
                  <option value="">Select department…</option>
                  {forDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.shortCode ? ` (${d.shortCode})` : ''}</option>)}
                </select>
              </Field>
            )}
            <Field label="Done by (your department)" hint="Which of your teams does the work.">
              <select className="input" required aria-label="Done by" value={form.ownerDepartmentId} onChange={(e) => patch({ ownerDepartmentId: e.target.value })}>
                <option value="">Select department…</option>
                {owners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          {nextNumber && (
            <Notice tone="info">Its number will be <b className="num">{nextNumber}</b>.</Notice>
          )}
          {customer && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-navy-500">Customer contacts</span>
                <div className="flex flex-wrap items-center gap-2">
                  {contacts.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                      {c.displayName}
                      <button type="button" aria-label={`Remove ${c.displayName}`} className="text-navy-400 hover:underline" onClick={() => setContacts((list) => list.filter((x) => x.id !== c.id))}>×</button>
                    </span>
                  ))}
                  <ContactPicker
                    companyId={form.companyId}
                    exclude={contacts.map((c) => c.id)}
                    label="Add a customer contact"
                    onPick={(c) => setContacts((list) => [...list, c])}
                  />
                </div>
                <p className="text-[12.5px] text-navy-400">They see this project in {company.name}&apos;s portal, as do its company admins{form.forScope === 'department' && forDepartment ? ` and ${forDepartment.name}'s admins` : ''}.</p>
              </div>
              <label className="flex items-start gap-2.5 pt-6 text-sm">
                <input type="checkbox" checked={form.showInPortal !== false} onChange={(e) => patch({ showInPortal: e.target.checked })} />
                <span>
                  <span className="font-medium">Show in the portal</span>
                  <span className="block text-[12.5px] text-navy-400">Status, progress, phases and milestones only.</span>
                </span>
              </label>
            </div>
          )}
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
        <PlanPreview origin={origin} template={template} summary={summary} error={previewError} finishBeforeStart={finishBeforeStart} note={finishNote(plan, finishTouched ? form.finishDate : '')} copyName={copySource?.name} />
      </div>
    </div>
  );
}
