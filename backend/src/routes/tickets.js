const express = require('express');
const ctrl = require('../controllers/ticketsController');
const canned = require('../controllers/cannedResponsesController');
const { requirePermission } = require('../middleware/requirePermission');
const { upload, enforceMaxAttachmentSize, verifyFileSignature } = require('../middleware/upload');

const router = express.Router();

const viewMin = requirePermission('tickets.view_own', 'tickets.view_department', 'tickets.view_all');
const editMin = requirePermission('tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');
const manageWatchers = requirePermission('tickets.manage_watchers');
// Your own time needs time.log and view access, which the controller
// checks (user decision 2026-10-06); someone else's needs
// time.manage_others or leading their team (services/time).
const logTime = requirePermission('time.log');

// Tickets
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('tickets.create'), ctrl.create);
// Must precede '/:id' — otherwise 'board' is read as a ticket id.
router.get('/board', viewMin, ctrl.board);
router.get('/queue-count', viewMin, ctrl.queueCount);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.post('/:id/due-date', editMin, ctrl.changeDueDate);
router.post('/:id/take', viewMin, ctrl.take);
router.post('/:id/canned/:cannedId/render', viewMin, canned.render);
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
router.get('/:id/time/log-for', logTime, ctrl.listLogFor);
router.post('/:id/time', logTime, ctrl.createTime);
router.patch('/:id/time/:entryId', logTime, ctrl.updateTime);
router.delete('/:id/time/:entryId', logTime, ctrl.removeTime);

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

// CC list: gets every public reply (spec 5a). The controller checks the
// ticket itself: view to list, edit to change.
router.get('/:id/ccs', viewMin, ctrl.listCcs);
router.post('/:id/ccs', editMin, ctrl.addCc);
router.delete('/:id/ccs/:ccId', editMin, ctrl.removeCc);

// Tasks (per-ticket checklist)
router.get('/:id/tasks', ctrl.listTasks);
router.post('/:id/tasks', editMin, ctrl.createTask);
router.patch('/:id/tasks/reorder', editMin, ctrl.reorderTasks); // must precede /:taskId
router.patch('/:id/tasks/:taskId', editMin, ctrl.updateTask);
router.delete('/:id/tasks/:taskId', editMin, ctrl.removeTask);
router.patch('/:id/tasks/:taskId/code', editMin, ctrl.renumberTask);

// Custom field values (Settings -> Layouts & Fields)
router.get('/:id/custom-field-values', viewMin, ctrl.getCustomFieldValues);
router.patch('/:id/custom-field-values', editMin, ctrl.updateCustomFieldValues);

// Activity (per-ticket timeline)
router.get('/:id/activity', ctrl.listActivity);

// PDF report
router.get('/:id/report', viewMin, ctrl.generateReport);

module.exports = router;
