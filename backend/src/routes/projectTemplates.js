const express = require('express');
const ctrl = require('../controllers/projectTemplates');
const { requirePermission } = require('../middleware/requirePermission');

// Anyone who can create projects can use a template; only template managers
// change them. (Saving a project as a template is on the projects router.)
const router = express.Router();
const use = requirePermission('projects.create', 'projects.manage_templates');
const manage = requirePermission('projects.manage_templates');

router.get('/', use, ctrl.list);
router.post('/', manage, ctrl.create);
router.get('/:id', use, ctrl.get);
router.get('/:id/preview', use, ctrl.preview);
router.put('/:id', manage, ctrl.update);
router.delete('/:id', manage, ctrl.remove);

module.exports = router;
