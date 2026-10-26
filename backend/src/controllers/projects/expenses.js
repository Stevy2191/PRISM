// Project expenses: list, add, edit, delete.
const { Project, Task, ProjectExpense, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const { parsePagination, paginated } = require('../../utils/pagination');
const { canAccessProject } = require('../../services/permissionService');
const {
  SUBLIST_LIMIT, SUBLIST_MAX, userAttrs, resolveProjectTaskId,
  assertCanEditProject,
} = require('./shared');
const { orgToday } = require('../../utils/orgTime');

// ==================== Expenses ====================

const expenseInclude = [
  { model: User, as: 'loggedByUser', attributes: userAttrs },
  { model: Task, as: 'task', attributes: ['id', 'title', 'code'] },
];

// GET /projects/:id/expenses
const listExpenses = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const { page, limit, offset } = parsePagination(req, { defaultLimit: SUBLIST_LIMIT, maxLimit: SUBLIST_MAX });
  const { rows, count } = await ProjectExpense.findAndCountAll({
    where: { projectId: project.id },
    include: expenseInclude,
    order: [['entryDate', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });
  // Named `totalAmount`, not `total` — `total` is the row count that every
  // paginated response carries, and the money sum would otherwise clobber it.
  const totalAmount = Number(await ProjectExpense.sum('amount', { where: { projectId: project.id } })) || 0;
  res.json({ ...paginated('expenses', { rows, count }, { page, limit }), totalAmount });
});

// POST /projects/:id/expenses
const createExpense = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  await assertCanEditProject(req.user, project);

  const { description, amount, category, entryDate, taskId } = req.body || {};
  if (!description || !description.trim()) throw new ApiError(400, 'Description is required', 'VALIDATION_ERROR');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw new ApiError(400, 'Amount must be a non-negative number', 'VALIDATION_ERROR');

  const expense = await ProjectExpense.create({
    projectId: project.id,
    taskId: await resolveProjectTaskId(project, taskId),
    description: description.trim(),
    amount: amt,
    category: category || 'other',
    entryDate: entryDate || await orgToday(),
    loggedBy: req.user.id,
  });
  await writeAudit(req, 'expense.create', 'ProjectExpense', expense.id, { projectId: project.id, description: expense.description, amount: amt });
  await logProjectActivity(project.id, req.user.id, 'expense_added', { expenseId: expense.id, description: expense.description, amount: amt });

  const fresh = await ProjectExpense.findByPk(expense.id, { include: expenseInclude });
  res.status(201).json({ expense: fresh });
});

// PATCH /projects/:id/expenses/:expenseId
const updateExpense = asyncHandler(async (req, res) => {
  const expense = await ProjectExpense.findOne({ where: { id: req.params.expenseId, projectId: req.params.id } });
  if (!expense) throw new ApiError(404, 'Expense not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await assertCanEditProject(req.user, project);

  const allowed = ['description', 'amount', 'category', 'entryDate', 'taskId'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  // Edits run the create validation (Q33).
  if (changes.description !== undefined) {
    if (typeof changes.description !== 'string' || !changes.description.trim()) throw new ApiError(400, 'Description is required', 'VALIDATION_ERROR');
    changes.description = changes.description.trim();
  }
  if (changes.amount !== undefined) {
    const amt = changes.amount === null || changes.amount === '' ? NaN : Number(changes.amount);
    if (!Number.isFinite(amt) || amt < 0) throw new ApiError(400, 'Amount must be a non-negative number', 'VALIDATION_ERROR');
    changes.amount = amt;
  }
  if (changes.taskId !== undefined) changes.taskId = await resolveProjectTaskId(project, changes.taskId);
  await expense.update(changes);
  await writeAudit(req, 'expense.update', 'ProjectExpense', expense.id, { projectId: project.id, ...changes });
  const fresh = await ProjectExpense.findByPk(expense.id, { include: expenseInclude });
  res.json({ expense: fresh });
});

// DELETE /projects/:id/expenses/:expenseId
const removeExpense = asyncHandler(async (req, res) => {
  const expense = await ProjectExpense.findOne({ where: { id: req.params.expenseId, projectId: req.params.id } });
  if (!expense) throw new ApiError(404, 'Expense not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  await assertCanEditProject(req.user, project);
  await expense.destroy();
  await writeAudit(req, 'expense.delete', 'ProjectExpense', expense.id, { projectId: project.id, description: expense.description, amount: expense.amount });
  res.json({ ok: true });
});

module.exports = {
  listExpenses,
  createExpense,
  updateExpense,
  removeExpense,
};
