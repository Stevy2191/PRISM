// Resolution tab.
import { useEffect, useState } from 'react';
import { TEXT, MUTED, BLUE, formatDate, fieldStyle } from '../theme';

// ---- Resolution tab ----

export function ResolutionTab({ ticket, onSave, isStaff }) {
  const [text, setText] = useState(ticket.resolution || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setText(ticket.resolution || ''); }, [ticket.resolution]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Resolution</h3>
      <p className="mb-3 text-xs" style={{ color: MUTED }}>
        Document what resolved this ticket. This may be used for future reference and knowledge base articles.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!isStaff}
        placeholder="Describe what resolved this issue..."
        className="input resize-y disabled:opacity-70"
        style={{ ...fieldStyle, minHeight: '220px' }}
      />
      {ticket.resolutionUpdatedByUser && ticket.resolutionUpdatedAt && (
        <p className="mt-2 text-xs" style={{ color: MUTED }}>
          Last updated by {ticket.resolutionUpdatedByUser.displayName} on {formatDate(ticket.resolutionUpdatedAt)}
        </p>
      )}
      {isStaff && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {saving ? 'Saving…' : 'Save Resolution'}
          </button>
        </div>
      )}
    </div>
  );
}
