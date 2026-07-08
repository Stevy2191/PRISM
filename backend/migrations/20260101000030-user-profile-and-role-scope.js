'use strict';

// 1. User profile fields: firstName/lastName/phone/jobTitle.
// 2. Role.scope — the discriminator the "Assign a role" dropdown label should
//    actually use ('system' | 'department'). Distinct from the pre-existing
//    Role.departmentId, which permanently locks a *custom* role to one
//    specific department; scope='department' with departmentId still null
//    means "a reusable template — the department is chosen per assignment"
//    (this is what the seeded Department Manager/Department Staff roles are).
// 3. UserRoles.departmentId — captures that per-assignment department for
//    department-scoped role assignments. The old (userId, roleId) unique
//    index is replaced with (userId, roleId, departmentId) so the same
//    template role can be assigned to one user for two different
//    departments (MariaDB unique indexes treat NULL as distinct per row, so
//    system-wide assignments — departmentId always NULL — remain unique per
//    (userId, roleId) in practice).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const userCols = await queryInterface.describeTable('Users');
    if (!userCols.firstName) await queryInterface.addColumn('Users', 'firstName', { type: dt.STRING(100), allowNull: true });
    if (!userCols.lastName) await queryInterface.addColumn('Users', 'lastName', { type: dt.STRING(100), allowNull: true });
    if (!userCols.phone) await queryInterface.addColumn('Users', 'phone', { type: dt.STRING(50), allowNull: true });
    if (!userCols.jobTitle) await queryInterface.addColumn('Users', 'jobTitle', { type: dt.STRING(150), allowNull: true });

    const roleCols = await queryInterface.describeTable('Roles');
    if (!roleCols.scope) {
      await queryInterface.addColumn('Roles', 'scope', {
        type: dt.ENUM('system', 'department'), allowNull: false, defaultValue: 'system',
      });
      await queryInterface.sequelize.query(
        "UPDATE Roles SET scope = 'department' WHERE name IN ('Department Manager', 'Department Staff')"
      );
    }

    const userRoleCols = await queryInterface.describeTable('UserRoles');
    if (!userRoleCols.departmentId) {
      await queryInterface.addColumn('UserRoles', 'departmentId', { type: dt.INTEGER, allowNull: true });
      const indexes = await queryInterface.showIndex('UserRoles');
      if (indexes.some((i) => i.name === 'user_roles_user_role_unique')) {
        await queryInterface.removeIndex('UserRoles', 'user_roles_user_role_unique');
      }
      await queryInterface.addIndex('UserRoles', ['userId', 'roleId', 'departmentId'], {
        unique: true, name: 'user_roles_user_role_dept_unique',
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const userRoleCols = await queryInterface.describeTable('UserRoles');
    if (userRoleCols.departmentId) {
      const indexes = await queryInterface.showIndex('UserRoles');
      if (indexes.some((i) => i.name === 'user_roles_user_role_dept_unique')) {
        await queryInterface.removeIndex('UserRoles', 'user_roles_user_role_dept_unique');
      }
      await queryInterface.addIndex('UserRoles', ['userId', 'roleId'], { unique: true, name: 'user_roles_user_role_unique' });
      await queryInterface.removeColumn('UserRoles', 'departmentId');
    }

    const roleCols = await queryInterface.describeTable('Roles');
    if (roleCols.scope) await queryInterface.removeColumn('Roles', 'scope');

    const userCols = await queryInterface.describeTable('Users');
    if (userCols.jobTitle) await queryInterface.removeColumn('Users', 'jobTitle');
    if (userCols.phone) await queryInterface.removeColumn('Users', 'phone');
    if (userCols.lastName) await queryInterface.removeColumn('Users', 'lastName');
    if (userCols.firstName) await queryInterface.removeColumn('Users', 'firstName');
  },
};
