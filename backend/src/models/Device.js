const { DataTypes, Model } = require('sequelize');

// A computer running the PRISM agent (8a), one per agent-managed Asset.
// publicKey: the device's Ed25519 public key (raw, base64); every agent
// request after enrollment is signed with its private half.
// inventory: what the Asset's own fields don't hold (disks, adapters,
// domain, last boot, signed-in user, and assignedBy: 'agent' when the agent
// set the Asset's assigned contact).
module.exports = (sequelize) => {
  class Device extends Model {
    isRevoked() { return !!this.revokedAt; }
  }

  Device.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      assetId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      enrollmentKeyId: { type: DataTypes.INTEGER, allowNull: true },
      publicKey: { type: DataTypes.STRING(64), allowNull: false },
      platform: { type: DataTypes.ENUM('windows', 'macos', 'linux'), allowNull: false },
      arch: { type: DataTypes.STRING(20), allowNull: false },
      agentVersion: { type: DataTypes.STRING(50), allowNull: false },
      hostname: { type: DataTypes.STRING(255), allowNull: false },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
      lastInventoryAt: { type: DataTypes.DATE, allowNull: true },
      // Scan now: set by staff, answered by the next heartbeat, cleared by
      // the inventory that follows.
      scanRequestedAt: { type: DataTypes.DATE, allowNull: true },
      // The package format this computer installs (msi, pkg, deb, rpm,
      // pacman); null from an agent before 8c. Updates are offered in it only.
      packageFormat: { type: DataTypes.STRING(10), allowNull: true },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      inventory: { type: DataTypes.JSON, allowNull: true },
    },
    { sequelize, modelName: 'Device', tableName: 'Devices', timestamps: true }
  );

  return Device;
};
