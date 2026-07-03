const express = require('express');
const ctrl = require('../controllers/savedFiltersController');

const router = express.Router();

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
