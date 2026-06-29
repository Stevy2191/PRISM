const express = require('express');
const ctrl = require('../controllers/ticketsController');
const { requireRole } = require('../middleware/role');
const { upload } = require('../middleware/upload');

const router = express.Router();

const staff = requireRole('admin', 'technician');

// Tickets
router.get('/', ctrl.list);
router.post('/', ctrl.create); // requesters allowed (scoped in controller)
router.get('/:id', ctrl.get);
router.patch('/:id', ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);

// Comments
router.get('/:id/comments', ctrl.listComments);
router.post('/:id/comments', ctrl.createComment);
router.patch('/:id/comments/:commentId', ctrl.updateComment);
router.delete('/:id/comments/:commentId', ctrl.removeComment);

// Attachments
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', staff, upload.single('file'), ctrl.createAttachment);
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

// CSAT (requester submits; anyone who can view the ticket can read)
router.get('/:id/csat', ctrl.getCsat);
router.post('/:id/csat', ctrl.submitCsat);

module.exports = router;
