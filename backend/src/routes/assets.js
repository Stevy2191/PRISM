const express = require('express');
const ctrl = require('../controllers/assetsController');
const categoriesCtrl = require('../controllers/assetCategoriesController');
const { requirePermission } = require('../middleware/requirePermission');
const { assetUpload } = require('../middleware/upload');

const router = express.Router();

const canView = requirePermission('assets.view');
const canCreate = requirePermission('assets.create');
const canEdit = requirePermission('assets.edit');
const canDelete = requirePermission('assets.delete');
const canLinkTickets = requirePermission('assets.link_tickets');
const canManageCategories = requirePermission('settings.manage_system');

router.use(canView);

// Settings -> Asset Categories management — must be registered before the
// plain '/categories' + generic '/:id' routes below so Express doesn't try
// to match e.g. 'manage' or 'reorder' as a :categoryId/:fieldId param.
router.get('/categories/manage', canManageCategories, categoriesCtrl.list);
router.post('/categories', canManageCategories, categoriesCtrl.create);
router.get('/categories/:categoryId/fields', canManageCategories, categoriesCtrl.listFields);
router.post('/categories/:categoryId/fields', canManageCategories, categoriesCtrl.createField);
router.patch('/categories/:categoryId/fields/reorder', canManageCategories, categoriesCtrl.reorderFields);
router.patch('/categories/:categoryId/fields/:fieldId', canManageCategories, categoriesCtrl.updateField);
router.delete('/categories/:categoryId/fields/:fieldId', canManageCategories, categoriesCtrl.removeField);
router.get('/categories/:categoryId', canManageCategories, categoriesCtrl.get);
router.patch('/categories/:categoryId', canManageCategories, categoriesCtrl.update);
router.delete('/categories/:categoryId', canManageCategories, categoriesCtrl.remove);

router.get('/categories', ctrl.listCategories);
router.get('/stats', ctrl.stats);
router.get('/expiry-summary', ctrl.expirySummary);

router.get('/', ctrl.list);
router.post('/', canCreate, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', canEdit, ctrl.update);
router.delete('/:id', canDelete, ctrl.remove);

router.get('/:id/tickets', ctrl.listTickets);
router.post('/:id/tickets', canLinkTickets, ctrl.linkTicket);
router.delete('/:id/tickets/:ticketId', canLinkTickets, ctrl.unlinkTicket);

router.get('/:id/activity', ctrl.listActivity);

router.get('/:id/checkouts', ctrl.listCheckouts);
router.post('/:id/checkouts', canEdit, ctrl.createCheckout);
router.patch('/:id/checkouts/:checkoutId', canEdit, ctrl.updateCheckout);
router.post('/:id/checkouts/:checkoutId/check-in', canEdit, ctrl.checkInCheckout);
router.post('/:id/checkouts/:checkoutId/send-form', canEdit, ctrl.sendCheckoutForm);

router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', canEdit, assetUpload.single('file'), ctrl.createAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', canEdit, ctrl.removeAttachment);

module.exports = router;
