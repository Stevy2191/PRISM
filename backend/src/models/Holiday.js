const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Holiday extends Model {}

  Holiday.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      holidayListId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false },
    },
    {
      sequelize,
      modelName: 'Holiday',
      tableName: 'Holidays',
      timestamps: false,
    }
  );

  return Holiday;
};
