const express = require('express');
const ctrl = require('../controllers/customersController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.patch('/:id/department', requireRole('admin', 'technician'), ctrl.updateDepartment);

module.exports = router;
