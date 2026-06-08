const express = require('express');
const ctrl = require('../controllers/businessHoursController');
const { requireRole } = require('../middleware/role');

const router = express.Router();
const admin = requireRole('admin');

router.get('/', ctrl.list);
router.post('/', admin, ctrl.create);
router.patch('/:id', admin, ctrl.update);
router.delete('/:id', admin, ctrl.remove);

module.exports = router;
