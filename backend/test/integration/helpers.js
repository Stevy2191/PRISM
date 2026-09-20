// Shared setup for integration tests. These run against a real MariaDB schema
// (prism_test, migrated by `npm run test:migrate`) and drive the real Express
// app through supertest — no mocking of the authorization stack, since that
// stack is exactly what these tests exist to verify.
const bcrypt = require('bcryptjs');
const request = require('supertest');

const { createApp, createSessionStore } = require('../../src/app');
const sequelize = require('../../src/config/database');
const models = require('../../src/models');
const { invalidateAllPermissions } = require('../../src/services/permissionService');
const { resetRateLimits } = require('../../src/middleware/rateLimit');

const {
  User, UserRole, Role, Department, Contact, Ticket, Comment,
  SsoProvider, SsoIdentity, SsoGroupMapping, SsoAuthRequest,
} = models;

// Seeded system roles created by the migrations.
const ROLE = {
  ADMIN: 'System Administrator',
  TECHNICIAN: 'System Technician',
  DEPARTMENT_MANAGER: 'Department Manager',
  DEPARTMENT_STAFF: 'Department Staff',
  READ_ONLY: 'Read Only',
};

let app;
let sessionStore;

function getApp() {
  if (!app) {
    sessionStore = createSessionStore();
    app = createApp({ sessionStore });
  }
  return app;
}

// The Sessions table is created at server startup by index.js, which tests
// never run — so create it here before the first request needs it.
async function ensureSchema() {
  getApp();
  await sessionStore.sync();
}

async function roleIdByName(name) {
  const role = await Role.findOne({ where: { name } });
  if (!role) throw new Error(`Seeded role "${name}" not found — are migrations applied to prism_test?`);
  return role.id;
}

// Creates a local account holding exactly one granular role. `legacyRole`
// stays 'technician' on purpose for non-admins: that is the real-world state
// the authorization tests care about, since every non-admin account carries
// it and it used to be enough to pass the old requireRole() gates.
async function createUser({
  username,
  password = 'IntegrationPass!2026',
  roleName = ROLE.READ_ONLY,
  legacyRole = 'technician',
  departmentId = null,
}) {
  const roleId = await roleIdByName(roleName);
  const user = await User.create({
    username,
    displayName: `Test ${username}`,
    role: legacyRole,
    roleId,
    departmentId,
    isLocalAccount: true,
    isActive: true,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4), // low cost: tests, not storage
  });
  await UserRole.destroy({ where: { userId: user.id } });
  await UserRole.create({ userId: user.id, roleId, assignedAt: new Date() });
  invalidateAllPermissions();
  return { user, password };
}

// Returns a supertest agent that has completed login and holds the cookie.
async function login(username, password) {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

async function createUserAndLogin(options) {
  const { user, password } = await createUser(options);
  const agent = await login(options.username, password);
  return { user, agent, password };
}

// Truncating rather than dropping keeps the migrated schema intact between
// suites. Order matters only for the tables with foreign keys between them,
// so checks are disabled for the duration.
async function resetData() {
  await ensureSchema();
  const tables = [
    'Comments', 'Attachments', 'TicketWatchers', 'TicketTasks', 'TicketActivities',
    'TicketRelations', 'TimeEntries', 'Tickets', 'Contacts',
    // Project child tables truncate with Projects: TRUNCATE resets
    // AUTO_INCREMENT, so a project created by the next test reuses id 1 and
    // would otherwise inherit the previous test's expenses/time/materials.
    'ProjectExpenses', 'ProjectMaterials', 'ProjectTimeEntries',
    'ProjectMembers', 'ProjectSubtasks', 'ProjectTasks', 'Projects',
    'SsoAuthRequests', 'SsoGroupMappings', 'SsoIdentities', 'SsoProviders',
    'UserRoles', 'UserPermissionOverrides', 'ApiKeys', 'Sessions', 'Users', 'Departments',
  ];
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    // Some tables only exist on newer schemas; skipping a missing one is fine.
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(`TRUNCATE TABLE \`${table}\``).catch(() => {});
  }
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  // SystemSettings is not truncated (migrations seed rows other code relies
  // on), but settings a test flips must not leak into the next one — SSO
  // enforcement in particular would fail every subsequent login.
  await sequelize.query("DELETE FROM SystemSettings WHERE `key` LIKE 'sso.%'").catch(() => {});
  invalidateAllPermissions();
  // Otherwise one case's login attempts rate-limit the next.
  resetRateLimits();
}

async function closeDb() {
  await sequelize.close();
}

module.exports = {
  getApp, ensureSchema, createUser, createUserAndLogin, login, resetData, closeDb, roleIdByName,
  ROLE, models, sequelize,
  Department, Contact, Ticket, Comment, User, UserRole, Role,
  SsoProvider, SsoIdentity, SsoGroupMapping, SsoAuthRequest,
};
