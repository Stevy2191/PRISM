'use strict';

/**
 * Settings system (Phase 1): SystemSettings, BusinessHours, HolidayLists/Holidays,
 * CsatResponses, Teams/TeamMembers, ModuleVisibility, and Ticket.teamId.
 *
 * Idempotent guards let it re-run after a partial apply. Seeds default module
 * visibility so the sidebar renders correctly out of the box.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Note: do NOT destructure `JSON` from Sequelize — it would shadow the global
    // JSON object and break JSON.stringify below. Use Sequelize.JSON for columns.
    const { INTEGER, STRING, TEXT, BOOLEAN, ENUM, DATE, DATEONLY } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    const hasTable = (name) => tableNames.includes(name);
    const hasColumn = async (table, column) => {
      const schema = await queryInterface.describeTable(table);
      return !!schema[column];
    };

    if (!hasTable('SystemSettings')) {
      await queryInterface.createTable('SystemSettings', {
        key: { type: STRING(191), primaryKey: true },
        value: { type: TEXT, allowNull: true },
        updatedById: {
          type: INTEGER, allowNull: true,
          references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        updatedAt: now,
      });
    }

    if (!hasTable('BusinessHours')) {
      await queryInterface.createTable('BusinessHours', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        departmentId: {
          type: INTEGER, allowNull: true,
          references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        timezone: { type: STRING(64), allowNull: false, defaultValue: 'UTC' },
        schedule: { type: Sequelize.JSON, allowNull: true },
        createdAt: now,
      });
    }

    if (!hasTable('HolidayLists')) {
      await queryInterface.createTable('HolidayLists', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        departmentId: {
          type: INTEGER, allowNull: true,
          references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        createdAt: now,
      });
    }

    if (!hasTable('Holidays')) {
      await queryInterface.createTable('Holidays', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        holidayListId: {
          type: INTEGER, allowNull: false,
          references: { model: 'HolidayLists', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        name: { type: STRING(255), allowNull: false },
        date: { type: DATEONLY, allowNull: false },
      });
    }

    if (!hasTable('CsatResponses')) {
      await queryInterface.createTable('CsatResponses', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: {
          type: INTEGER, allowNull: false, unique: true,
          references: { model: 'Tickets', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        userId: {
          type: INTEGER, allowNull: true,
          references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        rating: { type: ENUM('happy', 'neutral', 'unhappy'), allowNull: false },
        comment: { type: TEXT, allowNull: true },
        respondedAt: now,
      });
    }

    if (!hasTable('Teams')) {
      await queryInterface.createTable('Teams', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        description: { type: TEXT, allowNull: true },
        departmentId: {
          type: INTEGER, allowNull: true,
          references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        createdAt: now,
      });
    }

    if (!hasTable('TeamMembers')) {
      await queryInterface.createTable('TeamMembers', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        teamId: {
          type: INTEGER, allowNull: false,
          references: { model: 'Teams', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        userId: {
          type: INTEGER, allowNull: false,
          references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        isLead: { type: BOOLEAN, allowNull: false, defaultValue: false },
      });
      await queryInterface.addIndex('TeamMembers', ['teamId', 'userId'], { unique: true, name: 'team_members_team_user_unique' });
    }

    if (!hasTable('ModuleVisibility')) {
      await queryInterface.createTable('ModuleVisibility', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        moduleName: { type: STRING(64), allowNull: false, unique: true },
        visibleToRoles: { type: Sequelize.JSON, allowNull: false },
      });
    }

    // Ticket.teamId
    if (!(await hasColumn('Tickets', 'teamId'))) {
      await queryInterface.addColumn('Tickets', 'teamId', {
        type: INTEGER, allowNull: true,
        references: { model: 'Teams', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      });
    }

    // Seed default module visibility (skip any already present).
    const ALL = ['admin', 'technician', 'requester'];
    const STAFF = ['admin', 'technician'];
    const defaults = [
      { moduleName: 'dashboard', visibleToRoles: ALL },
      { moduleName: 'tickets', visibleToRoles: ALL },
      { moduleName: 'projects', visibleToRoles: ALL },
      { moduleName: 'reports', visibleToRoles: STAFF },
      { moduleName: 'calendar', visibleToRoles: ALL },
      { moduleName: 'settings', visibleToRoles: ALL },
    ];
    for (const row of defaults) {
      const existing = await queryInterface.rawSelect(
        'ModuleVisibility',
        { where: { moduleName: row.moduleName } },
        ['id']
      );
      if (!existing) {
        await queryInterface.bulkInsert('ModuleVisibility', [
          { moduleName: row.moduleName, visibleToRoles: JSON.stringify(row.visibleToRoles) },
        ]);
      }
    }

    return undefined;
  },

  async down(queryInterface) {
    const hasColumn = async (table, column) => {
      const schema = await queryInterface.describeTable(table);
      return !!schema[column];
    };
    if (await hasColumn('Tickets', 'teamId')) {
      await queryInterface.removeColumn('Tickets', 'teamId');
    }
    await queryInterface.dropTable('ModuleVisibility');
    await queryInterface.dropTable('TeamMembers');
    await queryInterface.dropTable('Teams');
    await queryInterface.dropTable('CsatResponses');
    await queryInterface.dropTable('Holidays');
    await queryInterface.dropTable('HolidayLists');
    await queryInterface.dropTable('BusinessHours');
    await queryInterface.dropTable('SystemSettings');
    return undefined;
  },
};
