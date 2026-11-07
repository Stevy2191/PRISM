// One line of a checklist (PB2): typed into directly. Enter adds the next
// line, Tab puts it under the question above, Shift+Tab takes it out,
// Alt+↑/↓ moves it, Backspace on an empty line removes it.
import { IconSquare, IconHelpCircle, IconPencil, IconLock, IconInfoCircle, IconCpu, IconListCheck } from '@tabler/icons-react';
import LineToolbar from './LineToolbar';
import { bodyToText, textToBody, describeOnlyFor } from './editorModel';

const KIND = {
  step: { icon: IconSquare, word: null },
  agent: { icon: IconCpu, word: 'Ticks itself when the PRISM agent reports in' },
  text: { icon: IconInfoCircle, word: 'Note' },
  secure: { icon: IconLock, word: 'Password / code (hidden)' },
};
const FIELD_WORD = {
  yesno: 'Ask', choice: 'Pick one', choices: 'Pick any', text: 'Write down', longtext: 'Write down', number: 'Write down', date: 'Write down', staff: 'Write down', contact: 'Write down',
};
const FIELD_HINT = {
  longtext: 'longer text', number: 'a number', date: 'a date', staff: 'staff member', contact: 'contact',
};

function iconFor(item) {
  if (item.kind !== 'field') return (KIND[item.kind] || KIND.step).icon;
  if (item.fieldType === 'yesno') return IconHelpCircle;
  if (item.fieldType === 'choice' || item.fieldType === 'choices') return IconListCheck;
  return IconPencil;
}

export default function ChecklistLine({
  line, usage, lookups, selected, hidden, canIndent, inputRef, onFocus,
  onChange, onKeyDown, onRich, onOnlyFor, onAdvanced, toolbar,
}) {
  const { item } = line;
  const Icon = iconFor(item);
  const labelled = item.kind === 'field' || item.kind === 'secure';
  const text = labelled ? item.label : bodyToText(item.body);
  const word = item.kind === 'field' ? FIELD_WORD[item.fieldType] : (KIND[item.kind] || {}).word;
  const placeholder = labelled ? 'What to write down' : item.kind === 'text' ? 'A note for the technician' : 'Type a step';

  const setText = (value) => {
    if (labelled) onChange({ label: value });
    else onChange({ body: textToBody(value) });
  };

  return (
    <div
      className={`group rounded-md px-2 py-1.5 ${selected ? 'bg-navy-50 ring-1 ring-navy-200' : 'hover:bg-navy-50/60'} ${hidden ? 'opacity-40' : ''}`}
      onFocusCapture={onFocus}
    >
      <div className="flex items-start gap-2">
        <Icon size={18} className="mt-2 flex-shrink-0 text-navy-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {word && <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-navy-400">{word}{item.kind === 'field' && FIELD_HINT[item.fieldType] ? ` · ${FIELD_HINT[item.fieldType]}` : ''}</span>}
          {text === null ? (
            <button type="button" ref={inputRef} onKeyDown={onKeyDown} onClick={onRich}
              className="block w-full rounded px-1 py-1 text-left text-sm text-navy-800 hover:bg-surface"
              // Rich text (lists, links): edited in the rich text editor.
              dangerouslySetInnerHTML={{ __html: item.body }} />
          ) : (
            <input
              ref={inputRef}
              className={`w-full rounded border-0 bg-transparent px-1 py-1 text-sm focus:bg-surface focus:outline-none focus:ring-1 focus:ring-navy-200 ${item.kind === 'text' ? 'text-navy-500' : 'text-navy-900'} ${labelled ? 'font-semibold' : ''}`}
              value={text}
              placeholder={placeholder}
              aria-label={word ? `${word}: ${text || 'empty'}` : `Step: ${text || 'empty'}`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
          )}
          {(item.fieldType === 'choice' || item.fieldType === 'choices') && selected && (
            <label className="mt-1 block text-xs text-navy-500">
              Options, one per line
              <textarea className="mt-1 block w-full rounded-md border border-navy-200 bg-surface px-2 py-1 text-sm" rows={Math.max(2, (item.options || []).length)}
                value={(item.options || []).join('\n')}
                onChange={(e) => onChange({ options: e.target.value.split('\n') })}
                onBlur={(e) => onChange({ options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })} />
            </label>
          )}
          {(item.fieldType === 'choice' || item.fieldType === 'choices') && !selected && (
            <span className="ml-1 text-xs text-navy-400">{(item.options || []).join(' · ')}</span>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1 pt-1">
          {!item.required && item.kind !== 'text' && <span className="text-xs text-navy-400">optional</span>}
          {line.onlyFor && !line.advanced && (
            <button type="button" onClick={onOnlyFor} className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700" title={describeOnlyFor(line.onlyFor, lookups)}>
              Only for {[...line.onlyFor.mdm.map((m) => (m === 'none' ? 'Not managed' : (lookups.mdms.find((x) => x.id === m) || {}).name || `#${m}`)),
                ...line.onlyFor.categoryId.map((c) => (lookups.categories.find((x) => x.id === c) || {}).name || `#${c}`)].join(' · ')}
            </button>
          )}
          {line.advanced && (
            <button type="button" onClick={onAdvanced} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Advanced rules</button>
          )}
        </div>
      </div>
      {selected && (
        <div className="mt-1.5 pl-7">
          <LineToolbar line={line} usage={usage} canIndent={canIndent} {...toolbar} />
        </div>
      )}
    </div>
  );
}
