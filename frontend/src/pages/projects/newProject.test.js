import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewSummary, createBody } from './newProject.js';

const plan = {
  phases: [{ id: 1, name: 'Plan' }, { id: 2, name: 'Install' }],
  tasks: [
    { id: 10, phaseId: 1, parentId: null, title: 'A', startDate: '2026-11-16', dueDate: '2026-11-18', estimateMinutes: 60, isMilestone: false },
    { id: 11, phaseId: null, parentId: 10, title: 'A sub', startDate: '2026-11-17', dueDate: '2026-11-20', estimateMinutes: 30, isMilestone: false },
    { id: 12, phaseId: 2, parentId: null, title: 'Signed off', startDate: '2026-12-10', dueDate: '2026-12-10', estimateMinutes: null, isMilestone: true },
  ],
  dependencies: [{ predecessorId: 10, successorId: 12 }],
  finishDate: '2026-12-10',
};

test('the preview groups tasks by phase with dates, hours and milestones', () => {
  const p = previewSummary(plan);
  assert.equal(p.phases[0].range, 'Nov 16 – Nov 20');
  assert.equal(p.phases[0].taskCount, 2);
  assert.equal(p.phases[0].minutes, 90);
  assert.deepEqual(p.phases[1].milestones.map((m) => m.date), ['Thu, Dec 10']);
  assert.equal(p.taskCount, 2);
  assert.equal(p.linkCount, 1);
  assert.equal(p.minutes, 90);
});

test('tasks outside every phase show under No phase, first', () => {
  const p = previewSummary({ ...plan, tasks: [...plan.tasks, { id: 13, phaseId: null, parentId: null, title: 'Loose', startDate: '2026-11-16', dueDate: '2026-11-16', isMilestone: false }] });
  assert.equal(p.phases[0].name, 'No phase');
});

test('create body: template sends its id and dates; blank sends the finish as the due date', () => {
  const form = { name: ' X ', ownerDepartmentId: '3', companyId: '', assignedToUserId: '', startDate: '2026-11-16', finishDate: '2026-12-10', templateId: '7' };
  const t = createBody({ form, tags: [], origin: 'template', memberIds: [] });
  assert.equal(t.templateId, '7');
  assert.equal(t.finishDate, '2026-12-10');
  assert.equal(t.name, 'X');
  assert.equal('hourBudgetMinutes' in t, false);
  const b = createBody({ form, tags: ['a'], origin: 'blank', memberIds: [], budget: null });
  assert.equal(b.dueDate, '2026-12-10');
  assert.equal('finishDate' in b, false);
  assert.equal(b.hourBudgetMinutes, null);
  assert.equal(createBody({ form, tags: [], origin: 'copy', copyId: '9', memberIds: [] }).copyFromProjectId, '9');
});
