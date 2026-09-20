const express = require('express');
const ctrl = require('../controllers/ticketsController');
const { requirePermission } = require('../middleware/requirePermission');
const { upload, enforceMaxAttachmentSize, verifyFileSignature } = require('../middleware/upload');

const router = express.Router();

const viewMin = requirePermission('tickets.view_own', 'tickets.view_department', 'tickets.view_all');
const editMin = requirePermission('tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');
const manageWatchers = requirePermission('tickets.manage_watchers');

// Tickets
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('tickets.create'), ctrl.create);
// Must precede '/:id' — otherwise 'board' is read as a ticket id.
router.get('/board', viewMin, ctrl.board);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.remove);

// Comments
router.get('/:id/comments', viewMin, ctrl.listComments);
router.post('/:id/comments', requirePermission('tickets.create'), ctrl.createComment);
router.patch('/:id/comments/:commentId', editMin, ctrl.updateComment);
router.delete('/:id/comments/:commentId', editMin, ctrl.removeComment);

// Attachments
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', editMin, upload.single('file'), verifyFileSignature, enforceMaxAttachmentSize, ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', editMin, ctrl.removeAttachment);

// Time entries (requires an edit permission on tickets)
router.get('/:id/time', ctrl.listTime);
router.post('/:id/time', editMin, ctrl.createTime);
router.delete('/:id/time/:entryId', editMin, ctrl.removeTime);

// Related tickets (requires an edit permission on tickets)
router.get('/:id/relations', ctrl.listRelations);
router.post('/:id/relations', editMin, ctrl.createRelation);
router.delete('/:id/relations/:relationId', editMin, ctrl.removeRelation);

// CSAT (staff enters on the contact's behalf; anyone who can view the ticket can read)
router.get('/:id/csat', ctrl.getCsat);
router.post('/:id/csat', editMin, ctrl.submitCsat);

// Watchers
router.get('/:id/watchers', ctrl.listWatchers);
router.post('/:id/watchers', manageWatchers, ctrl.addWatcher);
router.delete('/:id/watchers/:userId', manageWatchers, ctrl.removeWatcher);

// Tasks (per-ticket checklist)
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', editMin, ctrl.createTask);
router.patch('/:id/tasks/:taskId', editMin, ctrl.updateTask);

// Custom field values (Settings -> Layouts & Fields)
router.get('/:id/custom-field-values', viewMin, ctrl.getCustomFieldValues);
router.patch('/:id/custom-field-values', editMin, ctrl.updateCustomFieldValues);

// Activity (per-ticket timeline)
router.get('/:id/activity', ctrl.listActivity);

// PDF report
router.get('/:id/report', viewMin, ctrl.generateReport);

module.exports = router;
