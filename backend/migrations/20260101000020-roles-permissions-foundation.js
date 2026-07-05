'use strict';

/**
 * Roles & permissions foundation. Introduces a granular, database-backed
 * permission system (Roles / Permissions / RolePermissions / UserRoles /
 * UserPermissionOverrides) that sits alongside the existing Users.role enum
 * (admin/technician/requester) — the enum is left untouched here so all
 * existing requireRole()/role-based checks keep working unchanged; roleId
 * is an additive "primary role" pointer used by the new permission
 * resolution service (see src/services/permissionService.js).
 *
 * NOTE on removeColumn: queryInterface.removeColumn() throws in this
 * Sequelize/MariaDB-driver combination (see migration 18's comment) — the
 * down() migration uses raw DDL instead.
 *
 * Seed roles: five staff-oriented roles from the spec (System Administrator,
 * System Technician, Department Manager, Department Staff, Read Only) plus a
 * sixth "Requester" role added here to match this app's existing customer-
 * facing `requester` user tier (none of the five spec roles fit a
 * view-own-tickets-only customer) — existing requester accounts are migrated
 * to it below instead of System Technician.
 */

const PERMISSIONS = [
  // Tickets
  { key: 'tickets.view_own', category: 'tickets', label: 'View own tickets', description: 'View only tickets assigned to or created by this user' },
  { key: 'tickets.view_department', category: 'tickets', label: 'View department tickets', description: 'View all tickets in own department' },
  { key: 'tickets.view_all', category: 'tickets', label: 'View all tickets', description: 'View all tickets system-wide' },
  { key: 'tickets.create', category: 'tickets', label: 'Create tickets', description: 'Create new tickets' },
  { key: 'tickets.edit_own', category: 'tickets', label: 'Edit own tickets', description: 'Edit tickets assigned to this user' },
  { key: 'tickets.edit_department', category: 'tickets', label: 'Edit department tickets', description: 'Edit any ticket in own department' },
  { key: 'tickets.edit_all', category: 'tickets', label: 'Edit all tickets', description: 'Edit any ticket system-wide' },
  { key: 'tickets.delete', category: 'tickets', label: 'Delete tickets', description: 'Delete tickets' },
  { key: 'tickets.assign', category: 'tickets', label: 'Assign tickets', description: 'Assign tickets to other users' },
  { key: 'tickets.close', category: 'tickets', label: 'Close tickets', description: 'Close or resolve tickets' },
  { key: 'tickets.view_private_comments', category: 'tickets', label: 'View private comments', description: 'See private/internal comments' },
  { key: 'tickets.manage_watchers', category: 'tickets', label: 'Manage watchers', description: 'Add/remove watchers' },

  // Projects
  { key: 'projects.view_own', category: 'projects', label: 'View own projects', description: 'View only projects where user is a member' },
  { key: 'projects.view_department', category: 'projects', label: 'View department projects', description: 'View all projects owned by or for own department' },
  { key: 'projects.view_all', category: 'projects', label: 'View all projects', description: 'View all projects system-wide' },
  { key: 'projects.create', category: 'projects', label: 'Create projects', description: 'Create new projects' },
  { key: 'projects.edit_own', category: 'projects', label: 'Edit own projects', description: 'Edit projects where user is lead' },
  { key: 'projects.edit_department', category: 'projects', label: 'Edit department projects', description: 'Edit any project in own department' },
  { key: 'projects.edit_all', category: 'projects', label: 'Edit all projects', description: 'Edit any project system-wide' },
  { key: 'projects.delete', category: 'projects', label: 'Delete projects', description: 'Delete projects' },
  { key: 'projects.manage_members', category: 'projects', label: 'Manage members', description: 'Add/remove project members' },
  { key: 'projects.log_time', category: 'projects', label: 'Log time', description: 'Log time entries on projects' },
  { key: 'projects.manage_expenses', category: 'projects', label: 'Manage expenses', description: 'Add/edit/delete expenses and materials' },

  // People
  { key: 'people.view_own_department', category: 'people', label: 'View own department', description: 'View users in own department only' },
  { key: 'people.view_all', category: 'people', label: 'View all users', description: 'View all users system-wide' },
  { key: 'people.create_users', category: 'people', label: 'Create users', description: 'Create new user accounts' },
  { key: 'people.edit_users', category: 'people', label: 'Edit users', description: 'Edit user profiles' },
  { key: 'people.manage_roles', category: 'people', label: 'Manage roles', description: 'Assign/remove roles from users' },
  { key: 'people.manage_departments', category: 'people', label: 'Manage departments', description: 'Create/edit/delete departments' },
  { key: 'people.manage_permission_overrides', category: 'people', label: 'Manage permission overrides', description: 'Grant temporary permission overrides to users' },

  // Reports
  { key: 'reports.view_own', category: 'reports', label: 'View own reports', description: 'View reports scoped to own tickets/projects' },
  { key: 'reports.view_department', category: 'reports', label: 'View department reports', description: 'View department-wide reports' },
  { key: 'reports.view_all', category: 'reports', label: 'View all reports', description: 'View system-wide reports' },
  { key: 'reports.export', category: 'reports', label: 'Export reports', description: 'Export reports to CSV/PDF' },

  // Settings
  { key: 'settings.manage_statuses', category: 'settings', label: 'Manage statuses', description: 'Create/edit/delete ticket and project statuses' },
  { key: 'settings.manage_business_hours', category: 'settings', label: 'Manage business hours', description: 'Manage business hour schedules' },
  { key: 'settings.manage_branding', category: 'settings', label: 'Manage branding', description: 'Edit branding settings' },
  { key: 'settings.manage_system', category: 'settings', label: 'Manage system settings', description: 'Access all system settings (catch-all for settings not listed above)' },
  { key: 'settings.view_audit_log', category: 'settings', label: 'View audit log', description: 'View system-wide activity and audit logs' },
];

const ROLES = [
  { name: 'System Administrator', description: 'Full system access. Cannot be deleted.', isSystemRole: true },
  { name: 'System Technician', description: 'Staff member handling tickets and projects system-wide.', isSystemRole: true },
  { name: 'Department Manager', description: 'Manages tickets, projects, and people within a department.', isSystemRole: true },
  { name: 'Department Staff', description: 'Handles tickets and logs time within a department.', isSystemRole: true },
  { name: 'Read Only', description: 'Read-only access scoped to own department.', isSystemRole: true },
  { name: 'Requester', description: 'Customer/end-user who submits and views their own tickets.', isSystemRole: true },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const ROLE_GRANTS = {
  'System Administrator': ALL_PERMISSION_KEYS,
  'System Technician': [
    'tickets.view_all', 'tickets.create', 'tickets.edit_own', 'tickets.assign', 'tickets.close',
    'tickets.view_private_comments', 'tickets.manage_watchers',
    'projects.view_all', 'projects.create', 'projects.edit_own', 'projects.manage_members',
    'projects.log_time', 'projects.manage_expenses',
    'people.view_all',
    'reports.view_department', 'reports.export',
  ],
  'Department Manager': [
    'tickets.view_department', 'tickets.create', 'tickets.edit_department', 'tickets.assign', 'tickets.close',
    'tickets.view_private_comments', 'tickets.manage_watchers',
    'projects.view_department', 'projects.create', 'projects.edit_department', 'projects.manage_members',
    'projects.log_time', 'projects.manage_expenses',
    'people.view_own_department', 'people.create_users', 'people.edit_users',
    'reports.view_department', 'reports.export',
  ],
  'Department Staff': [
    'tickets.view_department', 'tickets.create', 'tickets.edit_own', 'tickets.manage_watchers',
    'projects.view_department', 'projects.log_time',
    'people.view_own_department',
    'reports.view_own',
  ],
  'Read Only': [
    'tickets.view_department',
    'projects.view_department',
    'people.view_own_department',
    'reports.view_own',
  ],
  Requester: [
    'tickets.view_own', 'tickets.create',
    'projects.view_own',
    'reports.view_own',
  ],
};

// Existing Users.role enum value -> seed role name, used to migrate existing accounts.
const LEGACY_ROLE_MAP = {
  admin: 'System Administrator',
  technician: 'System Technician',
  requester: 'Requester',
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, TEXT, DATE, BOOLEAN } = Sequelize;
    const { QueryTypes } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    // ---- Roles ----
    await queryInterface.createTable('Roles', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: STRING(255), allowNull: false, unique: true },
      description: { type: TEXT, allowNull: true },
      departmentId: { type: INTEGER, allowNull: true },
      isSystemRole: { type: BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: now,
      updatedAt: now,
    });
    await queryInterface.addIndex('Roles', ['departmentId']);

    // ---- Permissions ----
    await queryInterface.createTable('Permissions', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      key: { type: STRING(100), allowNull: false, unique: true },
      category: { type: STRING(50), allowNull: false },
      label: { type: STRING(255), allowNull: false },
      description: { type: TEXT, allowNull: true },
      createdAt: now,
    });

    // ---- RolePermissions ----
    await queryInterface.createTable('RolePermissions', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      roleId: { type: INTEGER, allowNull: false },
      permissionId: { type: INTEGER, allowNull: false },
      granted: { type: BOOLEAN, allowNull: false, defaultValue: true },
    });
    await queryInterface.addIndex('RolePermissions', ['roleId']);
    await queryInterface.addIndex('RolePermissions', ['permissionId']);
    await queryInterface.addIndex('RolePermissions', ['roleId', 'permissionId'], {
      unique: true,
      name: 'role_permissions_role_permission_unique',
    });

    // ---- UserRoles ----
    await queryInterface.createTable('UserRoles', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: INTEGER, allowNull: false },
      roleId: { type: INTEGER, allowNull: false },
      assignedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      assignedBy: { type: INTEGER, allowNull: true },
    });
    await queryInterface.addIndex('UserRoles', ['userId']);
    await queryInterface.addIndex('UserRoles', ['roleId']);
    await queryInterface.addIndex('UserRoles', ['userId', 'roleId'], {
      unique: true,
      name: 'user_roles_user_role_unique',
    });

    // ---- UserPermissionOverrides ----
    await queryInterface.createTable('UserPermissionOverrides', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: INTEGER, allowNull: false },
      permissionKey: { type: STRING(100), allowNull: false },
      granted: { type: BOOLEAN, allowNull: false, defaultValue: true },
      reason: { type: STRING(500), allowNull: true },
      expiresAt: { type: DATE, allowNull: true },
      grantedBy: { type: INTEGER, allowNull: true },
      createdAt: now,
    });
    await queryInterface.addIndex('UserPermissionOverrides', ['userId']);
    await queryInterface.addIndex('UserPermissionOverrides', ['permissionKey']);

    // ---- Users.roleId (primary role — additive; the legacy `role` enum stays) ----
    const userCols = await queryInterface.describeTable('Users');
    if (!userCols.roleId) {
      await queryInterface.addColumn('Users', 'roleId', { type: INTEGER, allowNull: true });
      await queryInterface.addIndex('Users', ['roleId']);
    }

    // ---- Seed permissions ----
    await queryInterface.bulkInsert(
      'Permissions',
      PERMISSIONS.map((p) => ({ ...p, createdAt: new Date() }))
    );
    const permRows = await queryInterface.sequelize.query('SELECT `id`, `key` FROM `Permissions`', {
      type: QueryTypes.SELECT,
    });
    const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

    // ---- Seed roles ----
    await queryInterface.bulkInsert(
      'Roles',
      ROLES.map((r) => ({
        name: r.name,
        description: r.description,
        departmentId: null,
        isSystemRole: r.isSystemRole,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
    const roleRows = await queryInterface.sequelize.query('SELECT `id`, `name` FROM `Roles`', {
      type: QueryTypes.SELECT,
    });
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    // ---- Seed role_permissions ----
    const rolePermissionRows = [];
    for (const [roleName, keys] of Object.entries(ROLE_GRANTS)) {
      const roleId = roleIdByName.get(roleName);
      for (const key of keys) {
        const permissionId = permIdByKey.get(key);
        if (roleId && permissionId) {
          rolePermissionRows.push({ roleId, permissionId, granted: true });
        }
      }
    }
    await queryInterface.bulkInsert('RolePermissions', rolePermissionRows);

    // ---- Migrate existing users onto the new roles ----
    const users = await queryInterface.sequelize.query('SELECT `id`, `role` FROM `Users`', {
      type: QueryTypes.SELECT,
    });
    for (const user of users) {
      const roleName = LEGACY_ROLE_MAP[user.role] || 'Requester';
      const roleId = roleIdByName.get(roleName);
      if (!roleId) continue; // eslint-disable-line no-continue

      // eslint-disable-next-line no-await-in-loop
      await queryInterface.bulkInsert('UserRoles', [
        { userId: user.id, roleId, assignedAt: new Date(), assignedBy: null },
      ]);
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.sequelize.query('UPDATE `Users` SET `roleId` = :roleId WHERE `id` = :userId', {
        replacements: { roleId, userId: user.id },
      });
    }

    return undefined;
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    const userCols = await queryInterface.describeTable('Users');
    if (userCols.roleId) await q('ALTER TABLE `Users` DROP COLUMN `roleId`');

    await q('DROP TABLE IF EXISTS `UserPermissionOverrides`');
    await q('DROP TABLE IF EXISTS `UserRoles`');
    await q('DROP TABLE IF EXISTS `RolePermissions`');
    await q('DROP TABLE IF EXISTS `Permissions`');
    await q('DROP TABLE IF EXISTS `Roles`');

    return undefined;
  },
};
