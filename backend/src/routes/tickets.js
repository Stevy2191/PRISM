const express = require('express');
const ctrl = require('../controllers/ticketsController');
const { requireRole } = require('../middleware/role');
const { requirePermission } = require('../middleware/requirePermission');
const { upload } = require('../middleware/upload');

const router = express.Router();

const staff = requireRole('admin', 'technician');
const viewMin = requirePermission('tickets.view_own', 'tickets.view_department', 'tickets.view_all');
const editMin = requirePermission('tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');

// Tickets
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('tickets.create'), ctrl.create);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.remove);

// Comments
router.get('/:id/comments', viewMin, ctrl.listComments);
router.post('/:id/comments', requirePermission('tickets.create'), ctrl.createComment);
router.patch('/:id/comments/:commentId', ctrl.updateComment);
router.delete('/:id/comments/:commentId', ctrl.removeComment);

// Attachments
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', upload.single('file'), ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', ctrl.removeAttachment);

// Time entries (logging is staff-only)
router.get('/:id/time', ctrl.listTime);
router.post('/:id/time', staff, ctrl.createTime);
router.delete('/:id/time/:entryId', ctrl.removeTime);

// Related tickets (managed by staff)
router.get('/:id/relations', ctrl.listRelations);
router.post('/:id/relations', staff, ctrl.createRelation);
router.delete('/:id/relations/:relationId', staff, ctrl.removeRelation);

// CSAT (staff enters on the contact's behalf; anyone who can view the ticket can read)
router.get('/:id/csat', ctrl.getCsat);
router.post('/:id/csat', ctrl.submitCsat);

// Watchers
router.get('/:id/watchers', ctrl.listWatchers);
router.post('/:id/watchers', ctrl.addWatcher);
router.delete('/:id/watchers/:userId', ctrl.removeWatcher);

// Tasks (per-ticket checklist)
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', ctrl.createTask);
router.patch('/:id/tasks/:taskId', ctrl.updateTask);

// Custom field values (Settings -> Layouts & Fields)
router.get('/:id/custom-field-values', viewMin, ctrl.getCustomFieldValues);
router.patch('/:id/custom-field-values', editMin, ctrl.updateCustomFieldValues);

// Activity (per-ticket timeline)
router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
