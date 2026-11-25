const { DataTypes, Model } = require('sequelize');

// A client, a vendor (or both), or the organization itself (isInternal —
// exactly one, created by migration). See the client-companies spec.
module.exports = (sequelize) => {
  class Company extends Model {}
  Company.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      // Its short code (CN): starts its ticket and project numbers (WC-T0042,
      // WC-HR-P0007). Unique; previousCodes still find its old numbers.
      code: { type: DataTypes.STRING(6), allowNull: true, unique: true },
      previousCodes: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const v = this.getDataValue('previousCodes');
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
          return v ?? [];
        },
      },
      isInternal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isClient: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isVendor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // A vendor who gets a 1099 (Phase 3): totals only, never a tax ID.
      is1099: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      accountManagerId: { type: DataTypes.INTEGER, allowNull: true },
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
      // Its own portal (CS): /portal/<portalSlug>, open while switched on and
      // the company is active. Contacts of other companies can't sign in there.
      portalEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      portalSlug: { type: DataTypes.STRING(50), allowNull: true, unique: true },
      // Links it had before a rename: they keep working. Stored NULL reads as [].
      portalPreviousSlugs: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const v = this.getDataValue('portalPreviousSlugs');
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
          return v ?? [];
        },
      },
      // Satisfaction surveys for its closed tickets.
      csatEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, modelName: 'Company', tableName: 'Companies', timestamps: true }
  );
  return Company;
};
