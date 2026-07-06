const { ModuleVisibility } = require('../models');
const { asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');

const ROLES = ['admin', 'technician'];

// GET /modules — any authenticated user (sidebar reads this).
const list = asyncHandler(async (req, res) => {
  const modules = await ModuleVisibility.findAll({ order: [['id', 'ASC']] });
  res.json({ modules });
});

// PUT /modules — Admin. Body: { modules: [{ moduleName, visibleToRoles }] }
const update = asyncHandler(async (req, res) => {
  const incoming = (req.body && req.body.modules) || [];
  for (const m of incoming) {
    if (!m.moduleName) continue;
    const roles = Array.isArray(m.visibleToRoles)
      ? m.visibleToRoles.filter((r) => ROLES.includes(r))
      : [];
    const row = await ModuleVisibility.findOne({ where: { moduleName: m.moduleName } });
    if (row) {
      await row.update({ visibleToRoles: roles });
    } else {
      await ModuleVisibility.create({ moduleName: m.moduleName, visibleToRoles: roles });
    }
  }
  await writeAudit(req, 'modules.update', 'ModuleVisibility', null, { count: incoming.length });
  const modules = await ModuleVisibility.findAll({ order: [['id', 'ASC']] });
  res.json({ modules });
});

module.exports = { list, update };
