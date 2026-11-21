'use strict';

// Claude connects with OAuth (MCP-O).
//   + OAuthClients: apps that may ask to connect, registered automatically
//     (DCR) or described by a client ID metadata document (CIMD).
//   + OAuthRequests: a consent waiting for its person, then the one-time code
//     it issued (10 minutes).
//   + OAuthConnections: one per person and app; access and refresh tokens,
//     stored as SHA-256 only, rotated on refresh.
// Settings mcp.enabled / mcp.allowWrites / mcp.allowedDomains live in
// SystemSettings with defaults in code (off, read-only, Claude's domains).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const now = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    if (!tables.includes('OAuthClients')) {
      await queryInterface.createTable('OAuthClients', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        clientId: { type: Sequelize.STRING(512), allowNull: false },
        kind: { type: Sequelize.ENUM('dcr', 'cimd'), allowNull: false },
        name: { type: Sequelize.STRING(255), allowNull: false },
        redirectUris: { type: Sequelize.JSON, allowNull: false },
        fetchedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('OAuthClients', ['clientId'], { unique: true, name: 'oauth_clients_client_id' });
    }

    if (!tables.includes('OAuthRequests')) {
      await queryInterface.createTable('OAuthRequests', {
        id: { type: Sequelize.STRING(64), primaryKey: true },
        clientId: {
          type: Sequelize.INTEGER, allowNull: false, references: { model: 'OAuthClients', key: 'id' }, onDelete: 'CASCADE',
        },
        redirectUri: { type: Sequelize.STRING(1024), allowNull: false },
        state: { type: Sequelize.TEXT, allowNull: true },
        codeChallenge: { type: Sequelize.STRING(128), allowNull: false },
        scope: { type: Sequelize.STRING(255), allowNull: false },
        resource: { type: Sequelize.STRING(1024), allowNull: false },
        userId: {
          type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE',
        },
        codeHash: { type: Sequelize.STRING(64), allowNull: true },
        expiresAt: { type: Sequelize.DATE, allowNull: false },
        usedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('OAuthRequests', ['codeHash'], { unique: true, name: 'oauth_requests_code_hash' });
    }

    if (!tables.includes('OAuthConnections')) {
      await queryInterface.createTable('OAuthConnections', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        clientId: {
          type: Sequelize.INTEGER, allowNull: false, references: { model: 'OAuthClients', key: 'id' }, onDelete: 'CASCADE',
        },
        userId: {
          type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE',
        },
        scope: { type: Sequelize.STRING(255), allowNull: false },
        resource: { type: Sequelize.STRING(1024), allowNull: false },
        accessHash: { type: Sequelize.STRING(64), allowNull: false },
        accessExpiresAt: { type: Sequelize.DATE, allowNull: false },
        refreshHash: { type: Sequelize.STRING(64), allowNull: false },
        previousRefreshHash: { type: Sequelize.STRING(64), allowNull: true },
        refreshExpiresAt: { type: Sequelize.DATE, allowNull: false },
        lastUsedAt: { type: Sequelize.DATE, allowNull: true },
        revokedAt: { type: Sequelize.DATE, allowNull: true },
        revokedReason: { type: Sequelize.STRING(32), allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('OAuthConnections', ['accessHash'], { unique: true, name: 'oauth_connections_access' });
      await queryInterface.addIndex('OAuthConnections', ['refreshHash'], { unique: true, name: 'oauth_connections_refresh' });
      await queryInterface.addIndex('OAuthConnections', ['previousRefreshHash'], { name: 'oauth_connections_previous_refresh' });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('OAuthConnections');
    await queryInterface.dropTable('OAuthRequests');
    await queryInterface.dropTable('OAuthClients');
    await queryInterface.sequelize.query("DELETE FROM SystemSettings WHERE `key` LIKE 'mcp.%'");
  },
};
