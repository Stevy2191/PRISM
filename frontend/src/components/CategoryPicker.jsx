// Cascading ticket category picker (5c): one select per level, each listing
// only the chosen parent's active sub-categories. Changing a level clears
// the levels below it. A saved category that has since been retired shows
// read-only as "(retired)" until another one is picked.
import { useMemo } from 'react';
import {
  buildIndex, childrenOf, pathIds, isEffectivelyActive, pathLabel,
} from './categoryTree';

export default function CategoryPicker({
  categories, value, onChange, includeRetiredValue = false, required = false, id = 'category', disabled = false,
  emptyLabel = 'No category', compact = false, onChangeRetired = null,
}) {
  const index = useMemo(() => buildIndex(categories), [categories]);
  const chosen = pathIds(index, value);
  const retired = includeRetiredValue && value && chosen.length > 0 && !isEffectivelyActive(index, value);

  if (retired) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="category-retired">
        <span style={{ color: 'var(--color-text-primary)' }}>{pathLabel(index, value)}</span>
        <span className="eyebrow">(retired)</span>
        {!disabled && (
          <button type="button" className="text-xs hover:underline" style={{ color: 'var(--color-accent)' }} onClick={() => (onChangeRetired ? onChangeRetired() : onChange(null))}>
            change
          </button>
        )}
      </div>
    );
  }

  // One select per chosen level, plus one more while the deepest pick still has sub-categories.
  const levels = [];
  let parent = null;
  for (let depth = 0; depth < 5; depth += 1) {
    const options = childrenOf(index, parent);
    if (!options.length) break;
    levels.push({ depth, options, selected: chosen[depth] ?? '' });
    if (chosen[depth] == null) break;
    parent = chosen[depth];
  }

  const pick = (depth, raw) => {
    if (raw === '') onChange(depth === 0 ? null : chosen[depth - 1]);
    else onChange(Number(raw));
  };

  if (!levels.length) return <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No categories yet.</p>;

  return (
    <div className={compact ? 'contents' : 'flex flex-wrap gap-2'}>
      {levels.map((l) => (
        <select
          key={l.depth}
          id={l.depth === 0 ? id : `${id}-${l.depth + 1}`}
          aria-label={`Category level ${l.depth + 1}`}
          className={compact ? 'input h-9 w-auto max-w-[11rem] text-sm' : 'input w-auto min-w-[10rem]'}
          value={l.selected}
          required={required && l.depth === 0}
          disabled={disabled}
          onChange={(e) => pick(l.depth, e.target.value)}
        >
          <option value="">{l.depth === 0 ? emptyLabel : 'Any'}</option>
          {l.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ))}
    </div>
  );
}
