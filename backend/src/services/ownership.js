// The Owner (user decision 2026-10-11): the top role. One rogue System
// Administrator can't make administrators, change an administrator's account,
// or change sign-in, mail and integration settings — those need an Owner.
const { Role, UserRole, sequelize } = require('../models');
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

// Changing someone's account when that someone is an administrator (an Owner
// or a System Administrator) needs an Owner.
async function assertCanManageAccount(actor, target) {
  if (await isAdministrator(target)) await assertOwner(actor, 'Changing an administrator\'s account');
}

// Removing an Owner (their Owner role, or the account) must leave another
// active Owner.
async function assertKeepsAnOwner(targetUserId) {
  const role = await Role.findOne({ where: { name: OWNER, isSystemRole: true }, attributes: ['id'] });
  if (!role) return;
  const [{ n }] = await sequelize.query(`SELECT COUNT(DISTINCT u.id) AS n FROM Users u
    WHERE u.isActive = 1 AND u.id <> :target
      AND (u.roleId = :role OR EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.userId = u.id AND ur.roleId = :role))`,
  { replacements: { target: targetUserId, role: role.id }, type: sequelize.QueryTypes.SELECT });
  if (!Number(n)) throw new ApiError(400, 'There must always be an Owner: make someone else an Owner first', 'LAST_OWNER');
}

module.exports = {
  OWNER, SYSTEM_ADMIN, isOwner, isAdministrator, assertOwner, requireOwner, assertCanManageAccount, assertKeepsAnOwner,
};
