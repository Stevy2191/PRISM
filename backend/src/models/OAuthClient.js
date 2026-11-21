const { DataTypes, Model } = require('sequelize');

// An app that may ask a person to connect it to PRISM (MCP-O): registered
// automatically (dcr) or described by its client ID metadata document (cimd,
// clientId is then that document's https URL).
module.exports = (sequelize) => {
  class OAuthClient extends Model {}
  OAuthClient.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.STRING(512), allowNull: false, unique: true },
    kind: { type: DataTypes.ENUM('dcr', 'cimd'), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    redirectUris: { type: DataTypes.JSON, allowNull: false },
    fetchedAt: { type: DataTypes.DATE, allowNull: true },
  }, { sequelize, modelName: 'OAuthClient', tableName: 'OAuthClients', timestamps: true });
  return OAuthClient;
};
