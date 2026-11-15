// Settings › Hours & SLAs › Starting values for new companies (CS): one set
// of SLA targets, support hours and holidays, copied when a company is made.
const express = require('express');
const ctrl = require('../controllers/companySlaController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
const manage = requirePermission('settings.manage_system');

router.get('/', manage, ctrl.getStart);
router.put('/', manage, ctrl.saveStart);
router.post('/holidays', manage, ctrl.addStartHoliday);
router.delete('/holidays/:holidayId', manage, ctrl.removeStartHoliday);

module.exports = router;
