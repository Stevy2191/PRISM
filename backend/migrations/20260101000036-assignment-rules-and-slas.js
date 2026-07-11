'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const tables = await queryInterface.showAllTables();

    if (!tables.includes('AssignmentRules')) {
      await queryInterface.createTable('AssignmentRules', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(200), allowNull: false },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        ticketType: { type: dt.ENUM('incident', 'request', 'problem', 'change'), allowNull: true },
        departmentId: { type: dt.INTEGER, allowNull: true },
        priority: { type: dt.ENUM('critical', 'high', 'medium', 'low'), allowNull: true },
        assigneeId: { type: dt.INTEGER, allowNull: true },
        teamId: { type: dt.INTEGER, allowNull: true },
        createdBy: { type: dt.INTEGER, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }

    if (!tables.includes('SlaPolicies')) {
      await queryInterface.createTable('SlaPolicies', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        priority: { type: dt.ENUM('critical', 'high', 'medium', 'low'), allowNull: false, unique: true },
        firstResponseHours: { type: dt.DECIMAL(6, 2), allowNull: false, defaultValue: 4 },
        resolutionHours: { type: dt.DECIMAL(6, 2), allowNull: false, defaultValue: 24 },
        useBusinessHours: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });

      // Seed one row per priority with sensible defaults so the settings
      // page always has all four rows to edit, never an empty table.
      const now = new Date();
      await queryInterface.bulkInsert('SlaPolicies', [
        { priority: 'critical', firstResponseHours: 1, resolutionHours: 4, useBusinessHours: false, createdAt: now, updatedAt: now },
        { priority: 'high', firstResponseHours: 4, resolutionHours: 8, useBusinessHours: true, createdAt: now, updatedAt: now },
        { priority: 'medium', firstResponseHours: 8, resolutionHours: 24, useBusinessHours: true, createdAt: now, updatedAt: now },
        { priority: 'low', firstResponseHours: 24, resolutionHours: 72, useBusinessHours: true, createdAt: now, updatedAt: now },
      ]);
    }
  },

  down: async (queryInterface) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('SlaPolicies')) await queryInterface.dropTable('SlaPolicies');
    if (tables.includes('AssignmentRules')) await queryInterface.dropTable('AssignmentRules');
  },
};
