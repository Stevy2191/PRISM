const express = require('express');
const ctrl = require('../controllers/customFieldsController');
const { requireRole } = require('../middleware/role');

const router = express.Router();
const admin = requireRole('admin');

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', admin, ctrl.create);
router.patch('/:id', admin, ctrl.update);
router.delete('/:id', admin, ctrl.remove);

module.exports = router;
