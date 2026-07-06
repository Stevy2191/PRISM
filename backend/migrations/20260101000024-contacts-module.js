'use strict';

// Adds the Contacts module (the people techs service — no login, no role)
// and retires the "requester" concept for PRISM users:
//   1. Create Contacts table.
//   2. Add Tickets.contactId (nullable initially, backfilled below).
//   3. Backfill: every distinct user a ticket was ever requested by gets a
//      matching Contact record (reused by email if one already matches),
//      and every ticket's new contactId is set accordingly. This covers
//      ALL historical tickets, not just ones filed by legacy requester-role
//      users, since a ticket's requesterId could point at any user.
//   4. Deactivate (not delete) every legacy requester-role user: their
//      account is kept for history/audit but can no longer log in, and its
//      legacy role is flipped to 'technician' (a valid, harmless value)
//      purely so the ENUM can be narrowed in step 6.
//   5. Any department whose defaultRoleId pointed at the "Requester" system
//      role has that pointer cleared, so no new user is ever auto-assigned
//      it going forward. The Requester role row itself is left in place
//      (not deleted) per the "do not break existing data" instruction —
//      historical UserRoles rows referencing it stay valid. It is hidden
//      from the assign-role UI in the frontend instead of being removed.
//   6. Narrow Users.role ENUM to ('admin', 'technician') now that no row
//      can hold 'requester'.
//   7. Users.requesterId on Tickets and Users.role are both kept (not
//      dropped) as legacy/fallback columns, per the same "additive, don't
//      break existing data" convention already used for Users.role itself
//      in the roles/permissions build. requesterId becomes nullable since
//      new tickets no longer populate it.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: dt.NOW };

    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));

    // ---- 1. Contacts table ----
    if (!tableNames.includes('Contacts')) {
      await queryInterface.createTable('Contacts', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        firstName: { type: dt.STRING(100), allowNull: false },
        lastName: { type: dt.STRING(100), allowNull: false, defaultValue: '' },
        displayName: { type: dt.STRING(200), allowNull: false },
        email: { type: dt.STRING(255), allowNull: true, unique: true },
        phone: { type: dt.STRING(50), allowNull: true },
        mobile: { type: dt.STRING(50), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        jobTitle: { type: dt.STRING(150), allowNull: true },
        notes: { type: dt.TEXT, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        assignedTo: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('Contacts', ['departmentId']);
      await queryInterface.addIndex('Contacts', ['assignedTo']);
      await queryInterface.addIndex('Contacts', ['lastName']);
    }

    if (!tableNames.includes('ContactActivities')) {
      await queryInterface.createTable('ContactActivities', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contactId: { type: dt.INTEGER, allowNull: false },
        userId: { type: dt.INTEGER, allowNull: true },
        action: { type: dt.STRING(100), allowNull: false },
        detail: { type: dt.JSON, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('ContactActivities', ['contactId']);
    }

    // ---- 2. Tickets.contactId ----
    const ticketCols = await queryInterface.describeTable('Tickets');
    if (!ticketCols.contactId) {
      await queryInterface.addColumn('Tickets', 'contactId', { type: dt.INTEGER, allowNull: true });
      await queryInterface.addIndex('Tickets', ['contactId']);
    }

    // Sidebar module visibility row, so the new nav item is admin-configurable
    // like the rest (Settings -> Modules & Tabs), matching the seeding
    // convention from 20260101000003-settings-system.js.
    const existingModule = await queryInterface.rawSelect(
      'ModuleVisibility',
      { where: { moduleName: 'contacts' } },
      ['id']
    );
    if (!existingModule) {
      await queryInterface.bulkInsert('ModuleVisibility', [
        { moduleName: 'contacts', visibleToRoles: JSON.stringify(['admin', 'technician']) },
      ]);
    }

    // ---- 3. Backfill contacts from every distinct ticket requester ----
    const requesterRows = await queryInterface.sequelize.query(
      'SELECT DISTINCT requesterId FROM Tickets WHERE requesterId IS NOT NULL',
      { type: QueryTypes.SELECT }
    );
    const requesterRoleUsers = await queryInterface.sequelize.query(
      "SELECT id FROM Users WHERE role = 'requester'",
      { type: QueryTypes.SELECT }
    );
    const userIds = [...new Set([
      ...requesterRows.map((r) => r.requesterId),
      ...requesterRoleUsers.map((r) => r.id),
    ])];

    const contactIdByUserId = new Map();
    for (const userId of userIds) {
      // eslint-disable-next-line no-await-in-loop
      const [user] = await queryInterface.sequelize.query(
        'SELECT id, displayName, email, departmentId FROM Users WHERE id = :id',
        { replacements: { id: userId }, type: QueryTypes.SELECT }
      );
      if (!user) continue; // eslint-disable-line no-continue

      let contactId = null;
      if (user.email) {
        // eslint-disable-next-line no-await-in-loop
        const [existingContact] = await queryInterface.sequelize.query(
          'SELECT id FROM Contacts WHERE email = :email',
          { replacements: { email: user.email }, type: QueryTypes.SELECT }
        );
        if (existingContact) contactId = existingContact.id;
      }

      if (!contactId) {
        const parts = String(user.displayName || '').trim().split(/\s+/).filter(Boolean);
        const firstName = parts[0] || 'Unknown';
        const lastName = parts.slice(1).join(' ') || '';
        // eslint-disable-next-line no-await-in-loop
        const [insertId] = await queryInterface.sequelize.query(
          `INSERT INTO Contacts (firstName, lastName, displayName, email, departmentId, createdAt, updatedAt)
           VALUES (:firstName, :lastName, :displayName, :email, :departmentId, NOW(), NOW())`,
          {
            replacements: {
              firstName,
              lastName,
              displayName: user.displayName || `${firstName} ${lastName}`.trim(),
              email: user.email || null,
              departmentId: user.departmentId || null,
            },
            type: QueryTypes.INSERT,
          }
        );
        contactId = insertId;
      }
      contactIdByUserId.set(userId, contactId);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const [userId, contactId] of contactIdByUserId) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.sequelize.query(
        'UPDATE Tickets SET contactId = :contactId WHERE requesterId = :userId',
        { replacements: { contactId, userId } }
      );
    }

    // ---- 4. Deactivate legacy requester-role user accounts ----
    const userCols = await queryInterface.describeTable('Users');
    if (!userCols.isActive) {
      await queryInterface.addColumn('Users', 'isActive', {
        type: dt.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }
    await queryInterface.sequelize.query(
      "UPDATE Users SET isActive = false, role = 'technician' WHERE role = 'requester'"
    );

    // ---- 5. Clear Department.defaultRoleId pointing at the Requester role ----
    await queryInterface.sequelize.query(`
      UPDATE Departments
      SET defaultRoleId = NULL
      WHERE defaultRoleId IN (SELECT id FROM (SELECT id FROM Roles WHERE name = 'Requester') AS r)
    `);

    // ---- 6. Narrow Users.role ENUM now that no row holds 'requester' ----
    await queryInterface.sequelize.query(
      "ALTER TABLE Users MODIFY COLUMN role ENUM('admin','technician') NOT NULL DEFAULT 'technician'"
    );

    // ---- 7. requesterId becomes an optional legacy/fallback column ----
    await queryInterface.sequelize.query('ALTER TABLE Tickets MODIFY COLUMN requesterId INT NULL');
  },

  down: async (queryInterface, Sequelize) => {
    const { QueryTypes } = Sequelize;

    await queryInterface.sequelize.query(
      "ALTER TABLE Users MODIFY COLUMN role ENUM('admin','technician','requester') NOT NULL DEFAULT 'requester'"
    );
    await queryInterface.sequelize.query('ALTER TABLE Tickets MODIFY COLUMN requesterId INT NOT NULL');

    const userCols = await queryInterface.describeTable('Users');
    if (userCols.isActive) {
      await queryInterface.sequelize.query('ALTER TABLE Users DROP COLUMN isActive');
    }

    const ticketCols = await queryInterface.describeTable('Tickets');
    if (ticketCols.contactId) {
      await queryInterface.sequelize.query('ALTER TABLE Tickets DROP COLUMN contactId');
    }

    await queryInterface.bulkDelete('ModuleVisibility', { moduleName: 'contacts' });

    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('ContactActivities')) {
      await queryInterface.dropTable('ContactActivities');
    }
    if (tableNames.includes('Contacts')) {
      await queryInterface.dropTable('Contacts');
    }
    // Not reverted: role='technician'/isActive=false flips on former
    // requester-role users, and Department.defaultRoleId clears — these are
    // data-migration side effects, not schema, and restoring the exact
    // prior role/active state can't be reconstructed safely.
    void QueryTypes;
  },
};
