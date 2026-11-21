const { DataTypes, Model } = require('sequelize');

// One person's connection of one app (MCP-O). Access and refresh tokens are
// stored as SHA-256 only and never serialized; the refresh token rotates on
// every use, and the one it replaced is kept to catch a stolen copy.
module.exports = (sequelize) => {
  class OAuthConnection extends Model {
    toJSON() {
      const v = { ...this.get() };
      delete v.accessHash;
      delete v.refreshHash;
      delete v.previousRefreshHash;
      return v;
    }
  }
  OAuthConnection.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    scope: { type: DataTypes.STRING(255), allowNull: false },
    resource: { type: DataTypes.STRING(1024), allowNull: false },
    accessHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    accessExpiresAt: { type: DataTypes.DATE, allowNull: false },
    refreshHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    previousRefreshHash: { type: DataTypes.STRING(64), allowNull: true },
    refreshExpiresAt: { type: DataTypes.DATE, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    revokedReason: { type: DataTypes.STRING(32), allowNull: true },
  }, {
    sequelize, modelName: 'OAuthConnection', tableName: 'OAuthConnections', timestamps: true, updatedAt: false,
  });
  return OAuthConnection;
};
