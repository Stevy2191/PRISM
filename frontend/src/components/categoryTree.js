// Pure helpers over the ticket category list from GET /ticket-categories
// (flat nodes: { id, parentId, name, sortOrder, active, requireChild }).

export function buildIndex(categories) {
  return new Map((categories || []).map((c) => [c.id, c]));
}

// Root → node ids; [] for an unknown or empty id. Stops on a loop.
export function pathIds(index, id) {
  const out = [];
  let cur = id == null || id === '' ? null : index.get(Number(id));
  while (cur && !out.includes(cur.id)) {
    out.unshift(cur.id);
    cur = cur.parentId == null ? null : index.get(cur.parentId);
  }
  return out;
}

export function childrenOf(index, parentId, { includeRetired = false } = {}) {
  const p = parentId == null ? null : Number(parentId);
  return [...index.values()]
    .filter((c) => (c.parentId ?? null) === p && (includeRetired || c.active))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
}

export function isEffectivelyActive(index, id) {
  const ids = pathIds(index, id);
  return ids.length > 0 && ids.every((i) => index.get(i).active);
}

export function pathLabel(index, id) {
  return pathIds(index, id).map((i) => index.get(i).name).join(' › ');
}

// The categories a ticket of this type may take (9): an incident's are for
// incidents or both, a request's for requests or both; other types take any.
// `forType` is the type a category is for (its top-level category's).
export function forTicketType(categories, type) {
  if (type !== 'incident' && type !== 'request') return categories;
  return categories.filter((c) => !c.forType || c.forType === type);
}
