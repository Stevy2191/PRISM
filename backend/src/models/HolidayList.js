const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class HolidayList extends Model {}

  HolidayList.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      // null departmentId = applies globally.
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'HolidayList',
      tableName: 'HolidayLists',
      timestamps: true,
      updatedAt: false,
    }
  );

  return HolidayList;
};
