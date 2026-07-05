const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectFile extends Model {}

  ProjectFile.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      // Display (original) filename — the on-disk path is filepath, which
      // uses a randomized name to avoid collisions.
      filename: { type: DataTypes.STRING(255), allowNull: false },
      filepath: { type: DataTypes.STRING(500), allowNull: false },
      filesize: { type: DataTypes.INTEGER, allowNull: false },
      uploadedBy: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'ProjectFile',
      tableName: 'ProjectFiles',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ProjectFile;
};
