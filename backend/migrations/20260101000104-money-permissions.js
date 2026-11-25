'use strict';

// Phase 3 permissions (step 1). All to System Administrators; timesheet
// approval also to Department Managers. Settings defaults live in
// src/services/money/config.js, not here.

const PERMISSIONS = [
  ['money.billing.view', 'See invoices and billing', "See customers' invoices, payments, agreements and billing settings", ['System Administrator']],
  ['money.billing.manage', 'Manage invoices and payments', 'Create and send invoices, record payments, change customers\' billing settings', ['System Administrator']],
  ['money.settings', 'Manage money settings', 'Currency, tax rates and categories, payment settings', ['System Administrator']],
  ['money.rates.manage', 'Manage rates and products', 'Hourly rates, trip charge, billing rules, and the products and services list', ['System Administrator']],
  ['money.timesheets.approve', 'Approve timesheets', 'Approve or send back people\'s weekly timesheets', ['System Administrator', 'Department Manager']],
  ['money.bills.manage', 'Manage bills and expenses', 'Record contractor and supplier bills and expenses, and mark them paid', ['System Administrator']],
  ['money.purchasing.manage', 'Manage purchasing and stock', 'Raise purchase orders, receive items, keep shelf stock', ['System Administrator']],
  ['money.sales.manage', 'Manage sales', 'Prospects, quotes and contracts', ['System Administrator']],
  ['money.books.view', 'See the books', 'Profit and loss, aging, sales tax and other money reports', ['System Administrator']],
];

module.exports = {
  PERMISSIONS,
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const now = new Date();
    for (const [key, label, description, roles] of PERMISSIONS) {
      /* eslint-disable no-await-in-loop */
      const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key });
      if (!existing) await qi.bulkInsert('Permissions', [{ key, category: 'money', label, description, createdAt: now }]);
      const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key });
      await qi.sequelize.query(
        `INSERT INTO RolePermissions (roleId, permissionId, granted)
         SELECT r.id, :pid, 1 FROM Roles r
          WHERE r.name IN (:roles) AND r.isSystemRole = 1
            AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
        { replacements: { pid: perm.id, roles } },
      );
      /* eslint-enable no-await-in-loop */
    }
  },

  down: async (queryInterface) => {
    const keys = PERMISSIONS.map(([key]) => key);
    await queryInterface.sequelize.query(
      'DELETE FROM RolePermissions WHERE permissionId IN (SELECT id FROM Permissions WHERE `key` IN (:keys))', { replacements: { keys } },
    );
    await queryInterface.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey IN (:keys)', { replacements: { keys } });
    await queryInterface.sequelize.query('DELETE FROM Permissions WHERE `key` IN (:keys)', { replacements: { keys } });
    await queryInterface.sequelize.query("DELETE FROM SystemSettings WHERE `key` LIKE 'money.%'");
  },
};
