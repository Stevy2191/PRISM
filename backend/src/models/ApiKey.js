const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ApiKey extends Model {
    // Never serialize either hash.
    toJSON() {
      const values = { ...this.get() };
      delete values.keyHash;
      delete values.lookupHash;
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
      // bcrypt hash of a key made before migration 099; null once the key
      // has a lookupHash (every new key, and an old one after its first use).
      keyHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // SHA-256 (hex) of the whole key, looked up directly (see
      // services/apiKeys). A key is 32 random bytes, so a fast hash is enough.
      lookupHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
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
