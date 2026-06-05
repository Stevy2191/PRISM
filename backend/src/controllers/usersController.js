const { User, Department } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const userInclude = [{ model: Department, as: 'department' }];

// GET /users — Admin only
const list = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    include: userInclude,
    order: [['displayName', 'ASC']],
  });
  res.json({ users });
});

// GET /users/:id — self or admin
const get = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new ApiError(403, 'You may only view your own profile', 'FORBIDDEN');
  }
  const user = await User.findByPk(id, { include: userInclude });
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');
  res.json({ user });
});

// PATCH /users/:id — Admin only (role, department)
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  const { role, departmentId } = req.body || {};
  const changes = {};

  if (role !== undefined) {
    if (!['admin', 'technician', 'requester'].includes(role)) {
      throw new ApiError(400, 'Invalid role', 'VALIDATION_ERROR');
    }
    changes.role = role;
  }
  if (departmentId !== undefined) {
    if (departmentId !== null) {
      const dept = await Department.findByPk(departmentId);
      if (!dept) throw new ApiError(400, 'Department does not exist', 'VALIDATION_ERROR');
    }
    changes.departmentId = departmentId;
  }

  await user.update(changes);
  await writeAudit(req, 'user.update', 'User', user.id, changes);

  const fresh = await User.findByPk(id, { include: userInclude });
  res.json({ user: fresh });
});

// DELETE /users/:id — Admin only
const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    throw new ApiError(400, 'You cannot delete your own account', 'SELF_DELETE');
  }
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND');

  await user.destroy();
  await writeAudit(req, 'user.delete', 'User', id, { username: user.username });
  res.json({ ok: true });
});

module.exports = { list, get, update, remove };
