'use strict';

// The PRISM agent (sub-project 8a): computers that report themselves.
//   AgentEnrollmentKeys  per-company secrets an install command carries
//                        (sha256 only); revocable, optionally expiring.
//   Devices              one per agent-managed Asset: the device's Ed25519
//                        public key, platform, agent version, last seen and
//                        inventory detail beyond the Asset's own fields.
//   AssetSoftware        the installed-software list, replaced at each
//                        inventory.
//   AgentNonces          single-use request nonces per device (replay guard).
//   Tickets.source       gains 'agent' (raised from the tray).
// Plus the permission devices.manage. The update-signing key
// (agent.updateKey) is created on first use, not here.

const PERMISSION = {
  key: 'devices.manage', category: 'assets', label: 'Manage devices', description: 'Create and revoke agent enrollment keys, and revoke enrolled computers',
};
const SOURCES = "'manual','email','phone','portal','recurring'";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const now = new Date();
    const fk = (model, onDelete = 'CASCADE', allowNull = false) => ({
      type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onUpdate: 'CASCADE', onDelete,
    });

    if (!tables.includes('AgentEnrollmentKeys')) {
      await qi.createTable('AgentEnrollmentKeys', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: fk('Companies'),
        name: { type: dt.STRING(100), allowNull: false },
        keyHash: { type: dt.STRING(64), allowNull: false, unique: true },
        createdById: fk('Users', 'SET NULL', true),
        expiresAt: { type: dt.DATE, allowNull: true },
        revokedAt: { type: dt.DATE, allowNull: true },
        enrolledCount: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('AgentEnrollmentKeys', ['companyId'], { name: 'agent_keys_company' });
    }
    if (!tables.includes('Devices')) {
      await qi.createTable('Devices', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: { ...fk('Assets'), unique: true },
        companyId: fk('Companies'),
        enrollmentKeyId: fk('AgentEnrollmentKeys', 'SET NULL', true),
        publicKey: { type: dt.STRING(64), allowNull: false },
        platform: { type: dt.ENUM('windows', 'macos', 'linux'), allowNull: false },
        arch: { type: dt.STRING(20), allowNull: false },
        agentVersion: { type: dt.STRING(50), allowNull: false },
        hostname: { type: dt.STRING(255), allowNull: false },
        lastSeenAt: { type: dt.DATE, allowNull: true },
        lastInventoryAt: { type: dt.DATE, allowNull: true },
        revokedAt: { type: dt.DATE, allowNull: true },
        inventory: { type: dt.JSON, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('Devices', ['companyId'], { name: 'devices_company' });
      await qi.addIndex('Devices', ['lastSeenAt'], { name: 'devices_last_seen' });
    }
    if (!tables.includes('AssetSoftware')) {
      await qi.createTable('AssetSoftware', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        assetId: fk('Assets'),
        name: { type: dt.STRING(255), allowNull: false },
        version: { type: dt.STRING(100), allowNull: true },
        publisher: { type: dt.STRING(255), allowNull: true },
        installDate: { type: dt.DATEONLY, allowNull: true },
      });
      await qi.addIndex('AssetSoftware', ['assetId'], { name: 'asset_software_asset' });
      await qi.addIndex('AssetSoftware', ['name'], { name: 'asset_software_name' });
    }
    if (!tables.includes('AgentNonces')) {
      await qi.createTable('AgentNonces', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        deviceId: fk('Devices'),
        nonce: { type: dt.STRING(32), allowNull: false },
        seenAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('AgentNonces', ['deviceId', 'nonce'], { unique: true, name: 'agent_nonces_device_nonce' });
      await qi.addIndex('AgentNonces', ['seenAt'], { name: 'agent_nonces_seen' });
    }

    const [col] = await select(
      "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tickets' AND COLUMN_NAME = 'source'"
    );
    if (col && !col.type.includes("'agent'")) {
      await qi.sequelize.query(`ALTER TABLE Tickets MODIFY source ENUM(${SOURCES},'agent') NOT NULL DEFAULT 'manual'`);
    }

    const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (!existing) await qi.bulkInsert('Permissions', [{ ...PERMISSION, createdAt: now }]);
    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    await qi.sequelize.query(
      `INSERT INTO RolePermissions (roleId, permissionId, granted)
       SELECT r.id, :pid, 1 FROM Roles r
        WHERE r.name = 'System Administrator'
          AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
      { replacements: { pid: perm.id } }
    );
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));

    const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: PERMISSION.key });
    if (perm) {
      await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
      await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
    }
    await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key: PERMISSION.key } });
    await qi.sequelize.query("DELETE FROM SystemSettings WHERE `key` = 'agent.updateKey'");

    const [col] = await select(
      "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Tickets' AND COLUMN_NAME = 'source'"
    );
    if (col && col.type.includes("'agent'")) {
      // Tray tickets stay, as ordinary manual ones.
      await qi.sequelize.query("UPDATE Tickets SET source = 'manual' WHERE source = 'agent'");
      await qi.sequelize.query(`ALTER TABLE Tickets MODIFY source ENUM(${SOURCES}) NOT NULL DEFAULT 'manual'`);
    }

    for (const table of ['AgentNonces', 'AssetSoftware', 'Devices', 'AgentEnrollmentKeys']) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await qi.dropTable(table);
    }
  },
};
