// Paste to build (PB2): paste a document, see what PRISM made of it, then
// create the checklist. Nothing is saved until Create checklist.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMessage } from '../../../api/api';
import Breadcrumbs from '../../../components/ui/Breadcrumbs';
import Button from '../../../components/ui/Button';
import { parseChecklist, describeSummary } from './parseChecklist';
import { describeOnlyFor, readConditions, bodyToText } from './editorModel';

const lineText = (item) => (item.kind === 'field' || item.kind === 'secure' ? item.label : (bodyToText(item.body) || '').replace(/\*\*/g, ''));
const word = (item) => {
  if (item.kind === 'secure') return 'Password / code (hidden)';
  if (item.kind === 'text') return 'Note';
  if (item.kind === 'field') return item.fieldType === 'yesno' ? 'Ask' : 'Write down';
  if (item.kind === 'action') return null;
  return null;
};

export default function PasteBuild({ meta, finish, lookups }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseChecklist(text, {
    name: meta.name, usage: meta.usage, finish, mdms: lookups.mdms, categories: lookups.categories,
  }) : null), [text, meta, finish, lookups]);

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/forms', { name: meta.name, usage: meta.usage, definition: parsed.definition });
      navigate(`/settings/checklists/${data.form.id}`, { replace: true });
    } catch (err) {
      setError(errMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <Breadcrumbs className="mb-1" items={[{ label: 'Settings', to: '/settings' }, { label: 'Checklists', to: '/settings/checklists' }, { label: 'New', current: true }]} />
        <h1 className="page-title">{meta.name}</h1>
        <p className="mt-1 text-sm text-navy-500">Paste your document. Each line becomes a step; you can change anything on the next page.</p>
      </header>
      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-navy-600">
          Your document
          <textarea className="min-h-[360px] w-full rounded-md border border-navy-200 bg-surface p-3 font-mono text-[13px] leading-relaxed text-navy-800 lg:min-h-[520px]"
            value={text} onChange={(e) => setText(e.target.value)} placeholder={'Before you start\nYou have the device and its charger.\nSerial number:\nIf Jamf Pro: Wipe Computer.'} />
        </label>
        <div className="min-w-0">
          <div className="mb-1 text-sm font-medium text-navy-600">What PRISM made of it</div>
          {!parsed && <div className="card p-4 text-sm text-navy-400">Paste on the left to see the checklist here.</div>}
          {parsed && (
            <div className="card overflow-hidden">
              <div className="border-b border-navy-100 bg-navy-50 px-4 py-3 text-sm" role="status">
                <b>{describeSummary(parsed.summary)}.</b>
                {parsed.summary.onlyFor > 0 && <> {parsed.summary.onlyFor} {parsed.summary.onlyFor === 1 ? 'line is' : 'lines are'} set to <b>Only for</b> an MDM or device type. Check them on the next page.</>}
              </div>
              <div className="max-h-[520px] overflow-y-auto px-4 py-3">
                {parsed.definition.sections.map((s) => (
                  <div key={s.key} className="mb-3">
                    <div className="text-sm font-semibold text-navy-900">{s.title}</div>
                    {s.items.map((item) => {
                      const only = readConditions(item.showWhen).onlyFor;
                      if (item.kind === 'action') {
                        return <div key={item.key} className="mt-1 text-sm font-semibold text-navy-600">Last step: {item.action === 'check_in' ? 'check the device in' : 'check the device out'}</div>;
                      }
                      return (
                        <div key={item.key} className={`mt-1 flex flex-wrap items-baseline gap-x-2 text-sm ${item.kind === 'text' ? 'text-navy-500' : 'text-navy-800'}`}>
                          {word(item) && <span className="text-xs font-semibold uppercase tracking-wide text-navy-400">{word(item)}</span>}
                          <span className={item.kind === 'field' || item.kind === 'secure' ? 'font-semibold' : ''}>{lineText(item)}</span>
                          {!item.required && item.kind !== 'text' && <span className="text-xs text-navy-400">optional</span>}
                          {only && <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700">{describeOnlyFor(only, lookups).replace('Shows for', 'Only for')}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" onClick={() => navigate('/settings/checklists')}>Back</Button>
        <Button variant="primary" onClick={create} disabled={!parsed || saving}>{saving ? 'Creating…' : 'Create checklist'}</Button>
      </div>
    </div>
  );
}
