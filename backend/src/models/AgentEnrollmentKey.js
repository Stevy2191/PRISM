const { DataTypes, Model } = require('sequelize');

// A per-company secret an agent install command carries (8a). Enrollment
// matches its sha256. Since 8d the secret is also kept encrypted
// (secretEnc), so staff with Manage devices can copy it again; keys made
// before have none until rotated.
module.exports = (sequelize) => {
  class AgentEnrollmentKey extends Model {
    isUsable(now = new Date()) {
      return !this.revokedAt && (!this.expiresAt || this.expiresAt > now) && !this.isUsedUp();
    }

    isUsedUp() {
      return this.maxUses !== null && this.maxUses !== undefined && this.enrolledCount >= this.maxUses;
    }
  }

  AgentEnrollmentKey.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      keyHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      createdById: { type: DataTypes.INTEGER, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      enrolledCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      secretEnc: { type: DataTypes.TEXT, allowNull: true },
      maxUses: { type: DataTypes.INTEGER, allowNull: true },
      lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AgentEnrollmentKey',
      tableName: 'AgentEnrollmentKeys',
      timestamps: true,
      // The hash and the encrypted secret never leave the model unless
      // asked for by name.
      defaultScope: { attributes: { exclude: ['keyHash', 'secretEnc'] } },
      scopes: { withHash: {} },
    }
  );

  return AgentEnrollmentKey;
};
