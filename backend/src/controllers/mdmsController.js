// The MDMs an install uses (Playbooks, PB, task 3). Each install keeps its
// own list; nothing is built in. There is no delete: retiring an MDM
// (isActive false) keeps it on the devices that have it.
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { Mdm, Asset, sequelize } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { parseRecordId } = require('../services/permissionService');
const { cleanConsoleUrl } = require('../services/assets/management');

function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new ApiError(400, 'Give the MDM a name', 'VALIDATION_ERROR');
  if (name.length > 100) throw new ApiError(400, 'The name is longer than 100 characters', 'VALIDATION_ERROR');
  return name;
}

async function assertNameFree(name, excludeId) {
  const clash = await Mdm.findOne({
    where: {
      [Op.and]: [sqlWhere(fn('LOWER', col('name')), name.toLowerCase())],
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
  if (clash) throw new ApiError(409, 'An MDM with this name already exists', 'DUPLICATE_NAME');
}

async function withCounts(mdms) {
  const counts = await Asset.findAll({
    attributes: ['mdmId', [fn('COUNT', col('id')), 'n']],
    where: { mdmId: mdms.map((m) => m.id) },
    group: ['mdmId'],
    raw: true,
  });
  const byId = new Map(counts.map((c) => [c.mdmId, Number(c.n)]));
  return mdms.map((m) => ({ ...m.toJSON(), deviceCount: byId.get(m.id) || 0 }));
}

// GET /mdms
const list = asyncHandler(async (req, res) => {
  const mdms = await Mdm.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] });
  res.json({ mdms: await withCounts(mdms) });
});

// POST /mdms { name, consoleUrl? }
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = cleanName(body.name);
  await assertNameFree(name);
  const position = (await Mdm.max('position')) || 0;
  const mdm = await Mdm.create({ name, consoleUrl: cleanConsoleUrl(body.consoleUrl), position: position + 1 });
  await writeAudit(req, 'mdm.create', 'Mdm', mdm.id, { name });
  res.status(201).json({ mdm: (await withCounts([mdm]))[0] });
});

// PATCH /mdms/:id { name?, consoleUrl?, isActive? }
const update = asyncHandler(async (req, res) => {
  const mdm = await Mdm.findByPk(parseRecordId(req.params.id) || 0);
  if (!mdm) throw new ApiError(404, 'MDM not found', 'NOT_FOUND');
  const body = req.body || {};
  const changes = {};
  if (body.name !== undefined) {
    changes.name = cleanName(body.name);
    await assertNameFree(changes.name, mdm.id);
  }
  if (body.consoleUrl !== undefined) changes.consoleUrl = cleanConsoleUrl(body.consoleUrl);
  if (body.isActive !== undefined) changes.isActive = body.isActive === true || body.isActive === 'true';
  await mdm.update(changes);
  await writeAudit(req, 'mdm.update', 'Mdm', mdm.id, changes);
  res.json({ mdm: (await withCounts([mdm]))[0] });
});

// POST /mdms/reorder { ids: [...] }: every MDM, in the new order.
const reorder = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(parseRecordId) : [];
  const all = await Mdm.findAll({ attributes: ['id'] });
  if (ids.length !== all.length || ids.some((id) => !id) || new Set(ids).size !== ids.length
      || !all.every((m) => ids.includes(m.id))) {
    throw new ApiError(400, 'Send every MDM once, in the new order', 'VALIDATION_ERROR');
  }
  await sequelize.transaction(async (transaction) => {
    for (const [i, id] of ids.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await Mdm.update({ position: i + 1 }, { where: { id }, transaction });
    }
  });
  await writeAudit(req, 'mdm.reorder', 'Mdm', null, { ids });
  res.json({ mdms: await withCounts(await Mdm.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] })) });
});

module.exports = {
  list, create, update, reorder,
};
