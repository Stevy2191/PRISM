// Pure helpers over the ticket category tree (5c). A tree is a
// Map<id, { id, parentId, name, sortOrder, active, requireChild }>, loaded
// whole once per request by categories.loadTree() — the table is small and
// global, so there is no per-node querying anywhere.

const MAX_DEPTH = 5;

// Root → node. [] for an unknown or null id. Stops on a (corrupt) loop
// rather than spinning.
function pathOf(tree, id) {
  const out = [];
  const seen = new Set();
  let cur = id == null ? null : tree.get(Number(id));
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId == null ? null : tree.get(cur.parentId);
  }
  return out;
}

const depthOf = (tree, id) => pathOf(tree, id).length;

function childrenOf(tree, parentId) {
  const p = parentId == null ? null : Number(parentId);
  return [...tree.values()]
    .filter((n) => (n.parentId == null ? null : n.parentId) === p)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
}

// The node and everything below it.
function descendantIds(tree, id) {
  const out = [];
  const stack = [Number(id)];
  while (stack.length) {
    const cur = stack.pop();
    if (!tree.has(cur) || out.includes(cur)) continue; // eslint-disable-line no-continue
    out.push(cur);
    childrenOf(tree, cur).forEach((c) => stack.push(c.id));
  }
  return out;
}

// Levels from the node down to its deepest descendant (a leaf = 1).
function subtreeHeight(tree, id, seen = new Set()) {
  const node = tree.get(Number(id));
  if (!node || seen.has(node.id)) return 0;
  seen.add(node.id);
  const below = childrenOf(tree, node.id).map((c) => subtreeHeight(tree, c.id, seen));
  return 1 + (below.length ? Math.max(...below) : 0);
}

// The node and every ancestor are active.
function isEffectivelyActive(tree, id) {
  const path = pathOf(tree, id);
  return path.length > 0 && path.every((n) => n.active);
}

const activeChildren = (tree, parentId) => childrenOf(tree, parentId).filter((n) => n.active);

// Would putting `id` under `newParentId` make it its own ancestor?
function wouldCycle(tree, id, newParentId) {
  if (newParentId == null) return false;
  return pathOf(tree, newParentId).some((n) => n.id === Number(id));
}

function categoryJson(tree, id) {
  const path = pathOf(tree, id);
  if (!path.length) return null;
  return { id: path[path.length - 1].id, path: path.map((n) => n.name) };
}

module.exports = {
  MAX_DEPTH, pathOf, depthOf, childrenOf, descendantIds, subtreeHeight, isEffectivelyActive, activeChildren, wouldCycle, categoryJson,
};
