const express = require('express');
const ctrl = require('../controllers/ticketsController');
const canned = require('../controllers/cannedResponsesController');
const { requirePermission } = require('../middleware/requirePermission');
const { findTicketIdByNumber } = require('../services/tickets/numbers');
const { upload, enforceMaxAttachmentSize, verifyFileSignature, scanUpload } = require('../middleware/upload');

const router = express.Router();

// Every /tickets/:id route takes the company ticket number (WC-T0042, an old
// number it had, or a plain id), resolved here once so each handler keeps
// reading a numeric id. Access is still decided by each handler on the
// ticket it finds, so a number reaches exactly what its id would. A number
// that matches nothing is left as it is, and the handler's own lookup 404s.
router.param('id', async (req, res, next, raw) => {
  try {
    if (!/^\d+$/.test(raw)) {
      const id = await findTicketIdByNumber(raw);
      if (id) req.params.id = String(id);
    }
    next();
  } catch (err) {
    next(err);
  }
});

const viewMin = requirePermission('tickets.view_own', 'tickets.view_department', 'tickets.view_all');
const editMin = requirePermission('tickets.edit_own', 'tickets.edit_department', 'tickets.edit_all');
const manageWatchers = requirePermission('tickets.manage_watchers');
// Your own time needs time.log and view access, which the controller
// checks (user decision 2026-10-06); someone else's needs
// time.manage_others or leading their team (services/time).
const logTime = requirePermission('time.log');

const playbooks = require('../controllers/tickets/playbooks');
const devices = require('../controllers/tickets/devices');
const ticketForms = require('../controllers/tickets/forms');
const { secretRevealLimiter } = require('../middleware/rateLimit');

// Tickets
router.get('/', viewMin, ctrl.list);
router.post('/', requirePermission('tickets.create'), ctrl.create);
// Must precede '/:id' — otherwise 'board' is read as a ticket id.
router.get('/board', viewMin, ctrl.board);
router.get('/queue-count', viewMin, ctrl.queueCount);
router.post('/bulk', viewMin, ctrl.bulk);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.post('/:id/due-date', editMin, ctrl.changeDueDate);
router.post('/:id/take', viewMin, ctrl.take);
router.post('/:id/merge', editMin, ctrl.merge);
// Phase 3: the ticket's materials (from the catalog or the shelf).
const ticketMaterials = require('../controllers/tickets/materials');
router.get('/:id/materials', ticketMaterials.list);
router.post('/:id/materials', ticketMaterials.create);
router.patch('/:id/materials/:materialId', ticketMaterials.update);
router.delete('/:id/materials/:materialId', ticketMaterials.remove);
// Phase 3: the ticket's bills (amounts only with money permissions).
router.get('/:id/bills', require('../controllers/money/billsController').ticketBills);
router.post('/:id/split', editMin, ctrl.split);
router.post('/:id/canned/:cannedId/render', viewMin, canned.render);
router.delete('/:id', requirePermission('tickets.delete'), ctrl.remove);

// Comments
router.get('/:id/comments', viewMin, ctrl.listComments);
router.post('/:id/comments', requirePermission('tickets.create'), ctrl.createComment);
router.patch('/:id/comments/:commentId', editMin, ctrl.updateComment);
router.delete('/:id/comments/:commentId', editMin, ctrl.removeComment);

// Attachments
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', editMin, upload.single('file'), verifyFileSignature, enforceMaxAttachmentSize, scanUpload('Ticket'), ctrl.createAttachment);
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
router.delete('/:id/watchers/contacts/:contactId', manageWatchers, ctrl.removeContactWatcher);
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

// Playbooks and devices (PB)
router.get('/:id/playbooks', viewMin, playbooks.view);
router.get('/:id/close-check', viewMin, playbooks.closeCheck);
router.get('/:id/playbooks/options', editMin, playbooks.options);
router.post('/:id/playbooks', editMin, playbooks.create);
router.post('/:id/checklists', editMin, playbooks.addChecklist);
router.delete('/:id/checklists/:formId', editMin, playbooks.removeChecklist);
router.delete('/:id/playbooks/:tpId', editMin, playbooks.remove);
router.post('/:id/playbook-suggestions/:suggestionId/dismiss', editMin, playbooks.dismissSuggestion);
router.post('/:id/devices/new', editMin, devices.createDevice);
router.post('/:id/devices', editMin, devices.link);
router.delete('/:id/devices/:assetId', editMin, devices.unlink);
router.get('/:id/forms/:formId', viewMin, ticketForms.get);
router.patch('/:id/forms/:formId', editMin, ticketForms.answer);
router.put('/:id/forms/:formId/secrets/:key', editMin, ticketForms.setSecret);
router.post('/:id/forms/:formId/secrets/:key/reveal', requirePermission('tickets.view_secure_fields'), secretRevealLimiter, ticketForms.reveal);
router.post('/:id/forms/:formId/skip', editMin, ticketForms.skip);
router.post('/:id/forms/:formId/action', editMin, ticketForms.action);
router.get('/:id/forms/:formId/pdf', viewMin, ticketForms.pdf);

// PDF report
router.get('/:id/report', viewMin, ctrl.generateReport);

module.exports = router;
