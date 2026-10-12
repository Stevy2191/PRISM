// Ownership (user decisions 2026-10-11) is a mark on a System Administrator's
// account, not a role:
// - the owner (Users.ownerLevel 'owner'): exactly one, on a local account. Only
//   the owner marks secondary owners and hands ownership to someone else;
// - secondary owners ('secondary'): set by the owner, trusted with every other
//   owner power.
// Owner powers: making System Administrators, changing an administrator's
// account, and the sign-in, mail and integration settings. One rogue System
// Administrator can do none of these.
const {
  Role, UserRole, User, AuditLog, sequelize,
} = require('../models');
const { ApiError } = require('../middleware/error');
const { settleAccountRoles } = require('./accountRoles');
const { invalidateUserPermissions } = require('./permissionService');

const SYSTEM_ADMIN = 'System Administrator';
const HAND_ON = 'The owner\'s account stays: hand ownership to someone else first';

async function holdsSystemAdmin(user) {
  const role = await Role.findOne({ where: { name: SYSTEM_ADMIN, isSystemRole: true }, attributes: ['id'] });
  if (!role) return false;
  if (user.roleId === role.id) return true;
  return !!(await UserRole.findOne({ where: { userId: user.id, roleId: role.id }, attributes: ['userId'] }));
}

// Read fresh when the user object was loaded without the column.
async function ownerLevelOf(user) {
  if (user.ownerLevel !== undefined) return user.ownerLevel;
  return (await User.findByPk(user.id, { attributes: ['ownerLevel'] }))?.ownerLevel ?? null;
}

// Owner powers: the owner or a secondary owner.
const isOwner = async (user) => !!(await ownerLevelOf(user));
const isTheOwner = async (user) => (await ownerLevelOf(user)) === 'owner';

// System Administrator: handed out only by an owner, and never automatically
// (a department default, single sign-on).
const isTopRole = (role) => !!role && role.name === SYSTEM_ADMIN && role.isSystemRole !== false;

// An owner or a System Administrator (the legacy 'admin' role included).
async function isAdministrator(user) {
  return user.role === 'admin' || (await isOwner(user)) || holdsSystemAdmin(user);
}

async function assertOwner(actor, what) {
  if (!(await isOwner(actor))) throw new ApiError(403, `${what} needs an Owner`, 'OWNER_ONLY');
}

async function assertTheOwner(actor, what) {
  if (!(await isTheOwner(actor))) throw new ApiError(403, `${what} is for the owner only`, 'THE_OWNER_ONLY');
}

// Express middleware: the route needs owner powers.
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

// Changing someone's account when that someone is an administrator needs
// owner powers.
async function assertCanManageAccount(actor, target) {
  if (await isAdministrator(target)) await assertOwner(actor, 'Changing an administrator\'s account');
}

// A marked account keeps System Administrator (the mark means nothing
// without it), and the owner's account is never deleted.
async function assertKeepsSystemAdmin(target) {
  const level = await ownerLevelOf(target);
  if (level === 'owner') throw new ApiError(400, HAND_ON, 'THE_OWNER');
  if (level === 'secondary') throw new ApiError(400, 'Remove their secondary-owner mark first', 'OWNER_MARKED');
}
async function assertNotTheOwner(target) {
  if (await isTheOwner(target)) throw new ApiError(400, HAND_ON, 'THE_OWNER');
}

function assertCanBeOwner(target) {
  if (!target.isActive) throw new ApiError(400, 'The owner must be an active account', 'VALIDATION_ERROR');
  if (!target.isLocalAccount) {
    throw new ApiError(400, 'The owner must be a local account (not a directory or single sign-on one)', 'VALIDATION_ERROR');
  }
}

// Moves ownership to `target` in one transaction. `fromId`: the owner handing
// it on (checked to still be the owner, under a row lock, so two handovers
// can't both succeed); omitted for the server-side recovery.
async function moveOwnership(target, { fromId = null, transaction }) {
  const current = await User.findAll({ where: { ownerLevel: 'owner' }, lock: transaction.LOCK.UPDATE, transaction });
  if (fromId !== null && !current.some((u) => u.id === fromId)) {
    throw new ApiError(403, 'Handing over ownership is for the owner only', 'THE_OWNER_ONLY');
  }
  await User.update({ ownerLevel: null }, { where: { ownerLevel: 'owner' }, transaction });
  await User.update({ ownerLevel: 'owner' }, { where: { id: target.id }, transaction });
  [...current.map((u) => u.id), target.id].forEach(invalidateUserPermissions);
  return current.map((u) => u.username).join(', ') || null;
}

// The owner hands ownership to a local, active System Administrator.
async function handOverOwnership(actor, target) {
  await assertTheOwner(actor, 'Handing over ownership');
  if (target.id === actor.id) throw new ApiError(400, 'You are already the owner', 'VALIDATION_ERROR');
  if (!(await holdsSystemAdmin(target))) {
    throw new ApiError(400, 'Only a System Administrator can become the owner', 'VALIDATION_ERROR');
  }
  assertCanBeOwner(target);
  return sequelize.transaction((transaction) => moveOwnership(target, { fromId: actor.id, transaction }));
}

// Server-side recovery (`npm run owner:transfer -- <username>`), for when the
// owner's account is lost: anyone with the server can change the database
// anyway, so this opens nothing new. Makes the account a System
// Administrator if it isn't one, and audits the move.
async function recoverOwnership(username) {
  const target = await User.findOne({ where: { username } });
  if (!target) throw new Error(`No account with the username "${username}"`);
  try {
    assertCanBeOwner(target);
  } catch (err) {
    throw new Error(err.message);
  }
  const admin = await Role.findOne({ where: { name: SYSTEM_ADMIN, isSystemRole: true } });
  const from = await sequelize.transaction(async (transaction) => {
    if (admin && !(await UserRole.findOne({ where: { userId: target.id, roleId: admin.id }, transaction }))) {
      await UserRole.create({ userId: target.id, roleId: admin.id, assignedAt: new Date() }, { transaction });
    }
    await settleAccountRoles(target, { transaction });
    const previous = await moveOwnership(target, { transaction });
    await AuditLog.create({
      userId: null, action: 'owner.transfer', entityType: 'User', entityId: target.id,
      meta: { from: previous, to: target.username, via: 'server command' },
    }, { transaction });
    return previous;
  });
  return { from, to: target.username };
}

module.exports = {
  SYSTEM_ADMIN,
  isOwner,
  isTheOwner,
  isAdministrator,
  isTopRole,
  assertOwner,
  assertTheOwner,
  requireOwner,
  assertCanManageAccount,
  assertKeepsSystemAdmin,
  assertNotTheOwner,
  handOverOwnership,
  recoverOwnership,
};
