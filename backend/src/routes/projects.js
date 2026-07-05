const express = require('express');
const ctrl = require('../controllers/projectsController');
const { requireRole } = require('../middleware/role');
const { requirePermission } = require('../middleware/requirePermission');
const { projectUpload } = require('../middleware/upload');

const router = express.Router();

const staff = requireRole('admin', 'technician');
const viewMin = requirePermission('projects.view_own', 'projects.view_department', 'projects.view_all');
const editMin = requirePermission('projects.edit_own', 'projects.edit_department', 'projects.edit_all');

// Projects
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('projects.create'), ctrl.create);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.delete('/:id', requirePermission('projects.delete'), ctrl.remove);
router.get('/:id/stats', viewMin, ctrl.getStats);

// Tasks + subtasks
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', staff, ctrl.createTask);
router.patch('/:id/tasks/:taskId', staff, ctrl.updateTask);
router.delete('/:id/tasks/:taskId', staff, ctrl.removeTask);
router.post('/:id/tasks/:taskId/subtasks', staff, ctrl.createSubtask);
router.patch('/:id/tasks/:taskId/subtasks/:subtaskId', staff, ctrl.updateSubtask);
router.delete('/:id/tasks/:taskId/subtasks/:subtaskId', staff, ctrl.removeSubtask);

// Time entries (logging is staff-only, matching tickets)
router.get('/:id/time-entries', ctrl.listTimeEntries);
router.post('/:id/time-entries', requirePermission('projects.log_time'), ctrl.createTimeEntry);
router.patch('/:id/time-entries/:entryId', staff, ctrl.updateTimeEntry);
router.delete('/:id/time-entries/:entryId', staff, ctrl.removeTimeEntry);

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
router.post('/:id/files', staff, projectUpload.single('file'), ctrl.uploadFile);
router.get('/:id/files/:fileId/download', ctrl.downloadFile);
router.delete('/:id/files/:fileId', staff, ctrl.removeFile);

// Activity
router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
