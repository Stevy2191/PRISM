const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Asset extends Model {}

  Asset.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetTag: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      categoryId: { type: DataTypes.INTEGER, allowNull: false },
      make: { type: DataTypes.STRING(100), allowNull: true },
      model: { type: DataTypes.STRING(100), allowNull: true },
      serialNumber: { type: DataTypes.STRING(150), allowNull: true },
      departmentId: { type: DataTypes.INTEGER, allowNull: true },
      // The company this record belongs to (client companies, sub-project 2).
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      siteId: { type: DataTypes.INTEGER, allowNull: true },
      assignedToContactId: { type: DataTypes.INTEGER, allowNull: true },
      assignedToUserId: { type: DataTypes.INTEGER, allowNull: true },
      locationBuilding: { type: DataTypes.STRING(150), allowNull: true },
      locationFloor: { type: DataTypes.STRING(50), allowNull: true },
      locationRoom: { type: DataTypes.STRING(50), allowNull: true },
      status: {
        // ready_to_issue and on_hold (with holdReason) come with Playbooks (PB).
        type: DataTypes.ENUM('active', 'in_repair', 'retired', 'in_storage', 'lost', 'ready_to_issue', 'on_hold'),
        allowNull: false,
        defaultValue: 'active',
      },
      purchaseDate: { type: DataTypes.DATEONLY, allowNull: true },
      purchasePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      vendorName: { type: DataTypes.STRING(150), allowNull: true },
      vendorCompanyId: { type: DataTypes.INTEGER, allowNull: true },
      warrantyExpiryDate: { type: DataTypes.DATEONLY, allowNull: true },
      replacementPlanDate: { type: DataTypes.DATEONLY, allowNull: true },
      deployedDate: { type: DataTypes.DATEONLY, allowNull: true },
      ipAddress: { type: DataTypes.STRING(45), allowNull: true },
      macAddress: { type: DataTypes.STRING(50), allowNull: true },
      operatingSystem: { type: DataTypes.STRING(100), allowNull: true },
      osVersion: { type: DataTypes.STRING(50), allowNull: true },
      processor: { type: DataTypes.STRING(150), allowNull: true },
      ram: { type: DataTypes.STRING(50), allowNull: true },
      storage: { type: DataTypes.STRING(50), allowNull: true },
      firmwareVersion: { type: DataTypes.STRING(50), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      // Why an on_hold device can't be issued (required for on_hold).
      holdReason: { type: DataTypes.STRING(255), allowNull: true },
      // Management (PB): whether an MDM manages it, which one (from the
      // install's own list), and the device's id there.
      isManaged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      mdmId: { type: DataTypes.INTEGER, allowNull: true },
      mdmDeviceId: { type: DataTypes.STRING(150), allowNull: true },
      // Cellular (PB): any device type may have a line. The carrier is a
      // vendor company.
      hasCellular: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      imei: { type: DataTypes.STRING(20), allowNull: true },
      phoneNumber: { type: DataTypes.STRING(40), allowNull: true },
      carrierCompanyId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Asset',
      tableName: 'Assets',
      timestamps: true,
    }
  );

  return Asset;
};
