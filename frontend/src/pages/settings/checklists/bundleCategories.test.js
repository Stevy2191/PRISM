import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCategoriesByCompany, describeSuggest } from './bundleCategories.js';

const companies = [{ id: 1, name: 'Washington County' }, { id: 2, name: 'Acme' }];
const cat = (id, companyId, name, parentId = null, active = true) => ({ id, companyId, name, parentId, active, sortOrder: 0 });
const categories = [
  cat(10, 1, 'Accounts'), cat(11, 1, 'Termination', 10), cat(12, 1, 'Old', null, false),
  cat(20, 2, 'Accounts'), cat(21, 2, 'Termination', 20),
];

test('categories are grouped under their company, companies and paths by name', () => {
  const groups = groupCategoriesByCompany(categories, companies);
  assert.deepEqual(groups.map((g) => g.company), ['Acme', 'Washington County']);
  assert.deepEqual(groups[0].options, [{ id: 20, name: 'Accounts' }, { id: 21, name: 'Accounts › Termination' }]);
  assert.deepEqual(groups[1].options.map((o) => o.id), [10, 11]); // the retired one is left out
});

test('a retired or not-offered category stays while it is chosen, so it can be unticked', () => {
  assert.ok(groupCategoriesByCompany(categories, companies, { chosen: [12] })[1].options.some((o) => o.id === 12));
  const offered = groupCategoriesByCompany(categories, companies, { offeredFor: [1] });
  assert.deepEqual(offered.map((g) => g.company), ['Washington County']);
  const kept = groupCategoriesByCompany(categories, companies, { offeredFor: [1], chosen: [21] });
  assert.deepEqual(kept.find((g) => g.companyId === 2).options, [{ id: 21, name: 'Accounts › Termination' }]);
});

test('a company PRISM was not told about still gets a heading', () => {
  assert.equal(groupCategoriesByCompany([cat(30, 9, 'Misc')], companies)[0].company, 'Another company');
});

test('the sentence names the company when there are several', () => {
  assert.equal(describeSuggest([11, 21], categories, companies), 'Acme: Accounts › Termination; Washington County: Accounts › Termination');
  assert.equal(describeSuggest([11], categories.filter((c) => c.companyId === 1), companies), 'Accounts › Termination');
  assert.equal(describeSuggest([], categories, companies), '');
});
