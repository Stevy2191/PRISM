const express = require('express');
const ctrl = require('../controllers/contactsController');
const importCtrl = require('../controllers/contactImportController');
const { requirePermission } = require('../middleware/requirePermission');
const { csvUpload } = require('../middleware/upload');

const router = express.Router();

const viewMin = requirePermission('people.view_own_department', 'people.view_all');
const editMin = requirePermission('tickets.create', 'people.edit_users');
const deleteMin = requirePermission('people.edit_users');

// Import routes precede /:id so they aren't captured as a numeric id param.
router.get('/import/sample', editMin, importCtrl.sample);
router.post('/import/parse', editMin, csvUpload.single('file'), importCtrl.parseUpload);
router.post('/import/validate', editMin, importCtrl.validate);
router.post('/import', editMin, importCtrl.commit);

router.get('/', viewMin, ctrl.list);
router.post('/', editMin, ctrl.create);
router.get('/:id', viewMin, ctrl.get);
router.patch('/:id', editMin, ctrl.update);
router.patch('/:id/department', editMin, ctrl.assignDepartment);
router.delete('/:id', deleteMin, ctrl.remove);
router.get('/:id/tickets', viewMin, ctrl.listTickets);
router.get('/:id/activity', viewMin, ctrl.listActivity);

module.exports = router;
