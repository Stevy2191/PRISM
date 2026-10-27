const express = require('express');
const ctrl = require('../../controllers/portal/ticketsController');
const {
  upload, enforceMaxAttachmentSize, verifyFileSignature, scanUpload,
} = require('../../middleware/upload');

// Mounted behind portalGuard (routes/portal/index.js). Every /:id route first
// checks the ticket is in the contact's scope (loadVisibleTicket).
const router = express.Router();

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.loadVisibleTicket, ctrl.get);
router.post('/:id/replies', ctrl.loadVisibleTicket, ctrl.reply);
router.post('/:id/attachments', ctrl.loadVisibleTicket, upload.single('file'), verifyFileSignature, enforceMaxAttachmentSize, scanUpload('Ticket'), ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.loadVisibleTicket, ctrl.downloadAttachment);

module.exports = router;
