const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Project extends Model {}

  Project.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // CN: numbered within its company, with the department it's for:
      // WC-HR-P0007, or WC-P0006 for the whole company. Assigned at creation
      // (services/projects/numbers.js); a move to another company or a new
      // company code changes it, and old codes stay in previousCodes.
      projectCode: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true,
      },
      companySeq: { type: DataTypes.INTEGER, allowNull: true },
      previousCodes: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const v = this.getDataValue('previousCodes');
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
          return v ?? [];
        },
      },
      // CN: shown in its company's portal (status and progress only).
      showInPortal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Freeform labels, e.g. ["migration", "q3"] — same pattern as Ticket.tags.
      tags: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Free-form string matching a ProjectStatus row's `name` (see the
      // matching note on Ticket.status).
      // The company this record belongs to (client companies, sub-project 2).
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Active',
      },
      // Department doing the work.
      ownerDepartmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Department the project is for/benefits — defaults to
      // ownerDepartmentId when not explicitly set (see controller).
      forDepartmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Project lead.
      assignedToUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The template this project was made from (null for blank or copied projects).
      templateId: { type: DataTypes.INTEGER, allowNull: true },
      teamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      startDate: { type: DataTypes.DATEONLY, allowNull: true },
      // Minutes; null = no budget.
      hourBudgetMinutes: { type: DataTypes.INTEGER, allowNull: true },
      // Highest budget alert already sent: 0, 80 or 100.
      budgetAlertLevel: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      budgetAlert80: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      budgetAlert100: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Project',
      tableName: 'Projects',
      timestamps: true,
      hooks: {
        // Keep closedAt in sync with status transitions, exactly mirroring
        // Ticket.resolvedAt — driven by ProjectStatuses.behaviorType, never
        // a hardcoded status name.
        beforeSave: async (project) => {
          if (project.changed('status')) {
            const { ProjectStatus } = require('./index'); // eslint-disable-line global-require
            const statusRow = await ProjectStatus.findOne({ where: { name: project.status } });
            const isClosed = statusRow?.behaviorType === 'closed';
            if (isClosed && !project.closedAt) {
              project.closedAt = new Date();
            } else if (!isClosed) {
              project.closedAt = null;
            }
          }
        },
      },
    }
  );

  return Project;
};
