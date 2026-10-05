const { DataTypes, Model } = require('sequelize');

// A company's physical location. Contacts and assets may point at one.
module.exports = (sequelize) => {
  class Site extends Model {}
  Site.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      line1: { type: DataTypes.STRING(200), allowNull: true },
      line2: { type: DataTypes.STRING(200), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      region: { type: DataTypes.STRING(100), allowNull: true },
      postalCode: { type: DataTypes.STRING(20), allowNull: true },
      country: { type: DataTypes.STRING(100), allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    },
    { sequelize, modelName: 'Site', tableName: 'Sites', timestamps: true }
  );
  return Site;
};
