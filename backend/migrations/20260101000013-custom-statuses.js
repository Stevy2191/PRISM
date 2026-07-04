'use strict';

/**
 * Admin-customizable ticket/project statuses. Tickets.status and
 * Projects.status move from a fixed ENUM to a free STRING so admins can add
 * arbitrary status names; TicketStatuses/ProjectStatuses rows are the source
 * of truth for color, ordering, and behaviorType (open/closed/archived),
 * which drives dashboards/reports/warnings instead of the literal string.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, BOOLEAN, ENUM, DATE } = Sequelize;
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));

    if (!names.includes('TicketStatuses')) {
      await queryInterface.createTable('TicketStatuses', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(100), allowNull: false },
        color: { type: STRING(9), allowNull: false, defaultValue: '#3b82f6' },
        behaviorType: { type: ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
        position: { type: INTEGER, allowNull: false, defaultValue: 0 },
        isDefault: { type: BOOLEAN, allowNull: false, defaultValue: false },
        isProtected: { type: BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
    }

    if (!names.includes('ProjectStatuses')) {
      await queryInterface.createTable('ProjectStatuses', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(100), allowNull: false },
        color: { type: STRING(9), allowNull: false, defaultValue: '#3b82f6' },
        behaviorType: { type: ENUM('open', 'closed', 'archived'), allowNull: false, defaultValue: 'open' },
        position: { type: INTEGER, allowNull: false, defaultValue: 0 },
        isDefault: { type: BOOLEAN, allowNull: false, defaultValue: false },
        isProtected: { type: BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
    }

    const ticketStatusCount = await queryInterface.sequelize.query(
      'SELECT COUNT(*) as c FROM TicketStatuses',
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (Number(ticketStatusCount[0].c) === 0) {
      await queryInterface.bulkInsert('TicketStatuses', [
        { name: 'Open', color: '#3b82f6', behaviorType: 'open', position: 0, isDefault: true, isProtected: true, createdAt: new Date() },
        { name: 'In Progress', color: '#22c55e', behaviorType: 'open', position: 1, isDefault: false, isProtected: false, createdAt: new Date() },
        { name: 'Pending', color: '#f59e0b', behaviorType: 'open', position: 2, isDefault: false, isProtected: false, createdAt: new Date() },
        { name: 'On Hold', color: '#94a3b8', behaviorType: 'open', position: 3, isDefault: false, isProtected: false, createdAt: new Date() },
        { name: 'Resolved', color: '#14b8a6', behaviorType: 'closed', position: 4, isDefault: false, isProtected: true, createdAt: new Date() },
        { name: 'Closed', color: '#475569', behaviorType: 'closed', position: 5, isDefault: false, isProtected: true, createdAt: new Date() },
      ]);
    }

    const projectStatusCount = await queryInterface.sequelize.query(
      'SELECT COUNT(*) as c FROM ProjectStatuses',
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (Number(projectStatusCount[0].c) === 0) {
      await queryInterface.bulkInsert('ProjectStatuses', [
        { name: 'Active', color: '#3b82f6', behaviorType: 'open', position: 0, isDefault: true, isProtected: true, createdAt: new Date() },
        { name: 'On Hold', color: '#f59e0b', behaviorType: 'open', position: 1, isDefault: false, isProtected: false, createdAt: new Date() },
        { name: 'Completed', color: '#22c55e', behaviorType: 'closed', position: 2, isDefault: false, isProtected: true, createdAt: new Date() },
        { name: 'Archived', color: '#475569', behaviorType: 'archived', position: 3, isDefault: false, isProtected: true, createdAt: new Date() },
      ]);
    }

    // Tickets/Projects keep storing status as a plain string matching a
    // status row's `name` (case preserved) rather than the old fixed ENUM,
    // so admin-added statuses are always assignable. Existing ENUM values
    // ('open', 'in_progress', 'on_hold', 'resolved', 'closed' / 'active',
    // 'on_hold', 'completed', 'archived') match the seeded row names above
    // case-for-case except capitalization — remap existing rows to the
    // display names so status pickers (which now render `status.name`) show
    // consistent values immediately.
    await queryInterface.changeColumn('Tickets', 'status', { type: STRING(100), allowNull: false, defaultValue: 'Open' });
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'Open' WHERE status = 'open'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'In Progress' WHERE status = 'in_progress'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'On Hold' WHERE status = 'on_hold'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'Resolved' WHERE status = 'resolved'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'Closed' WHERE status = 'closed'");

    await queryInterface.changeColumn('Projects', 'status', { type: STRING(100), allowNull: false, defaultValue: 'Active' });
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'Active' WHERE status = 'active'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'On Hold' WHERE status = 'on_hold'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'Completed' WHERE status = 'completed'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'Archived' WHERE status = 'archived'");

    return undefined;
  },

  async down(queryInterface, Sequelize) {
    const { ENUM } = Sequelize;
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'open' WHERE status = 'Open'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'in_progress' WHERE status = 'In Progress'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'on_hold' WHERE status = 'On Hold'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'resolved' WHERE status = 'Resolved'");
    await queryInterface.sequelize.query("UPDATE Tickets SET status = 'closed' WHERE status = 'Closed'");
    await queryInterface.changeColumn('Tickets', 'status', {
      type: ENUM('open', 'in_progress', 'on_hold', 'resolved', 'closed'),
      allowNull: false,
      defaultValue: 'open',
    });

    await queryInterface.sequelize.query("UPDATE Projects SET status = 'active' WHERE status = 'Active'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'on_hold' WHERE status = 'On Hold'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'completed' WHERE status = 'Completed'");
    await queryInterface.sequelize.query("UPDATE Projects SET status = 'archived' WHERE status = 'Archived'");
    await queryInterface.changeColumn('Projects', 'status', {
      type: ENUM('active', 'on_hold', 'completed', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    });

    await queryInterface.dropTable('ProjectStatuses');
    await queryInterface.dropTable('TicketStatuses');
    return undefined;
  },
};
