const express = require('express');
const ctrl = require('../controllers/projectsController');
const { requireRole } = require('../middleware/role');
const { projectUpload } = require('../middleware/upload');

const router = express.Router();

const staff = requireRole('admin', 'technician');

// Projects
router.get('/', ctrl.list);
router.post('/', staff, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', staff, ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);
router.get('/:id/stats', ctrl.getStats);

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
router.post('/:id/time-entries', staff, ctrl.createTimeEntry);
router.patch('/:id/time-entries/:entryId', staff, ctrl.updateTimeEntry);
router.delete('/:id/time-entries/:entryId', staff, ctrl.removeTimeEntry);

// Expenses
router.get('/:id/expenses', ctrl.listExpenses);
router.post('/:id/expenses', staff, ctrl.createExpense);
router.patch('/:id/expenses/:expenseId', staff, ctrl.updateExpense);
router.delete('/:id/expenses/:expenseId', staff, ctrl.removeExpense);

// Materials
router.get('/:id/materials', ctrl.listMaterials);
router.post('/:id/materials', staff, ctrl.createMaterial);
router.patch('/:id/materials/:materialId', staff, ctrl.updateMaterial);
router.delete('/:id/materials/:materialId', staff, ctrl.removeMaterial);

// Members
router.get('/:id/members', ctrl.listMembers);
router.post('/:id/members', staff, ctrl.addMember);
router.delete('/:id/members/:userId', staff, ctrl.removeMember);

// Files
router.get('/:id/files', ctrl.listFiles);
router.post('/:id/files', staff, projectUpload.single('file'), ctrl.uploadFile);
router.get('/:id/files/:fileId/download', ctrl.downloadFile);
router.delete('/:id/files/:fileId', staff, ctrl.removeFile);

// Activity
router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
