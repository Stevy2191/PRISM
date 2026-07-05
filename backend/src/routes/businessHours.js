const express = require('express');
const ctrl = require('../controllers/businessHoursController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const admin = requirePermission('settings.manage_business_hours');

router.get('/', ctrl.list);
router.post('/', admin, ctrl.create);
router.post('/:id/clone', admin, ctrl.clone);
router.patch('/:id', admin, ctrl.update);
router.delete('/:id', admin, ctrl.remove);

module.exports = router;
