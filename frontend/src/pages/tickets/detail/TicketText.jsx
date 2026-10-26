// The ticket's title and description, editable in place by anyone with edit
// access. `onSave(changes)` PATCHes the ticket and throws on a refusal, so
// the message shows next to the field instead of in an alert.
import { useEffect, useState } from 'react';
import { IconPencil } from '@tabler/icons-react';
import { errMessage } from '../../../api/api';
import { TEXT, MUTED, BLUE, fieldStyle } from '../theme';

const errorStyle = { color: 'var(--color-danger)' };

export function EditableTitle({ title, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setText(title); }, [title, editing]);

  const cancel = () => { setEditing(false); setError(''); setText(title); };
  const save = async () => {
    if (text === title) { cancel(); return; }
    setSaving(true);
    try {
      await onSave({ title: text });
      setEditing(false);
      setError('');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="min-w-0 flex-1 basis-[320px]">
        <input
          autoFocus
          aria-label="Ticket title"
          maxLength={255}
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="input w-full text-xl font-bold"
          style={fieldStyle}
        />
        {error
          ? <p className="mt-1 text-sm" role="alert" style={errorStyle}>{error}</p>
          : <p className="mt-1 text-xs" style={{ color: MUTED }}>Enter to save, Esc to cancel</p>}
      </div>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <h1 className="text-xl font-bold" style={{ color: TEXT }}>{title}</h1>
      {canEdit && (
        <button
          type="button"
          aria-label="Edit title"
          title="Edit title"
          onClick={() => setEditing(true)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md hover:bg-[var(--color-hover)] max-sm:h-11 max-sm:w-11"
          style={{ color: MUTED }}
        >
          <IconPencil size={16} />
        </button>
      )}
    </span>
  );
}

export function DescriptionCard({ description, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setText(description || ''); }, [description, editing]);

  const cancel = () => { setEditing(false); setError(''); setText(description || ''); };
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ description: text });
      setEditing(false);
      setError('');
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="ticket-description"
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)' }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Description</h3>
        {canEdit && !editing && (
          <button
            type="button"
            aria-label="Edit description"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-[var(--color-hover)] max-sm:min-h-[44px]"
            style={{ color: BLUE }}
          >
            <IconPencil size={14} />
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            aria-label="Description"
            value={text}
            disabled={saving}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
            className="input resize-y"
            style={{ ...fieldStyle, minHeight: '140px' }}
          />
          {error && <p className="mt-1 text-sm" role="alert" style={errorStyle}>{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={saving} className="btn-secondary text-sm">Cancel</button>
            <button type="button" onClick={save} disabled={saving} aria-label="Save description" className="btn-primary text-sm">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        // Plain text, rendered as text (never HTML): it can come straight
        // from a customer's email.
        <p className="whitespace-pre-wrap break-words text-sm" style={{ color: description ? TEXT : MUTED }}>
          {description || 'No description.'}
        </p>
      )}
    </section>
  );
}
