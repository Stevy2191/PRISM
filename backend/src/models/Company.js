const { DataTypes, Model } = require('sequelize');

// A client, a vendor (or both), or the organization itself (isInternal —
// exactly one, created by migration). See the client-companies spec.
module.exports = (sequelize) => {
  class Company extends Model {}
  Company.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      isInternal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isClient: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isVendor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      accountManagerId: { type: DataTypes.INTEGER, allowNull: true },
      // null = the default SLA policy.
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: true },
      // Microsoft 365 (client portal 7b). One tenant links to one company.
      msTenantId: { type: DataTypes.STRING(36), allowNull: true, unique: true },
      // When the tenant's admin approved PRISM's app (admin consent).
      msConsentAt: { type: DataTypes.DATE, allowNull: true },
      // [{ id, name }]: only these groups' members sign in and are synced.
      // Stored NULL reads as [].
      msSyncGroups: {
        type: DataTypes.JSON,
        allowNull: true,
        get() { return this.getDataValue('msSyncGroups') ?? []; },
      },
      // { at, durationMs, updated, deactivated, newDetected, errors: [string] }
      msLastSync: { type: DataTypes.JSON, allowNull: true },
    },
    { sequelize, modelName: 'Company', tableName: 'Companies', timestamps: true }
  );
  return Company;
};
