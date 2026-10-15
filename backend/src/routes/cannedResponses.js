const express = require('express');
const ctrl = require('../controllers/cannedResponsesController');

// Any signed-in staff user: what each may see and change is decided per
// response in the controller (personal / team / everyone).
const router = express.Router();

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
