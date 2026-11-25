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
  extraRoles = [],
  ownerLevel = null,
}) {
  const roleId = await roleIdByName(roleName);
  const user = await User.create({
    username,
    displayName: `Test ${username}`,
    role: legacyRole,
    roleId,
    departmentId,
    ownerLevel,
    isLocalAccount: true,
    isActive: true,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash(password, 4), // low cost: tests, not storage
  });
  await UserRole.destroy({ where: { userId: user.id } });
  await UserRole.create({ userId: user.id, roleId, assignedAt: new Date() });
  for (const name of extraRoles) {
    // eslint-disable-next-line no-await-in-loop
    await UserRole.create({ userId: user.id, roleId: await roleIdByName(name), assignedAt: new Date() });
  }
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
// Response targets as migrated; no resolution targets, so tickets in
// suites that aren't about SLAs keep manual due dates (an SLA resolution
// target sets and locks the due date). SLA suites set the targets they use.
const SLA_SEED = {
  critical: [60, null, false], high: [240, null, true], medium: [480, null, true], low: [1440, null, true],
};
async function resetSlaPolicies() {
  require('../../src/services/sla/calendar').invalidate(); // eslint-disable-line global-require
  // Before 091 (a round-trip test rolled it back) policies were shared.
  const [own] = await sequelize.query("SHOW COLUMNS FROM SlaPolicies LIKE 'companyId'").catch(() => [[]]);
  const [rows] = await sequelize.query(own.length
    ? 'SELECT id FROM SlaPolicies WHERE companyId IS NULL ORDER BY isDefault DESC, id ASC'
    : 'SELECT id FROM SlaPolicies WHERE isDefault = 1').catch(() => [[]]);
  if (!rows.length) return;
  const stdId = rows[0].id;
  if (own.length) {
    // The starting values, as migrated; then your company's own copy of them.
    await sequelize.query('DELETE FROM SlaPolicies WHERE id <> ? AND (companyId IS NULL OR companyId NOT IN (SELECT id FROM Companies WHERE isInternal = 1))', { replacements: [stdId] });
    await sequelize.query("UPDATE SlaPolicies SET name = 'Starting values', isDefault = 1, warnAtPercent = 75, timezone = 'UTC', is24x7 = 1, schedule = NULL WHERE id = ?", { replacements: [stdId] });
    await sequelize.query('DELETE FROM Holidays WHERE slaPolicyId = ?', { replacements: [stdId] });
  } else {
    await sequelize.query('UPDATE Companies SET slaPolicyId = NULL').catch(() => {});
    await sequelize.query('DELETE FROM SlaPolicies WHERE id <> ?', { replacements: [stdId] });
    await sequelize.query("UPDATE SlaPolicies SET name = 'Standard', businessHoursId = NULL, warnAtPercent = 75 WHERE id = ?", { replacements: [stdId] }).catch(() => {});
  }
  // Units only exist from migration 061 on (a test may have rolled it back).
  await sequelize.query("UPDATE SlaTargets SET assignUnit = 'minutes', responseUnit = 'minutes', resolutionUnit = 'minutes' WHERE slaPolicyId = ?", { replacements: [stdId] }).catch(() => {});
  for (const [priority, [resp, resol, biz]] of Object.entries(SLA_SEED)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      'UPDATE SlaTargets SET assignMinutes = NULL, responseMinutes = ?, resolutionMinutes = ?, useBusinessHours = ? WHERE slaPolicyId = ? AND priority = ?',
      { replacements: [resp, resol, biz, stdId, priority] }
    );
  }
  if (own.length) {
    // eslint-disable-next-line global-require
    const companySla = require('../../src/services/sla/companySla');
    const internal = await models.Company.findOne({ where: { isInternal: true } });
    if (internal) {
      const row = await models.SlaPolicy.findOne({ where: { companyId: internal.id } });
      if (row) await companySla.resetToStartingValues(row);
      else await companySla.ensureCompanySla(internal);
    }
  }
}

async function resetData() {
  await ensureSchema();
  const tables = [
    'Comments', 'Attachments', 'TicketWatchers', 'PortalTokens', 'CompanyPortalAdmins', 'DepartmentPortalAdmins', 'KbArticleAudiences', 'TicketCcs', 'EmailTemplates', 'EmailProcessingLogs', 'TaskDependencies', 'TaskAssignees', 'Tasks', 'TicketActivities',
    'TicketRelations', 'TicketFieldValues', 'TimeEntries', 'ActiveTimers',
    'CannedResponses', 'RecurringTickets',
    'TicketFormSecrets', 'TicketForms', 'TicketPlaybookSuggestions', 'TicketPlaybooks',
    'CsatSurveys', 'CsatResponses', 'AssetTickets', 'Notifications', 'TicketSlas', 'TicketDueDateChanges', 'Tickets', 'Contacts',
    // Project child tables truncate with Projects: TRUNCATE resets
    // AUTO_INCREMENT, so a project created by the next test reuses id 1 and
    // would otherwise inherit the previous test's expenses/time/materials.
    'ProjectExpenses', 'ProjectMaterials', 'ProjectFiles',
    'ProjectActivities', 'ProjectMembers',
    'ProjectIdSequences', 'ProjectContacts', 'ProjectPhases', 'Projects',
    'ProjectTemplateDependencies', 'ProjectTemplateTasks', 'ProjectTemplatePhases', 'ProjectTemplates',
    'WorkflowRuleLogs', 'WorkflowActions', 'WorkflowConditions', 'WorkflowRules',
    'CustomFields', 'TicketCategories', 'CompanyCatalogItems', 'LedgerLines', 'LedgerEntries', 'CompanyBilling', 'TaxRates', 'CatalogProducts', 'TeamMembers', 'Teams',
    'AuditLogs', 'SystemAuditLogs',
    'Sites', 'CompanyDomains', 'UserCompanyAccess', 'RoleCompanyAccess',
    'OAuthConnections', 'OAuthRequests', 'OAuthClients',
    'SsoAuthRequests', 'SsoGroupMappings', 'SsoIdentities', 'SsoProviders',
    'AgentNotices', 'AgentUserLinks', 'UserRoles', 'UserPermissionOverrides', 'UserPreferences', 'ApiKeys', 'Sessions', 'Users', 'Departments',
  ];
  // Foreign key checks are off per statement, not with SET on "the"
  // connection: the pool hands each query whichever connection is free, so
  // while the app is also answering a browser's requests the SET and the
  // TRUNCATE could land on different ones (and the table kept its rows).
  const unchecked = 'SET STATEMENT foreign_key_checks = 0 FOR';
  for (const table of tables) {
    // Some tables only exist on newer schemas; skipping a missing one is fine.
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(`${unchecked} TRUNCATE TABLE \`${table}\``).catch(() => {});
  }
  // Asset, license and contract records are emptied with DELETE: a TRUNCATE
  // costs a table rebuild even when empty, and these tables are empty for
  // nearly every test. Their ids don't restart, which no test relies on.
  // Asset categories (and their field definitions) can be seeded, so they stay.
  const deleted = [
    'AssetFieldValues', 'AssetCheckouts', 'AssetAttachments', 'AssetActivity', 'Assets',
    'LicenseAssets', 'LicenseContacts', 'LicenseAttachments', 'LicenseActivity', 'LicenseTickets', 'Licenses',
    'ContractAssets', 'ContractAttachments', 'ContractActivity', 'ContractTickets', 'Contracts',
    'TaskIdMap', 'TimeEntryIdMap',
    // Playbooks (PB): settings-side rows; MDMs after Assets, which point at them.
    'Playbooks', 'FormVersions', 'Forms', 'Mdms',
    'legacy_TimeEntries', 'legacy_ProjectTimeEntries', 'legacy_TicketTasks', 'legacy_ProjectTasks', 'legacy_ProjectSubtasks',
  ];
  for (const table of deleted) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(`${unchecked} DELETE FROM \`${table}\``).catch(() => {});
  }
  // Companies is never truncated: the internal company (created by the
  // migration) must keep its id, because model hooks and the company cache
  // rely on it. Every other company goes.
  await sequelize.query('DELETE FROM Companies WHERE isInternal = 0').catch(() => {});
  // CS: your company's portal and surveys back to off (as migrated on a new install).
  await sequelize.query("UPDATE Companies SET portalEnabled = 0, csatEnabled = 0, portalPreviousSlugs = NULL, status = 'active' WHERE isInternal = 1").catch(() => {});
  // CN: every company's tickets count from T0001 again.
  await sequelize.query('DELETE FROM CompanyCounters').catch(() => {});
  // CN: your own company's code is the same everywhere (its name differs
  // between installs, so a suggested code would too): LITS, as in
  // LITS-T0001 and LITS-SD-P0001.
  await sequelize.query("UPDATE Companies SET code = 'LITS', previousCodes = NULL WHERE isInternal = 1").catch(() => {});
  // Tax categories are seeded (Phase 3): back to the seeded list and shares.
  {
    const { CATEGORIES } = require('../../migrations/20260101000105-tax-and-company-billing'); // eslint-disable-line global-require
    await sequelize.query('SET STATEMENT foreign_key_checks = 0 FOR DELETE FROM TaxCategories WHERE name NOT IN (:names)', { replacements: { names: CATEGORIES.map(([n]) => n) } }).catch(() => {});
    for (const [name, pct] of CATEGORIES) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query('UPDATE TaxCategories SET taxablePercent = :pct, active = 1 WHERE name = :name', { replacements: { name, pct } }).catch(() => {});
    }
  }
  // SystemSettings is not truncated (other code relies on any rows an
  // install has), but settings a test flips must not leak into the next one —
  // SSO enforcement in particular would fail every subsequent login.
  await sequelize.query(
    "DELETE FROM SystemSettings WHERE `key` LIKE 'sso.%' OR `key` LIKE 'timeTracking.%' "
    + "OR `key` LIKE 'csat.%' OR `key` LIKE 'integrations.%' OR `key` = 'notifications.enabledTypes' OR `key` = 'company.timezone' "
    + "OR `key` LIKE 'smtp.%' OR `key` LIKE 'inboundEmail.%' OR `key` = 'notifications.emailDefaults' OR `key` LIKE 'mcp.%' OR `key` LIKE 'money.%'"
  ).catch(() => {});
  await sequelize.query("UPDATE SystemSettings SET value = 'false' WHERE `key` = 'tickets.categoryRequired'").catch(() => {});
  // Workload settings go back to their migrated defaults (rows are kept: the migration test reads them).
  await sequelize.query("UPDATE SystemSettings SET value = '60' WHERE `key` = 'workload.defaultTicketMinutes'").catch(() => {});
  await sequelize.query(
    "UPDATE SystemSettings SET value = '{\"1\":480,\"2\":480,\"3\":480,\"4\":480,\"5\":480,\"6\":0,\"7\":0}' WHERE `key` = 'workload.defaultWorkHours'"
  ).catch(() => {});
  // SLA policies: back to the migrated "Standard" default and its seeded
  // targets, so one test's policies and edits don't leak into the next.
  await resetSlaPolicies();
  // TicketStatuses are not reset, but the "counts as waiting" switch goes
  // back to its seeded state: migration round trips (064) re-create Waiting
  // on User with it off. Missing column = schema before 065.
  await sequelize.query("UPDATE TicketStatuses SET countsAsWaiting = (systemKey <=> 'waiting_on_user')").catch(() => {});
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
