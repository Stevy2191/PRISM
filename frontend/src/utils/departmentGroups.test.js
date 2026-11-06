import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentGroups } from './departmentGroups.js';

const desk = { id: 1, name: 'Desk', isInternal: true };
const acme = { id: 2, name: 'Acme', isInternal: false };
const bee = { id: 3, name: 'Bee Co', isInternal: false };
const deps = [
  { id: 10, name: 'HR', companyId: 3, company: bee },
  { id: 11, name: 'HR', companyId: 2, company: acme },
  { id: 12, name: 'Service Desk', companyId: 1, company: desk },
  { id: 13, name: 'Billing', companyId: 2, company: acme },
];

test('with company features off it is one plain list', () => {
  assert.deepEqual(departmentGroups(deps, { multiCompany: false }), [{ label: null, departments: deps }]);
});

test('one company in view: only its departments, no groups', () => {
  assert.deepEqual(departmentGroups(deps, { multiCompany: true, companyId: '2' }).map((g) => [g.label, g.departments.map((d) => d.id)]), [[null, [11, 13]]]);
});

test('all companies: grouped, the help desk\'s own first, then by name', () => {
  assert.deepEqual(departmentGroups(deps, { multiCompany: true }).map((g) => [g.label, g.departments.map((d) => d.id)]), [
    ['Desk', [12]], ['Acme', [11, 13]], ['Bee Co', [10]],
  ]);
});
