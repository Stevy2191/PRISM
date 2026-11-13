// A bundle's "Suggest it on new tickets in…" picker (PB2), now that each
// company has its own ticket categories (9): categories grouped under their
// company, so two companies' "Accounts › Termination" can be told apart.
// Plain functions so node:test can check them.
import { buildIndex, pathLabel, isEffectivelyActive } from '../../../components/categoryTree.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// → [{ companyId, company, options: [{ id, name }] }], companies by name,
// each company's categories by their full path. Retired categories are left
// out unless already chosen (so they can be unticked). `offeredFor`: the
// companies the bundle is offered for (null = every company); others' are
// left out unless chosen, since the bundle is never suggested there.
export function groupCategoriesByCompany(categories, companies, { chosen = [], offeredFor = null } = {}) {
  const index = buildIndex(categories);
  const names = new Map((companies || []).map((c) => [c.id, c.name]));
  const groups = new Map();
  for (const c of categories || []) {
    const picked = chosen.includes(c.id);
    if (!picked && !isEffectivelyActive(index, c.id)) continue; // eslint-disable-line no-continue
    if (!picked && Array.isArray(offeredFor) && !offeredFor.includes(c.companyId)) continue; // eslint-disable-line no-continue
    if (!groups.has(c.companyId)) groups.set(c.companyId, { companyId: c.companyId, company: names.get(c.companyId) || 'Another company', options: [] });
    groups.get(c.companyId).options.push({ id: c.id, name: pathLabel(index, c.id) });
  }
  const out = [...groups.values()].sort((a, b) => byName({ name: a.company }, { name: b.company }));
  out.forEach((g) => g.options.sort(byName));
  return out;
}

// The sentence's words for the chosen categories: "Accounts › Termination"
// with one company, "County: Accounts › Termination; Acme: HR › Leaving"
// with several.
export function describeSuggest(ids, categories, companies) {
  const groups = groupCategoriesByCompany(categories, companies, { chosen: ids })
    .map((g) => ({ ...g, options: g.options.filter((o) => ids.includes(o.id)) }))
    .filter((g) => g.options.length);
  if (!groups.length) return '';
  const several = new Set((categories || []).map((c) => c.companyId)).size > 1;
  return groups.map((g) => `${several ? `${g.company}: ` : ''}${g.options.map((o) => o.name).join(', ')}`).join('; ');
}
