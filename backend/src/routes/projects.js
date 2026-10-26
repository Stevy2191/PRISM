const express = require('express');
const ctrl = require('../controllers/projectsController');
const { requirePermission } = require('../middleware/requirePermission');
const { projectUpload, enforceMaxAttachmentSize, verifyFileSignature, scanUpload } = require('../middleware/upload');

const router = express.Router();

// Your own time needs time.log and view access, which the controller
// checks (user decision 2026-10-06); someone else's needs
// time.manage_others or leading their team (services/time).
const logTime = requirePermission('time.log');
const viewMin = requirePermission('projects.view_own', 'projects.view_department', 'projects.view_all');
const editMin = requirePermission('projects.edit_own', 'projects.edit_department', 'projects.edit_all');

// Projects
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('projects.create'), ctrl.create);
// Must precede '/:id' — otherwise 'tags' is read as a project id.
router.get('/tags', viewMin, ctrl.listTags);
router.get('/attention', viewMin, ctrl.attentionTiles);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.delete('/:id', requirePermission('projects.delete'), ctrl.remove);
router.get('/:id/stats', viewMin, ctrl.getStats);
router.get('/:id/budget', viewMin, ctrl.getBudget);

// Tasks + subtasks
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', editMin, ctrl.createTask);
router.patch('/:id/tasks/reorder', editMin, ctrl.reorderTasks); // must precede /:taskId
router.patch('/:id/tasks/:taskId', editMin, ctrl.updateTask);
router.delete('/:id/tasks/:taskId', editMin, ctrl.removeTask);
router.patch('/:id/tasks/:taskId/code', editMin, ctrl.renumberTask);
router.post('/:id/tasks/:taskId/subtasks', editMin, ctrl.createSubtask);
router.patch('/:id/tasks/:taskId/subtasks/:subtaskId', editMin, ctrl.updateSubtask);
router.delete('/:id/tasks/:taskId/subtasks/:subtaskId', editMin, ctrl.removeSubtask);
router.patch('/:id/tasks/:taskId/subtasks/:subtaskId/code', editMin, ctrl.renumberSubtask);

// Helpers: view access is checked in the controller (the main assignee can add one
// without the edit tier; a helper can remove themselves).
router.post('/:id/tasks/:taskId/helpers', ctrl.addHelper);
router.delete('/:id/tasks/:taskId/helpers/:userId', ctrl.removeHelper);
router.post('/:id/tasks/:taskId/subtasks/:subtaskId/helpers', ctrl.addSubtaskHelper);
router.delete('/:id/tasks/:taskId/subtasks/:subtaskId/helpers/:userId', ctrl.removeSubtaskHelper);

// Phases
router.get('/:id/phases', ctrl.listPhases);
router.post('/:id/phases', editMin, ctrl.createPhase);
router.patch('/:id/phases/reorder', editMin, ctrl.reorderPhases); // must precede /:phaseId
router.patch('/:id/phases/:phaseId', editMin, ctrl.updatePhase);
router.delete('/:id/phases/:phaseId', editMin, ctrl.removePhase);

// Dependencies between top-level tasks (finish-to-start), and shifting what waits on a task
router.get('/:id/dependencies', ctrl.listDependencies);
router.post('/:id/dependencies', editMin, ctrl.createDependency);
router.delete('/:id/dependencies/:depId', editMin, ctrl.removeDependency);
router.post('/:id/tasks/:taskId/shift-dependents', editMin, ctrl.shiftDependents);

// Time entries (time.log; the same rules as ticket time)
router.get('/:id/time-entries', ctrl.listTimeEntries);
router.get('/:id/time-entries/log-for', logTime, ctrl.listLogFor);
router.post('/:id/time-entries', logTime, ctrl.createTimeEntry);
router.patch('/:id/time-entries/:entryId', logTime, ctrl.updateTimeEntry);
router.delete('/:id/time-entries/:entryId', logTime, ctrl.removeTimeEntry);

// Expenses
router.get('/:id/expenses', ctrl.listExpenses);
router.post('/:id/expenses', requirePermission('projects.manage_expenses'), ctrl.createExpense);
router.patch('/:id/expenses/:expenseId', requirePermission('projects.manage_expenses'), ctrl.updateExpense);
router.delete('/:id/expenses/:expenseId', requirePermission('projects.manage_expenses'), ctrl.removeExpense);

// Materials
router.get('/:id/materials', ctrl.listMaterials);
router.post('/:id/materials', requirePermission('projects.manage_expenses'), ctrl.createMaterial);
router.patch('/:id/materials/:materialId', requirePermission('projects.manage_expenses'), ctrl.updateMaterial);
router.delete('/:id/materials/:materialId', requirePermission('projects.manage_expenses'), ctrl.removeMaterial);

// Members
router.get('/:id/members', ctrl.listMembers);
router.post('/:id/members', requirePermission('projects.manage_members'), ctrl.addMember);
router.delete('/:id/members/:userId', requirePermission('projects.manage_members'), ctrl.removeMember);

// Files
router.get('/:id/files', ctrl.listFiles);
router.post('/:id/files', editMin, projectUpload.single('file'), verifyFileSignature, enforceMaxAttachmentSize, scanUpload('Project'), ctrl.uploadFile);
router.get('/:id/files/:fileId/download', ctrl.downloadFile);
router.delete('/:id/files/:fileId', editMin, ctrl.removeFile);

// Activity
router.get('/:id/activity', ctrl.listActivity);

// PDF report
router.get('/:id/report', viewMin, ctrl.generateReport);

module.exports = router;
