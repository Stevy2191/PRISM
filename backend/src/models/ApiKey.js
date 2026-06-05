const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ApiKey extends Model {
    // Never serialize the hash.
    toJSON() {
      const values = { ...this.get() };
      delete values.keyHash;
      return values;
    }
  }

  ApiKey.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      keyHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // First 8 chars of the plaintext key, stored to let users identify a key
      // in listings without exposing the secret.
      prefix: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      lastUsed: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'ApiKey',
      tableName: 'ApiKeys',
      timestamps: true,
      updatedAt: false,
    }
  );

  return ApiKey;
};
