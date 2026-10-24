const express = require('express');
const ctrl = require('../controllers/ticketCategoriesController');
const { requirePermission } = require('../middleware/requirePermission');

// The category tree is global and holds no client data: any staff user may
// read it. Every change needs tickets.categories.manage.
const router = express.Router();
const manage = requirePermission('tickets.categories.manage');

router.get('/', ctrl.list);
router.put('/settings', manage, ctrl.updateSettings);
router.post('/reorder', manage, ctrl.reorder);
router.post('/', manage, ctrl.create);
router.patch('/:id', manage, ctrl.update);
router.delete('/:id', manage, ctrl.remove);

module.exports = router;
