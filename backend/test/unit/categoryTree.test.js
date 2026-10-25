const tree = require('../../src/services/tickets/categoryTree');

// Hardware(1) › Laptop(2) › Battery(3); Hardware › Printer(4, retired) › Toner(5);
// Software(6, sortOrder 0) and Access(7, sortOrder 0) as roots.
const node = (id, parentId, name, extra = {}) => [id, {
  id, parentId, name, sortOrder: 0, active: true, requireChild: false, ...extra,
}];
const make = () => new Map([
  node(1, null, 'Hardware', { sortOrder: 2 }),
  node(2, 1, 'Laptop', { sortOrder: 1 }),
  node(3, 2, 'Battery'),
  node(4, 1, 'Printer', { sortOrder: 0, active: false }),
  node(5, 4, 'Toner'),
  node(6, null, 'Software'),
  node(7, null, 'Access'),
]);

describe('category tree helpers', () => {
  it('pathOf returns root→leaf, [] for unknown', () => {
    expect(tree.pathOf(make(), 3).map((n) => n.name)).toEqual(['Hardware', 'Laptop', 'Battery']);
    expect(tree.pathOf(make(), 99)).toEqual([]);
    expect(tree.pathOf(make(), null)).toEqual([]);
  });

  it('depthOf root is 1', () => {
    expect(tree.depthOf(make(), 1)).toBe(1);
    expect(tree.depthOf(make(), 3)).toBe(3);
  });

  it('subtreeHeight of leaf is 1 and of a 3-level chain is 3', () => {
    expect(tree.subtreeHeight(make(), 3)).toBe(1);
    expect(tree.subtreeHeight(make(), 1)).toBe(3);
  });

  it('descendantIds includes self and all levels', () => {
    expect(tree.descendantIds(make(), 1).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(tree.descendantIds(make(), 3)).toEqual([3]);
  });

  it('isEffectivelyActive false when an ancestor is retired', () => {
    const t = make();
    expect(tree.isEffectivelyActive(t, 3)).toBe(true);
    expect(tree.isEffectivelyActive(t, 4)).toBe(false);
    expect(tree.isEffectivelyActive(t, 5)).toBe(false);
    expect(tree.isEffectivelyActive(t, 99)).toBe(false);
  });

  it('activeChildren excludes retired and orders by sortOrder then name', () => {
    expect(tree.activeChildren(make(), 1).map((n) => n.name)).toEqual(['Laptop']);
    expect(tree.activeChildren(make(), null).map((n) => n.name)).toEqual(['Access', 'Software', 'Hardware']);
  });

  it('wouldCycle true for self and for a descendant, false otherwise', () => {
    const t = make();
    expect(tree.wouldCycle(t, 1, 1)).toBe(true);
    expect(tree.wouldCycle(t, 1, 3)).toBe(true);
    expect(tree.wouldCycle(t, 2, 6)).toBe(false);
    expect(tree.wouldCycle(t, 2, null)).toBe(false);
  });

  it('categoryJson null for unknown/null id, path names otherwise', () => {
    expect(tree.categoryJson(make(), null)).toBeNull();
    expect(tree.categoryJson(make(), 99)).toBeNull();
    expect(tree.categoryJson(make(), 3)).toEqual({ id: 3, path: ['Hardware', 'Laptop', 'Battery'] });
  });

  it('subtreeHeight and descendantIds stay finite on a (corrupt) cycle', () => {
    const t = new Map([node(1, 2, 'A'), node(2, 1, 'B')]);
    expect(tree.subtreeHeight(t, 1)).toBeLessThanOrEqual(2);
    expect(tree.descendantIds(t, 1).sort()).toEqual([1, 2]);
  });

  it('MAX_DEPTH is 5', () => {
    expect(tree.MAX_DEPTH).toBe(5);
  });
});
