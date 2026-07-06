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
      // Department-prefixed display ID, e.g. "IT-P00001" — assigned once at
      // creation (see services/projectCodeService.js), never regenerated.
      projectCode: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true,
      },
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
      teamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
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
