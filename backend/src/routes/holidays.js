const express = require('express');
const ctrl = require('../controllers/holidaysController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const admin = requirePermission('settings.manage_business_hours');

router.get('/', ctrl.list);
router.post('/', admin, ctrl.create);
router.patch('/:id', admin, ctrl.update);
router.delete('/:id', admin, ctrl.remove);
router.post('/:id/holidays', admin, ctrl.addHoliday);
router.delete('/:id/holidays/:holidayId', admin, ctrl.removeHoliday);

module.exports = router;
