const express = require('express');
const ctrl = require('../controllers/ticketCategoriesController');
const { requirePermission } = require('../middleware/requirePermission');

// Each company's category tree (9). Reading follows company access (the
// controller); every change needs tickets.categories.manage and the company
// in reach.
const router = express.Router();
const manage = requirePermission('tickets.categories.manage');

router.get('/', ctrl.list);
router.put('/settings', manage, ctrl.updateSettings);
router.post('/reorder', manage, ctrl.reorder);
router.post('/', manage, ctrl.create);
router.patch('/:id', manage, ctrl.update);
router.delete('/:id', manage, ctrl.remove);

module.exports = router;
