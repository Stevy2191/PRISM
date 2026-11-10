// Pure helpers over the ticket category tree (5c). A tree is a
// Map<id, { id, companyId, parentId, name, sortOrder, active, requireChild }>,
// loaded whole once per request by categories.loadTree() — the table is
// small, so there is no per-node querying anywhere. Since sub-project 9 every
// company has its own tree in the same table: a node's children share its
// company, and the top level is per company (pass companyId with a null
// parent).

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

function childrenOf(tree, parentId, companyId = null) {
  const p = parentId == null ? null : Number(parentId);
  const c = p == null && companyId != null ? Number(companyId) : null;
  return [...tree.values()]
    .filter((n) => (n.parentId == null ? null : n.parentId) === p && (c == null || n.companyId === c))
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

const activeChildren = (tree, parentId, companyId = null) => childrenOf(tree, parentId, companyId).filter((n) => n.active);

// One company's nodes only (its whole tree), as a tree of its own.
const companyTree = (tree, companyId) => new Map([...tree].filter(([, n]) => n.companyId === Number(companyId)));

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
  MAX_DEPTH, pathOf, depthOf, childrenOf, descendantIds, subtreeHeight, isEffectivelyActive, activeChildren, wouldCycle, categoryJson, companyTree,
};
