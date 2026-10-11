// The Owner (user decision 2026-10-11): the top role. One rogue System
// Administrator can't make administrators, change an administrator's account,
// or change sign-in, mail and integration settings — those need an Owner.
const { Role, UserRole } = require('../models');
const { ApiError } = require('../middleware/error');

const OWNER = 'Owner';
const SYSTEM_ADMIN = 'System Administrator';

async function holdsSystemRole(user, name) {
  const role = await Role.findOne({ where: { name, isSystemRole: true }, attributes: ['id'] });
  if (!role) return false;
  if (user.roleId === role.id) return true;
  return !!(await UserRole.findOne({ where: { userId: user.id, roleId: role.id }, attributes: ['userId'] }));
}

const isOwner = (user) => holdsSystemRole(user, OWNER);

// An Owner or a System Administrator (the legacy 'admin' role included).
async function isAdministrator(user) {
  return user.role === 'admin' || (await isOwner(user)) || holdsSystemRole(user, SYSTEM_ADMIN);
}

async function assertOwner(actor, what) {
  if (!(await isOwner(actor))) throw new ApiError(403, `${what} needs an Owner`, 'OWNER_ONLY');
}

// Express middleware: the route needs an Owner.
function requireOwner(what) {
  return async (req, res, next) => {
    try {
      await assertOwner(req.user, what);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  OWNER, SYSTEM_ADMIN, isOwner, isAdministrator, assertOwner, requireOwner,
};
