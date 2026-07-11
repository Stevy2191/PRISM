const express = require('express');
const ctrl = require('../controllers/assetsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

const canView = requirePermission('assets.view');
const canCreate = requirePermission('assets.create');
const canEdit = requirePermission('assets.edit');
const canDelete = requirePermission('assets.delete');
const canLinkTickets = requirePermission('assets.link_tickets');

router.use(canView);

router.get('/categories', ctrl.listCategories);
router.get('/stats', ctrl.stats);

router.get('/', ctrl.list);
router.post('/', canCreate, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', canEdit, ctrl.update);
router.delete('/:id', canDelete, ctrl.remove);

router.get('/:id/tickets', ctrl.listTickets);
router.post('/:id/tickets', canLinkTickets, ctrl.linkTicket);
router.delete('/:id/tickets/:ticketId', canLinkTickets, ctrl.unlinkTicket);

router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
