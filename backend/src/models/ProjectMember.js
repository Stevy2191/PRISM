const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectMember extends Model {}

  ProjectMember.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      role: { type: DataTypes.ENUM('lead', 'member'), allowNull: false, defaultValue: 'member' },
      addedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'ProjectMember',
      tableName: 'ProjectMembers',
      timestamps: false,
    }
  );

  return ProjectMember;
};
