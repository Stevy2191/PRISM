// The end of a whole-page Settings form: says when there are unsaved
// changes, then that they were saved. `note` (for example, why the form is
// read-only) takes the button's place.
export const isDirty = (form, snapshot) => JSON.stringify(form) !== JSON.stringify(snapshot);

export default function SaveBar({ dirty, saving, saved, disabled = false, note = null }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {note ? <p className="text-sm text-navy-500">{note}</p> : (
        <>
          {dirty && <span className="text-sm text-navy-500">Unsaved changes</span>}
          {saved && !dirty && <span role="status" className="text-sm" style={{ color: 'var(--color-success)' }}>Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving || disabled || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    </div>
  );
}
