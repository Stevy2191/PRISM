// Settings → Project templates → new/edit (sub-project 6). A grid of phases
// and tasks: "Starts on Day N" (Day 1 is the project's start date), "Takes N
// days", estimate and "Waits on", with drag to reorder. Assignees are not
// kept in templates. Saving replaces the whole template.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import TagInput from '../../components/TagInput';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import Notice from '../../components/ui/Notice';
import useUnsavedGuard from './templateEditor/useUnsavedGuard';
import { AddRow, GRID, PhaseRow, TaskRow } from './templateEditor/Row';
import {
  addPhase, addSubtask, addTask, addWait, emptyTemplate, fromServer, movePhase, moveTask, moveTaskToPhase, phaseSummary,
  removePhase, removeTask, removeWait, renamePhase, rowsFor, setMilestone, toPayload, updateTask,
} from './templateEditor/model';

const same = (a, b) => String(a) === String(b);

export default function ProjectTemplateEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [s, setS] = useState(emptyTemplate);
  const [meta, setMeta] = useState(null); // { usedCount }
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(emptyTemplate())); // what the server has
  const [justSaved, setJustSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [subFor, setSubFor] = useState(null); // task whose "add a subtask" box is open
  const dirty = !loading && !loadFailed && JSON.stringify(s) !== saved;
  useUnsavedGuard(dirty);
  const savedTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const [drag, setDrag] = useState(null); // { kind: 'task'|'phase', id }
  const [over, setOver] = useState(null);

  useEffect(() => {
    setLoadFailed(false);
    if (isNew) { setS(emptyTemplate()); setSaved(JSON.stringify(emptyTemplate())); setLoading(false); return; }
    setLoading(true);
    api.get(`/project-templates/${id}`)
      .then(({ data }) => { const loaded = fromServer(data.template); setS(loaded); setSaved(JSON.stringify(loaded)); setMeta({ usedCount: data.template.usedCount, sourceProjectId: data.template.sourceProjectId }); })
      .catch((err) => { setError(errMessage(err)); setLoadFailed(true); })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const edit = (fn) => setS((cur) => fn(cur));
  const rows = rowsFor(s);
  const topTasks = s.tasks.filter((t) => t.parentId == null);

  // Resolves true once saved, so "Start a project from this" can wait for it.
  const save = async () => {
    setError('');
    if (!s.name.trim()) { setError('Template name is required'); return false; }
    const { body, error: bad } = toPayload(s);
    if (bad) { setError(bad); return false; }
    setSaving(true);
    try {
      const { data } = isNew ? await api.post('/project-templates', body) : await api.put(`/project-templates/${id}`, body);
      const fresh = fromServer(data.template);
      setSaved(JSON.stringify(fresh));
      setS(fresh);
      setMeta({ usedCount: data.template.usedCount, sourceProjectId: data.template.sourceProjectId });
      setJustSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 3000);
      if (isNew) navigate(`/settings/project-templates/${data.template.id}`, { replace: true });
      return true;
    } catch (err) {
      setError(errMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startProject = async () => {
    if (dirty && !(window.confirm('Save your changes first? The new project is made from the saved template.') && await save())) return;
    navigate(`/projects/new?template=${id}`);
  };

  const remove = async () => {
    if (!confirm(`Delete "${s.name}"? Projects already made from it keep everything.`)) return;
    try { await api.delete(`/project-templates/${id}`); navigate('/settings/project-templates'); } catch (err) { setError(errMessage(err)); }
  };

  // Drag and drop (and the arrow keys on a grip) share these.
  const dropOnTask = (taskId) => () => {
    if (drag?.kind === 'task') edit((cur) => moveTask(cur, drag.id, taskId));
    setDrag(null); setOver(null);
  };
  const dropOnPhase = (phaseId) => () => {
    if (drag?.kind === 'task') edit((cur) => moveTaskToPhase(cur, drag.id, phaseId));
    if (drag?.kind === 'phase') edit((cur) => movePhase(cur, drag.id, phaseId));
    setDrag(null); setOver(null);
  };
  const dragFor = (kind, itemId, overKey) => ({
    id: String(itemId),
    start: () => setDrag({ kind, id: itemId }),
    end: () => { setDrag(null); setOver(null); },
    over: (e) => { if (drag) { e.preventDefault(); setOver(overKey); } },
  });
  const nudgeTask = (task, dir) => {
    const peers = task.parentId == null ? topTasks : s.tasks.filter((t) => t.parentId != null && same(t.parentId, task.parentId));
    const i = peers.findIndex((t) => same(t.id, task.id));
    if (dir < 0 && i > 0) edit((cur) => moveTask(cur, task.id, peers[i - 1].id));
    if (dir > 0 && i < peers.length - 1) edit((cur) => moveTask(cur, peers[i + 1].id, task.id));
  };
  const nudgePhase = (phase, dir) => {
    const i = s.phases.findIndex((p) => same(p.id, phase.id));
    if (dir < 0 && i > 0) edit((cur) => movePhase(cur, phase.id, s.phases[i - 1].id));
    if (dir > 0 && i < s.phases.length - 1) edit((cur) => movePhase(cur, s.phases[i + 1].id, phase.id));
  };

  if (loading) return <Spinner />;
  // A template that did not load must not be editable: saving would replace it.
  if (loadFailed) {
    return (
      <SettingsPage title="Project template" description="">
        <Notice tone="bad">{error}</Notice>
        <Link to="/settings/project-templates" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>Back to all templates</Link>
      </SettingsPage>
    );
  }
  const titleOf = (tid) => s.tasks.find((t) => same(t.id, tid))?.title || '';

  return (
    <SettingsPage
      title={isNew ? 'New project template' : (s.name || 'Project template')}
      description={isNew ? 'Phases and tasks to start new projects from.' : `Used for ${meta?.usedCount ?? 0} ${meta?.usedCount === 1 ? 'project' : 'projects'}`}
      actions={(
        <>
          <Link to="/settings/project-templates" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>All templates</Link>
          {!isNew && <Button onClick={startProject}>Start a project from this</Button>}
          {!isNew && <Button variant="quiet" onClick={remove} style={{ color: 'var(--color-danger)' }}>Delete</Button>}
          {justSaved && <span role="status" className="text-sm" style={{ color: 'var(--color-accent)' }}>Saved</span>}
          <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save template'}</Button>
        </>
      )}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Template name"><input className="input" aria-label="Template name" maxLength={150} value={s.name} onChange={(e) => edit((c) => ({ ...c, name: e.target.value }))} /></Field>
        <Field label="What it's for"><input className="input" aria-label="What it's for" value={s.description} onChange={(e) => edit((c) => ({ ...c, description: e.target.value }))} /></Field>
        <Field label="Hour budget" hint="Leave empty for none."><input className="input num" aria-label="Hour budget" inputMode="decimal" placeholder="e.g. 120" value={s.hours} onChange={(e) => edit((c) => ({ ...c, hours: e.target.value }))} /></Field>
        <Field label="Tags"><TagInput tags={s.tags} onChange={(tags) => edit((c) => ({ ...c, tags }))} /></Field>
      </div>

      <div className="card overflow-x-auto">
        <div className={`${GRID} h-[34px] border-b border-navy-100 text-[12.5px] font-medium text-navy-400`}>
          <span /><span>Phase or task</span><span>Starts on</span><span>Takes</span><span>Estimate</span><span>Waits on</span><span />
        </div>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-navy-400">No phases yet. Add one below, then add tasks to it.</p>}
        {rows.map((r) => {
          if (r.kind === 'phase') {
            const p = r.phase;
            return (
              <div key={`p${p.id}`}>
                <PhaseRow
                  phase={p}
                  summary={phaseSummary(s, p.id)}
                  over={over === `p${p.id}`}
                  drag={dragFor('phase', p.id, `p${p.id}`)}
                  onDropTask={dropOnPhase(p.id)}
                  onKeyMove={(dir) => nudgePhase(p, dir)}
                  onRename={(name) => edit((c) => renamePhase(c, p.id, name))}
                  onRemove={() => {
                    const n = s.tasks.filter((t) => t.parentId == null && same(t.phaseId, p.id)).length;
                    if (n && !confirm(`Remove ${p.name} and its ${n} ${n === 1 ? 'task' : 'tasks'}?`)) return;
                    edit((c) => removePhase(c, p.id));
                  }}
                />
                <PhaseTasks
                  s={s}
                  phase={p}
                  rows={rows}
                  render={(row) => (
                    <TaskLine key={`t${row.task.id}`} row={row} s={s} over={over} dragFor={dragFor} dropOnTask={dropOnTask} nudgeTask={nudgeTask} edit={edit} topTasks={topTasks} titleOf={titleOf} subFor={subFor} setSubFor={setSubFor} />
                  )}
                />
                <AddRow label={`Add a task to ${p.name}`} placeholder={`Add a task to ${p.name}, press Enter`} onAdd={(title) => edit((c) => addTask(c, p.id, title))} />
              </div>
            );
          }
          return null;
        })}
        <LooseTasks rows={rows} s={s} over={over} dragFor={dragFor} dropOnTask={dropOnTask} nudgeTask={nudgeTask} edit={edit} topTasks={topTasks} titleOf={titleOf} subFor={subFor} setSubFor={setSubFor} />
        <AddRow indent={false} label="Add a phase" placeholder="Add a phase, press Enter" onAdd={(name) => edit((c) => addPhase(c, name))} />
        <p className="px-4 py-3 text-xs text-navy-400">Day 1 is the project&apos;s start date. Assignees aren&apos;t kept in templates.</p>
      </div>
    </SettingsPage>
  );
}

// Rows between this phase heading and the next, from the flat display list.
function PhaseTasks({ rows, phase, render }) {
  const start = rows.findIndex((r) => r.kind === 'phase' && same(r.phase.id, phase.id));
  const out = [];
  for (let i = start + 1; i < rows.length && rows[i].kind === 'task'; i += 1) out.push(render(rows[i]));
  return out;
}

// Tasks above the first phase (a template saved without phases).
function LooseTasks({ rows, ...rest }) {
  const first = rows.findIndex((r) => r.kind === 'phase');
  const loose = (first < 0 ? rows : rows.slice(0, first)).filter((r) => r.kind === 'task');
  if (!loose.length) return null;
  return (
    <>
      {loose.map((row) => <TaskLine key={`t${row.task.id}`} row={row} {...rest} />)}
      <AddRow label="Add a task with no phase" placeholder="Add a task with no phase, press Enter" onAdd={(title) => rest.edit((c) => addTask(c, null, title))} />
    </>
  );
}

function TaskLine({
  row, s, over, dragFor, dropOnTask, nudgeTask, edit, topTasks, titleOf, subFor, setSubFor,
}) {
  const t = row.task;
  const preds = s.dependencies.filter((d) => same(d.successorId, t.id)).map((d) => ({ id: d.predecessorId, title: titleOf(d.predecessorId) }));
  const others = topTasks.filter((o) => !same(o.id, t.id) && !preds.some((p) => same(p.id, o.id)));
  return (
    <>
    <TaskRow
      task={t}
      sub={row.sub}
      hasSubtasks={s.tasks.some((x) => x.parentId != null && same(x.parentId, t.id))}
      others={others}
      predecessors={preds}
      over={over === `t${t.id}`}
      drag={dragFor('task', t.id, `t${t.id}`)}
      onDropTask={dropOnTask(t.id)}
      onKeyMove={(dir) => nudgeTask(t, dir)}
      onChange={(patch) => edit((c) => updateTask(c, t.id, patch))}
      onMilestone={() => edit((c) => setMilestone(c, t.id, !t.isMilestone))}
      onRemove={() => edit((c) => removeTask(c, t.id))}
      onAddWait={(pid) => edit((c) => addWait(c, t.id, topTasks.find((o) => same(o.id, pid)).id))}
      onRemoveWait={(pid) => edit((c) => removeWait(c, t.id, pid))}
      onAddSub={() => setSubFor(t.id)}
    />
    {subFor != null && same(subFor, t.id) && (
      <AddRow
        autoFocus
        label={`Name the subtask of ${t.title}`}
        placeholder={`Add a subtask to ${t.title}, press Enter`}
        onBlur={() => setSubFor(null)}
        onAdd={(title) => edit((c) => addSubtask(c, t.id, title))}
      />
    )}
    </>
  );
}
