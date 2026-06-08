const { Team, TeamMember, User, Department, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const include = [
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  {
    model: TeamMember,
    as: 'memberships',
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'email'] }],
  },
];

// Replace a team's members from an array of { userId, isLead }.
async function syncMembers(teamId, members, t) {
  await TeamMember.destroy({ where: { teamId }, transaction: t });
  const rows = (members || [])
    .filter((m) => m && m.userId)
    .map((m) => ({ teamId, userId: m.userId, isLead: !!m.isLead }));
  if (rows.length) await TeamMember.bulkCreate(rows, { transaction: t, ignoreDuplicates: true });
}

// GET /teams — all authenticated users
const list = asyncHandler(async (req, res) => {
  const teams = await Team.findAll({ include, order: [['name', 'ASC']] });
  res.json({ teams });
});

// GET /teams/:id
const get = asyncHandler(async (req, res) => {
  const team = await Team.findByPk(req.params.id, { include });
  if (!team) throw new ApiError(404, 'Team not found', 'NOT_FOUND');
  res.json({ team });
});

// POST /teams — Admin
const create = asyncHandler(async (req, res) => {
  const { name, description, departmentId, members } = req.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'Team name is required', 'VALIDATION_ERROR');

  const team = await sequelize.transaction(async (t) => {
    const created = await Team.create(
      { name: name.trim(), description: description || null, departmentId: departmentId || null },
      { transaction: t }
    );
    await syncMembers(created.id, members, t);
    return created;
  });
  await writeAudit(req, 'team.create', 'Team', team.id, { name: team.name });

  const fresh = await Team.findByPk(team.id, { include });
  res.status(201).json({ team: fresh });
});

// PATCH /teams/:id — Admin
const update = asyncHandler(async (req, res) => {
  const team = await Team.findByPk(req.params.id);
  if (!team) throw new ApiError(404, 'Team not found', 'NOT_FOUND');

  const { name, description, departmentId, members } = req.body || {};
  await sequelize.transaction(async (t) => {
    const changes = {};
    if (name !== undefined) changes.name = name.trim();
    if (description !== undefined) changes.description = description;
    if (departmentId !== undefined) changes.departmentId = departmentId || null;
    await team.update(changes, { transaction: t });
    if (members !== undefined) await syncMembers(team.id, members, t);
  });
  await writeAudit(req, 'team.update', 'Team', team.id, { name: team.name });

  const fresh = await Team.findByPk(team.id, { include });
  res.json({ team: fresh });
});

// DELETE /teams/:id — Admin
const remove = asyncHandler(async (req, res) => {
  const team = await Team.findByPk(req.params.id);
  if (!team) throw new ApiError(404, 'Team not found', 'NOT_FOUND');
  await team.destroy();
  await writeAudit(req, 'team.delete', 'Team', team.id, { name: team.name });
  res.json({ ok: true });
});

module.exports = { list, get, create, update, remove };
