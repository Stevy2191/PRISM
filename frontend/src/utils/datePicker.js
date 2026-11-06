// Clicking anywhere in a date field opens its calendar, not only the small
// icon at its end (typing the date still works). One listener for the whole
// app, so every date field behaves the same.
const PICKER_TYPES = new Set(['date', 'datetime-local', 'month', 'week', 'time']);

export function opensPicker(el) {
  return Boolean(el && el.tagName === 'INPUT' && PICKER_TYPES.has(el.type)
    && !el.disabled && !el.readOnly && typeof el.showPicker === 'function');
}

// Capture phase: dialogs stop clicks from bubbling past them, and the
// listener must still see a click on a date field inside one.
export function installDatePickerOpener(doc) {
  doc.addEventListener('click', (e) => {
    if (!opensPicker(e.target)) return;
    // Throws when the browser won't open it (already open, not allowed
    // here); then the field works as it always did.
    try { e.target.showPicker(); } catch { /* keep the default */ }
  }, true);
}
