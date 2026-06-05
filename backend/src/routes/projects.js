const express = require('express');
const ctrl = require('../controllers/projectsController');
const { requireRole } = require('../middleware/role');

const router = express.Router();

const staff = requireRole('admin', 'technician');

// Projects
router.get('/', ctrl.list);
router.post('/', staff, ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', staff, ctrl.update);
router.delete('/:id', requireRole('admin'), ctrl.remove);

// Milestones (nested)
router.get('/:id/milestones', ctrl.listMilestones);
router.post('/:id/milestones', staff, ctrl.createMilestone);
router.patch('/:id/milestones/:milestoneId', staff, ctrl.updateMilestone);
router.delete('/:id/milestones/:milestoneId', staff, ctrl.removeMilestone);

module.exports = router;
