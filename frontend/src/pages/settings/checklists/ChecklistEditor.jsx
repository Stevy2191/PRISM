// Settings › Checklists › a checklist (PB2). The editor is the checklist
// itself: sections and lines typed in place, each line with a small toolbar.
// It stores what the server already understands (see editorModel); every
// save is a new version, and tickets keep the version they started on.
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Spinner from '../../../components/Spinner';
import Modal from '../../../components/Modal';
import RichTextEditor from '../../../components/RichTextEditor';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import Button from '../../../components/ui/Button';
import ConditionEditor from './ConditionEditor';
import { conditionFieldsFor, newKey } from '../playbooks/conditions';
import ChecklistLine from './ChecklistLine';
import OnlyForPicker from './OnlyForPicker';
import TryIt from './TryIt';
import PasteBuild from './PasteBuild';
import {
  toEditor, fromEditor, setFinish, finishChoice, indentLine, outdentLine, flipBranch, setOnlyFor, setAdvanced,
  updateItem, insertLine, removeLine, moveLine, questionAbove, turnInto, describeOnlyFor,
} from './editorModel';

const STATUSES = [['ready_to_issue', 'Ready to issue'], ['in_repair', 'In repair'], ['on_hold', 'On hold'], ['retired', 'Retired']];
const FINISH = {
  nothing: 'nothing else', check_out: 'checks the device out', check_in: 'checks the device in',
};
const newStep = () => ({ key: newKey('i'), kind: 'step', body: '<p></p>', required: true });

export function useChecklistLookups() {
  const [lookups, setLookups] = useState({
    mdms: [], categories: [], companies: [], departments: [], loaded: false,
  });
  useEffect(() => {
    Promise.all([
      api.get('/mdms').then(({ data }) => data.mdms || []).catch(() => []),
      api.get('/assets/categories').then(({ data }) => data.categories || []).catch(() => []),
      api.get('/companies', { params: { limit: 200 } }).then(({ data }) => data.companies || []).catch(() => []),
      api.get('/departments').then(({ data }) => data.departments || []).catch(() => []),
    ]).then(([mdms, categories, companies, departments]) => setLookups({
      mdms, categories, companies, departments, loaded: true,
    }));
  }, []);
  return lookups;
}

// Empty lines are dropped on save: the server needs words on every line.
function withoutEmptyLines(model) {
  const empty = (l) => {
    const it = l.item;
    if (it.kind === 'field' || it.kind === 'secure') return !String(it.label || '').trim();
    return !String(it.body || '').replace(/<[^>]+>/g, '').trim();
  };
  return { ...model, sections: model.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => !empty(l)) })) };
}

export default function ChecklistEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { state } = useLocation();
  const lookups = useChecklistLookups();
  const [meta, setMeta] = useState(null); // { name, description, usage, version, inUse }
  const [model, setModel] = useState(null);
  const [changed, setChanged] = useState(false);
  const [selected, setSelected] = useState(null); // { s, i }
  const [focusKey, setFocusKey] = useState(null);
  const [picker, setPicker] = useState(null); // { s, i } (i null: the section)
  const [advanced, setAdvancedAt] = useState(null);
  const [rich, setRich] = useState(null); // { s, i, body }
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [hidden, setHidden] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const refs = useRef(new Map());

  useEffect(() => {
    if (isNew) {
      if (!state || !state.name) { navigate('/settings/checklists', { replace: true }); return; }
      setMeta({ name: state.name, description: '', usage: state.usage, version: null, inUse: 0 });
      if (state.start !== 'paste') {
        const blank = setFinish(toEditor({ sections: [{ key: newKey('s'), title: 'Steps', items: [newStep()] }] }), state.finish || 'nothing');
        setModel(blank);
      }
      return;
    }
    api.get(`/forms/${id}`).then(({ data }) => {
      setMeta({
        name: data.form.name, description: data.form.description || '', usage: data.form.usage, version: data.form.version, inUse: data.form.inUse,
      });
      setModel(toEditor(data.form.definition));
      setChanged(false);
    }).catch((err) => setError(errMessage(err)));
  }, [id, isNew, state, navigate]);

  useEffect(() => {
    if (!focusKey) return;
    const el = refs.current.get(focusKey);
    if (el) { el.focus(); setFocusKey(null); }
  });

  const edit = useCallback((fn) => { setModel((m) => fn(m)); setChanged(true); setHidden(null); }, []);
  const definition = useCallback(() => fromEditor(withoutEmptyLines(model)), [model]);

  const conditionOptions = useMemo(() => {
    if (!model || !advanced) return { fields: [] };
    const at = { s: advanced.s, i: advanced.i };
    return { fields: conditionFieldsFor({ sections: fromEditor(model).sections, at, usage: meta.usage, lookups }) };
  }, [model, advanced, meta, lookups]);

  if (isNew && state && state.start === 'paste' && !model && meta) {
    return <PasteBuild meta={meta} finish={state.finish || 'nothing'} lookups={lookups} />;
  }
  if (!model || !meta) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const save = async () => {
    setSaving(true);
    setError('');
    const body = { name: meta.name, description: meta.description || null, definition: definition() };
    try {
      if (isNew) {
        const { data } = await api.post('/forms', { ...body, usage: meta.usage });
        navigate(`/settings/checklists/${data.form.id}`, { replace: true });
      } else {
        const { data } = await api.put(`/forms/${id}`, body);
        setMeta((m) => ({ ...m, version: data.form.version, name: data.form.name }));
        setModel(toEditor(data.form.definition));
        setChanged(false);
        setSavedAt(new Date());
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const lineKeys = (s, i) => model.sections[s].lines[i]?.item.key;
  const onKeyDown = (s, i) => (e) => {
    const line = model.sections[s].lines[i];
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      const item = newStep();
      edit((m) => insertLine(m, s, i + 1, item));
      setSelected({ s, i: i + 1 });
      setFocusKey(item.key);
    } else if (e.key === 'Tab' && !e.altKey) {
      // Only taken over when it does something, so Tab still moves focus.
      const can = e.shiftKey ? !!line.indent && !line.advanced : !line.indent && !line.advanced && !!questionAbove(model, s, i) && !(line.item.kind === 'field' && line.item.fieldType === 'yesno');
      if (!can) return;
      e.preventDefault();
      edit((m) => (e.shiftKey ? outdentLine(m, s, i) : indentLine(m, s, i)));
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const by = e.key === 'ArrowUp' ? -1 : 1;
      if (i + by < 0 || i + by >= model.sections[s].lines.length) return;
      edit((m) => moveLine(m, s, i, by));
      setSelected({ s, i: i + by });
      setFocusKey(line.item.key);
    } else if (e.key === 'Backspace' && e.target.tagName === 'TEXTAREA' && e.target.value === '' && model.sections[s].lines.length > 1) {
      e.preventDefault();
      const prev = lineKeys(s, i - 1) || lineKeys(s, i + 1);
      edit((m) => removeLine(m, s, i));
      setSelected(null);
      setFocusKey(prev);
    }
  };

  const toolbarFor = (s, i) => {
    const line = model.sections[s].lines[i];
    return {
      onRequired: () => edit((m) => updateItem(m, s, i, { required: !line.item.required })),
      onOnlyFor: () => setPicker({ s, i }),
      onTurnInto: (t) => edit((m) => updateItem(m, s, i, turnInto(line.item, t.kind, { fieldType: t.fieldType }))),
      onIndent: () => edit((m) => indentLine(m, s, i)),
      onOutdent: () => edit((m) => outdentLine(m, s, i)),
      onUp: () => { if (i > 0) { edit((m) => moveLine(m, s, i, -1)); setSelected({ s, i: i - 1 }); } },
      onDown: () => { if (i < model.sections[s].lines.length - 1) { edit((m) => moveLine(m, s, i, 1)); setSelected({ s, i: i + 1 }); } },
      onDelete: () => { edit((m) => removeLine(m, s, i)); setSelected(null); },
    };
  };

  const addSection = () => {
    const item = newStep();
    edit((m) => ({
      ...m,
      sections: [...m.sections, {
        key: newKey('s'), title: `Step ${m.sections.length + 1}`, onlyFor: null, advanced: false, conditions: undefined, dirty: false,
        lines: [{ item, onlyFor: null, indent: null, advanced: false, conditions: undefined, dirty: false }],
      }],
    }));
    setFocusKey(item.key);
  };
  const removeSection = (s) => edit((m) => ({ ...m, sections: m.sections.filter((_, j) => j !== s) }));
  const setTitle = (s, title) => edit((m) => ({ ...m, sections: m.sections.map((x, j) => (j === s ? { ...x, title } : x)) }));
  const addLineAt = (s) => {
    const item = newStep();
    edit((m) => insertLine(m, s, m.sections[s].lines.length, item));
    setSelected({ s, i: model.sections[s].lines.length });
    setFocusKey(item.key);
  };

  const sectionThing = picker && picker.i === null;
  const pickerValue = picker ? (sectionThing ? model.sections[picker.s].onlyFor : model.sections[picker.s].lines[picker.i]?.onlyFor) : null;
  const advancedConditions = advanced ? (advanced.i === null ? model.sections[advanced.s].conditions : model.sections[advanced.s].lines[advanced.i]?.conditions) || [] : [];
  const choice = finishChoice(model);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs className="mb-1" items={[{ label: 'Settings', to: '/settings' }, { label: 'Checklists', to: '/settings/checklists' }, { label: isNew ? 'New' : meta.name, current: true }]} />
          <input className="page-title w-full rounded border-0 bg-transparent px-0 focus:outline-none focus:ring-1 focus:ring-navy-200" aria-label="Checklist name"
            value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setChanged(true); }} />
          <p className="mt-1 text-sm text-navy-500">
            {meta.usage === 'device' ? 'For each device' : 'For the ticket'}
            {meta.usage === 'device' && (
              <>
                {' · when finished, '}
                <label className="inline">
                  <span className="sr-only">When it's finished</span>
                  <select className="rounded border border-navy-200 bg-surface px-1 text-sm font-semibold text-navy-700" value={choice}
                    onChange={(e) => edit((m) => setFinish(m, e.target.value))}>
                    {Object.entries(FINISH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-navy-400">
            {changed ? 'Not saved yet' : savedAt ? 'Saved' : meta.version ? `Version ${meta.version}` : ''}
            {meta.inUse > 0 ? ' · tickets in progress keep their copy' : ''}
          </span>
          <Button variant="primary" onClick={save} disabled={saving || !meta.name.trim()}>{saving ? 'Saving…' : isNew ? 'Create checklist' : 'Save'}</Button>
        </div>
      </header>
      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="flex flex-wrap items-start gap-6">
        <div className="card min-w-0 flex-[999_1_520px] px-2 py-3 sm:px-3">
          {model.sections.map((section, s) => (
            <section key={section.key} className="mb-4" aria-label={section.title}>
              <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
                <input className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-1 text-[15px] font-semibold text-navy-900 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-navy-200"
                  aria-label="Section title" value={section.title} onChange={(e) => setTitle(s, e.target.value)} />
                {meta.usage === 'device' && !section.advanced && (
                  <button type="button" className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700" onClick={() => setPicker({ s, i: null })}
                    aria-label={`Only for, whole section: ${section.onlyFor ? describeOnlyFor(section.onlyFor, lookups) : 'every device'}`}>
                    {section.onlyFor ? describeOnlyFor(section.onlyFor, lookups) : 'Section: only for…'}
                  </button>
                )}
                {section.advanced && <button type="button" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" onClick={() => setAdvancedAt({ s, i: null })}>Advanced rules</button>}
                <Button size="sm" variant="quiet" aria-label={`Delete section ${section.title}`} onClick={() => removeSection(s)}><IconTrash size={14} /></Button>
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {section.lines.map((line, i) => {
                  const prev = section.lines[i - 1];
                  const groupStart = line.indent && (!prev || !prev.indent || prev.indent.question !== line.indent.question || prev.indent.value !== line.indent.value);
                  const isSel = selected && selected.s === s && selected.i === i;
                  return (
                    <div key={line.item.key} className={line.indent ? 'ml-6 border-l-2 border-navy-100 pl-2' : ''}>
                      {groupStart && (
                        <button type="button" className="px-2 pt-1 text-xs font-semibold text-navy-400 hover:text-navy-600" title="Switch between the yes and no answers"
                          onClick={() => edit((m) => flipBranch(m, s, i))}>
                          {line.indent.value ? 'If yes:' : 'If no:'}
                        </button>
                      )}
                      <ChecklistLine
                        line={line}
                        usage={meta.usage}
                        lookups={lookups}
                        selected={isSel}
                        hidden={hidden ? hidden.has(line.item.key) : false}
                        canIndent={!!questionAbove(model, s, i) && !(line.item.kind === 'field' && line.item.fieldType === 'yesno')}
                        inputRef={(el) => { if (el) refs.current.set(line.item.key, el); else refs.current.delete(line.item.key); }}
                        onFocus={() => setSelected({ s, i })}
                        onChange={(patch) => edit((m) => updateItem(m, s, i, patch))}
                        onKeyDown={onKeyDown(s, i)}
                        onRich={() => setRich({ s, i, body: line.item.body })}
                        onOnlyFor={() => setPicker({ s, i })}
                        onAdvanced={() => setAdvancedAt({ s, i })}
                        toolbar={toolbarFor(s, i)}
                      />
                    </div>
                  );
                })}
              </div>
              <button type="button" className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-navy-400 hover:bg-navy-50" onClick={() => addLineAt(s)}>
                <IconPlus size={14} className="mr-1 inline" aria-hidden="true" />
                Add a step. Enter for the next line, Tab to put it under a question.
              </button>
            </section>
          ))}

          {model.finish && (
            <div className="mx-2 mt-2 flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-prism-accent/60 bg-navy-50 px-3 py-3">
              <IconLock size={18} className="text-navy-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <b className="text-sm">{model.finish.action === 'check_in' ? 'Check the device in' : 'Check the device out'}</b>
                <div className="text-xs text-navy-500">
                  Always the last step.
                  {model.finish.action === 'check_in'
                    ? ` ${model.finish.statuses.map((st) => STATUSES.find(([k]) => k === st)?.[1]).join(' · ')}`
                    : ' To the person the checklist is for.'}
                </div>
                {statusesOpen && model.finish.action === 'check_in' && (
                  <fieldset className="mt-2 flex flex-wrap gap-3">
                    <legend className="sr-only">Statuses the device can be checked in to</legend>
                    {STATUSES.map(([k, label]) => (
                      <label key={k} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={model.finish.statuses.includes(k)}
                          onChange={() => edit((m) => {
                            const has = m.finish.statuses.includes(k);
                            const next = has ? m.finish.statuses.filter((x) => x !== k) : STATUSES.map(([x]) => x).filter((x) => x === k || m.finish.statuses.includes(x));
                            return next.length ? { ...m, finish: { ...m.finish, statuses: next } } : m;
                          })} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
              {model.finish.action === 'check_in' && <Button size="sm" variant="quiet" onClick={() => setStatusesOpen((o) => !o)}>Statuses</Button>}
            </div>
          )}
          <Button size="sm" variant="quiet" className="ml-2 mt-3" style={{ color: 'var(--color-accent)' }} onClick={addSection}><IconPlus size={14} />Add section</Button>
        </div>

        <aside className="flex max-w-full flex-[1_1_260px] flex-col gap-3 sm:max-w-[320px]">
          <div className="card p-4">
            <h3 className="text-sm font-semibold">How to build it</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-navy-600">
              <li>Type a line: it's a step to tick.</li>
              <li><b>Turn into</b> a question (yes/no or pick one), something to write down, or a hidden password/code.</li>
              {meta.usage === 'device' && <li><b>Only for</b> hides a line, or a whole section, unless the device is on that MDM or of that type.</li>}
              <li>Under a yes/no question, indent lines (Tab) to show them only for that answer.</li>
            </ul>
          </div>
          <TryIt usage={meta.usage} definition={definition} lookups={lookups} onResult={setHidden} />
          <button type="button" className="self-start text-left text-xs text-navy-400 underline hover:text-navy-600 disabled:no-underline disabled:opacity-50"
            disabled={!selected} onClick={() => setAdvancedAt(selected)}>
            {selected ? 'Advanced: rules on answers and the person, for the selected line…' : 'Advanced rules: select a line first'}
          </button>
        </aside>
      </div>

      {picker && (
        <OnlyForPicker
          value={pickerValue}
          lookups={lookups}
          what={sectionThing ? 'section' : 'step'}
          onClose={() => setPicker(null)}
          onDone={(value) => { edit((m) => setOnlyFor(m, picker.s, picker.i, value)); setPicker(null); }}
        />
      )}
      {advanced && (
        <Modal title="Advanced rules" onClose={() => setAdvancedAt(null)}>
          <p className="mb-3 text-sm text-navy-500">Show this only when all of these match. Remove them all to use Only for and indenting again.</p>
          <ConditionEditor conditions={advancedConditions} options={conditionOptions}
            onChange={(conds) => edit((m) => setAdvanced(m, advanced.s, advanced.i, conds))} />
          <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => setAdvancedAt(null)}>Done</Button></div>
        </Modal>
      )}
      {rich && (
        <Modal title="Edit text" onClose={() => setRich(null)}>
          <RichTextEditor value={rich.body} onChange={(body) => setRich((r) => ({ ...r, body }))} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="quiet" onClick={() => setRich(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { edit((m) => updateItem(m, rich.s, rich.i, { body: rich.body })); setRich(null); }}>Done</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
