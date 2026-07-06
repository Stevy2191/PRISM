const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectIdSequence extends Model {}

  ProjectIdSequence.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      // Last project number issued for this department — the next project
      // created for it gets lastSequence + 1 (see services/projectCodeService.js).
      lastSequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: 'ProjectIdSequence',
      tableName: 'ProjectIdSequences',
      timestamps: true,
    }
  );

  return ProjectIdSequence;
};
