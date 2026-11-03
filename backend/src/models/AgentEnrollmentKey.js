const { DataTypes, Model } = require('sequelize');

// A per-company secret an agent install command carries (8a). Only its
// sha256 is stored; the secret is shown once, when it's created.
module.exports = (sequelize) => {
  class AgentEnrollmentKey extends Model {
    isUsable(now = new Date()) {
      return !this.revokedAt && (!this.expiresAt || this.expiresAt > now);
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
    },
    {
      sequelize,
      modelName: 'AgentEnrollmentKey',
      tableName: 'AgentEnrollmentKeys',
      timestamps: true,
      // The hash never leaves the model unless asked for by name.
      defaultScope: { attributes: { exclude: ['keyHash'] } },
      scopes: { withHash: {} },
    }
  );

  return AgentEnrollmentKey;
};
