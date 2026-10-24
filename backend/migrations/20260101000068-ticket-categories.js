'use strict';

// Service desk 5c (categories). A global category tree (adjacency list, up
// to 5 levels, enforced in code), the deepest chosen node on tickets and
// recurring rules, custom fields scoped to branches, one permission and the
// "category required on the staff create form" setting.

const PERMISSION = {
  key: 'tickets.categories.manage', category: 'tickets', label: 'Manage ticket categories', description: 'Build and edit the ticket category tree',
};

const tableNames = async (qi) => (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const now = new Date();
    const ref = { type: dt.INTEGER, allowNull: true, references: { model: 'TicketCategories', key: 'id' }, onDelete: 'RESTRICT' };

    if (!(await tableNames(qi)).includes('TicketCategories')) {
      await qi.createTable('TicketCategories', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        parentId: ref,
        name: { type: dt.STRING(100), allowNull: false },
        sortOrder: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        active: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        requireChild: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      // NULL parentIds don't collide in a UNIQUE index, so root names are
      // also checked in code.
      await qi.addIndex('TicketCategories', ['parentId', 'name'], { unique: true, name: 'ticket_categories_parent_name' });
    }

    if (!(await qi.describeTable('Tickets')).categoryId) {
      await qi.addColumn('Tickets', 'categoryId', ref);
      await qi.addIndex('Tickets', ['categoryId'], { name: 'tickets_category_id' });
    }
    if (!(await qi.describeTable('CustomFields')).categoryIds) {
      await qi.addColumn('CustomFields', 'categoryIds', { type: dt.JSON, allowNull: true });
    }
    if (!(await qi.describeTable('RecurringTickets')).categoryId) {
      await qi.addColumn('RecurringTickets', 'categoryId', ref);
    }

    const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (!existing) await qi.bulkInsert('Permissions', [{ ...PERMISSION, createdAt: now }]);
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    await qi.sequelize.query(
      `INSERT INTO RolePermissions (roleId, permissionId, granted)
       SELECT r.id, :pid, 1 FROM Roles r WHERE r.name = 'System Administrator'
         AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
      { replacements: { pid: perm.id } }
    );

    const [setting] = await select("SELECT `key` FROM SystemSettings WHERE `key` = 'tickets.categoryRequired'");
    if (!setting) {
      await qi.sequelize.query("INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES ('tickets.categoryRequired', 'false', NOW())");
    }
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });

    await qi.sequelize.query("DELETE FROM SystemSettings WHERE `key` = 'tickets.categoryRequired'");
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (perm) {
      await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
      await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
    }
    await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: PERMISSION.key } });

    if ((await qi.describeTable('RecurringTickets')).categoryId) await qi.removeColumn('RecurringTickets', 'categoryId');
    if ((await qi.describeTable('CustomFields')).categoryIds) await qi.removeColumn('CustomFields', 'categoryIds');
    if ((await qi.describeTable('Tickets')).categoryId) {
      await qi.removeIndex('Tickets', 'tickets_category_id').catch(() => {});
      await qi.removeColumn('Tickets', 'categoryId');
    }
    if ((await tableNames(qi)).includes('TicketCategories')) await qi.dropTable('TicketCategories');
  },
};
