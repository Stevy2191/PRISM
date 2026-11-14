// Enter sends, Shift+Enter starts a new line (owner, 2026-11-13), for the
// reply boxes and the description of a ticket being raised. Enter while an
// input method is composing (Japanese, Chinese…) only confirms the text.
export function isSendKey(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false;
  const composing = (e.nativeEvent && e.nativeEvent.isComposing) || e.isComposing || e.keyCode === 229;
  return !composing;
}

// onKeyDown for a textarea: send() on Enter, a new line on Shift+Enter.
export function sendOnEnter(send) {
  return (e) => {
    if (!isSendKey(e)) return;
    e.preventDefault();
    send(e);
  };
}

// The same for a textarea inside a form: submit it as its button would
// (the form's own checks and onSubmit run).
export const submitOnEnter = sendOnEnter((e) => {
  const { form } = e.currentTarget;
  if (form && form.requestSubmit) form.requestSubmit();
});

export const ENTER_HINT = 'Enter sends · Shift+Enter for a new line';
