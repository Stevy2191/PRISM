const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ProjectMaterial extends Model {}

  ProjectMaterial.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: { type: DataTypes.INTEGER, allowNull: false },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      itemName: { type: DataTypes.STRING(255), allowNull: false },
      vendor: { type: DataTypes.STRING(255), allowNull: true },
      modelNumber: { type: DataTypes.STRING(255), allowNull: true },
      // Array of serial number strings — a line item can represent several
      // physical units of the same product.
      serialNumber: { type: DataTypes.JSON, allowNull: true },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      unitCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      totalCost: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      notes: { type: DataTypes.TEXT, allowNull: true },
      addedBy: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: 'ProjectMaterial',
      tableName: 'ProjectMaterials',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ProjectMaterial;
};
