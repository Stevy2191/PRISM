const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class SavedFilter extends Model {}

  SavedFilter.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      filterJson: {
        type: DataTypes.JSON,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'SavedFilter',
      tableName: 'SavedFilters',
      timestamps: true,
    }
  );

  return SavedFilter;
};
