const { DataTypes, Model } = require('sequelize');

// A nonce a device has used on a signed request (8a). Unique per device, so
// a captured request can't be replayed; rows older than 10 minutes are
// pruned (the timestamp window refuses anything older anyway).
module.exports = (sequelize) => {
  class AgentNonce extends Model {}

  AgentNonce.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      deviceId: { type: DataTypes.INTEGER, allowNull: false },
      nonce: { type: DataTypes.STRING(32), allowNull: false },
      seenAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      modelName: 'AgentNonce',
      tableName: 'AgentNonces',
      timestamps: false,
      indexes: [{ unique: true, fields: ['deviceId', 'nonce'], name: 'agent_nonces_device_nonce' }],
    }
  );

  return AgentNonce;
};
