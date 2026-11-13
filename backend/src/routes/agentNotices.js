const express = require('express');
const ctrl = require('../controllers/agentNoticesController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();
// Staff who run the agent rollout or the client portal.
const can = requirePermission('devices.manage', 'portal.manage');

router.get('/', can, ctrl.list);
router.post('/', can, ctrl.create);
router.delete('/:id', can, ctrl.remove);

module.exports = router;
