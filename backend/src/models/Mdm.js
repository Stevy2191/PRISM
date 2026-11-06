const { DataTypes, Model } = require('sequelize');

// An MDM an install uses (Playbooks, PB). Each install keeps its own list;
// nothing is built in. A retired MDM (isActive false) stays on the devices
// that have it but can't be picked for new ones. consoleUrl may contain
// {id}, replaced with a device's MDM device ID to link to it.
module.exports = (sequelize) => {
  class Mdm extends Model {}

  Mdm.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      consoleUrl: { type: DataTypes.STRING(500), allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'Mdm', tableName: 'Mdms', timestamps: true }
  );

  return Mdm;
};
