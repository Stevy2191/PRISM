'use strict';

/**
 * Business Hours schedule enhancements: an is24x7 flag (when set, the
 * editor treats every day as open 00:00-23:59 regardless of the stored
 * `schedule` JSON, which is left untouched so turning 24/7 off restores the
 * prior manual configuration) and a nullable holidayListId linking a
 * schedule to an existing Holiday List, mirroring the departmentId pattern.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { BOOLEAN, INTEGER } = Sequelize;

    const cols = await queryInterface.describeTable('BusinessHours');
    if (!cols.is24x7) {
      await queryInterface.addColumn('BusinessHours', 'is24x7', {
        type: BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    if (!cols.holidayListId) {
      await queryInterface.addColumn('BusinessHours', 'holidayListId', {
        type: INTEGER,
        allowNull: true,
        references: { model: 'HolidayLists', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    return undefined;
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('BusinessHours', 'holidayListId');
    await queryInterface.removeColumn('BusinessHours', 'is24x7');
    return undefined;
  },
};
