// "Which app?" (9): shown when the chosen category (or one above it) asks.
// `apps` is the company's active list; `value` is { catalogItemId,
// catalogItemNotListed }. A stored app that has since been turned off still
// shows by name (`current`) until another is picked.
export const NOT_LISTED = 'notlisted';

export default function AppPicker({
  apps, value, onChange, current = null, id = 'which-app', required = false, disabled = false, className = 'input w-auto min-w-[12rem]',
}) {
  const shown = value.catalogItemNotListed ? NOT_LISTED : (value.catalogItemId ? String(value.catalogItemId) : '');
  const list = current && !apps.some((a) => a.id === current.id) ? [...apps, { ...current, off: true }] : apps;
  return (
    <select
      id={id}
      aria-label="Which app?"
      className={className}
      value={shown}
      required={required}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === NOT_LISTED ? { catalogItemId: null, catalogItemNotListed: true } : { catalogItemId: v ? Number(v) : null, catalogItemNotListed: false });
      }}
    >
      <option value="">{required ? 'Choose the app…' : 'Which app?'}</option>
      {list.map((a) => <option key={a.id} value={a.id}>{a.off ? `${a.name} (turned off)` : a.name}</option>)}
      <option value={NOT_LISTED}>Not listed</option>
    </select>
  );
}
