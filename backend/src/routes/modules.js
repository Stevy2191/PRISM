const express = require('express');
const ctrl = require('../controllers/modulesController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.get('/', ctrl.list);
router.put('/', requireRole('admin'), ctrl.update);

module.exports = router;
