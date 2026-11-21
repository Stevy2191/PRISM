const { DataTypes, Model } = require('sequelize');

// A consent waiting for its person, then the one-time code it issued
// (MCP-O). The id is the consent page's address; the code is stored as its
// SHA-256 only.
module.exports = (sequelize) => {
  class OAuthRequest extends Model {}
  OAuthRequest.init({
    id: { type: DataTypes.STRING(64), primaryKey: true },
    clientId: { type: DataTypes.INTEGER, allowNull: false },
    redirectUri: { type: DataTypes.STRING(1024), allowNull: false },
    state: { type: DataTypes.TEXT, allowNull: true },
    codeChallenge: { type: DataTypes.STRING(128), allowNull: false },
    scope: { type: DataTypes.STRING(255), allowNull: false },
    resource: { type: DataTypes.STRING(1024), allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    codeHash: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize, modelName: 'OAuthRequest', tableName: 'OAuthRequests', timestamps: true, updatedAt: false,
  });
  return OAuthRequest;
};
