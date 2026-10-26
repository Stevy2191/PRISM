const express = require('express');
const ctrl = require('../controllers/workloadController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

// What it shows is cut to the viewer's own ticket and project scope (services/workload).
router.get('/', requirePermission('workload.view'), ctrl.get);

module.exports = router;
