const { DataTypes, Model } = require('sequelize');

// One in-flight SSO login. Held server-side rather than in the session
// because SAML's HTTP-POST binding returns a cross-site POST, which the
// browser will not accompany with a sameSite=lax cookie. Rows are single-use
// (consumedAt) and expiring, which also gives OIDC replay protection through
// the same path.
module.exports = (sequelize) => {
  class SsoAuthRequest extends Model {
    isUsable(now = new Date()) {
      return !this.consumedAt && this.expiresAt > now;
    }
  }

  SsoAuthRequest.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      state: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      providerId: { type: DataTypes.INTEGER, allowNull: false },
      nonce: { type: DataTypes.STRING(128), allowNull: true },
      codeVerifier: { type: DataTypes.STRING(255), allowNull: true },
      returnTo: { type: DataTypes.STRING(500), allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      consumedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'SsoAuthRequest', tableName: 'SsoAuthRequests', timestamps: true }
  );

  return SsoAuthRequest;
};
