// The step-by-step category picker (9) for people raising a ticket (the
// portal): one level at a time, Other / I'm not sure at every level, then
// "Which app?" when the category asks. `tree` is [{ id, parentId, name,
// requireChild, pickKind }] (all active); `value` is { categoryId,
// categoryUnsure, catalogItemId, catalogItemNotListed }.
import { useMemo } from 'react';
import {
  buildIndex, childrenOf, pathIds, asksApp,
} from '../categoryTree';
import AppPicker from './AppPicker';

const UNSURE = 'unsure';
const kidsOf = (index, id) => childrenOf(index, id, { includeRetired: true });

// Complete: no categories, "not sure", or a choice that may stop here with
// the app answered when it's asked.
export function stepperDone(tree, value) {
  const index = buildIndex(tree);
  if (!kidsOf(index, null).length || value.categoryUnsure) return true;
  if (!value.categoryId) return false;
  const last = index.get(Number(value.categoryId));
  if (!last || (last.requireChild && kidsOf(index, last.id).length)) return false;
  return !asksApp(index, last.id) || !!value.catalogItemId || !!value.catalogItemNotListed;
}

export default function CategoryStepper({
  tree, apps, value, onChange, idPrefix = 'step', selectClass = 'input h-11',
}) {
  const index = useMemo(() => buildIndex(tree), [tree]);
  const path = pathIds(index, value.categoryId);
  const levels = [];
  let parent = null;
  for (let depth = 0; depth < 5; depth += 1) {
    const options = kidsOf(index, parent);
    if (!options.length) break;
    const needed = depth === 0 || !!index.get(parent)?.requireChild;
    levels.push({ depth, options, needed });
    if (path[depth] == null) break;
    parent = path[depth];
  }
  if (!levels.length) return null;

  const pick = (depth, raw) => {
    const keep = path.slice(0, depth);
    if (raw === UNSURE) {
      onChange({ categoryId: keep.length ? keep[keep.length - 1] : null, categoryUnsure: true, catalogItemId: null, catalogItemNotListed: false });
      return;
    }
    const next = raw === '' ? (keep.length ? keep[keep.length - 1] : null) : Number(raw);
    const stillAsks = next && asksApp(index, next);
    onChange({
      categoryId: next,
      categoryUnsure: false,
      catalogItemId: stillAsks ? value.catalogItemId : null,
      catalogItemNotListed: stillAsks ? value.catalogItemNotListed : false,
    });
  };
  const asking = !value.categoryUnsure && value.categoryId && asksApp(index, value.categoryId);

  return (
    <div className="flex flex-col gap-3" data-testid="category-stepper">
      {levels.map((l) => {
        const chosen = path[l.depth];
        const unsureHere = value.categoryUnsure && l.depth === path.length;
        return (
          <div key={l.depth}>
            <label htmlFor={`${idPrefix}-${l.depth}`} className="label">{l.depth === 0 ? "What's it about?" : 'More specifically'}</label>
            <select
              id={`${idPrefix}-${l.depth}`}
              className={selectClass}
              value={unsureHere ? UNSURE : (chosen ? String(chosen) : '')}
              onChange={(e) => pick(l.depth, e.target.value)}
            >
              <option value="">{l.needed ? 'Choose…' : 'No more detail'}</option>
              {l.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value={UNSURE}>Other / I&apos;m not sure</option>
            </select>
          </div>
        );
      })}
      {asking && (
        <div>
          <label htmlFor={`${idPrefix}-app`} className="label">Which app?</label>
          <AppPicker
            id={`${idPrefix}-app`}
            apps={apps}
            value={value}
            required
            className={selectClass}
            onChange={(v) => onChange({ ...value, ...v })}
          />
        </div>
      )}
    </div>
  );
}
