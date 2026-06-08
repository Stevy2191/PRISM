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

// Project time (logging is staff-only)
router.get('/:id/time', ctrl.listTime);
router.post('/:id/time', staff, ctrl.createTime);
router.delete('/:id/time/:entryId', ctrl.removeTime);

module.exports = router;
