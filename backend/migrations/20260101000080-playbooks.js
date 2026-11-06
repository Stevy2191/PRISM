'use strict';

// Playbooks (sub-project PB): forms and checklists on tickets, and the device
// lifecycle.
//   Mdms                       the MDMs an install uses (its own list)
//   Assets                     managed / MDM / MDM device ID; cellular with
//                              IMEI, phone number and carrier (a vendor
//                              company); a hold reason; statuses gain
//                              ready_to_issue and on_hold
//   AssetCategories            cellularByDefault
//   Forms, FormVersions        reusable forms; each save is a new version
//   Playbooks                  named sets of form blocks
//   TicketPlaybooks            a playbook applied to a ticket, for a person
//   TicketForms                a form on a ticket (shown as one ticket task)
//   TicketFormSecrets          a form's secure values, encrypted
//   TicketPlaybookSuggestions  playbooks a workflow rule suggested
// Plus the permissions settings.manage_playbooks, tickets.view_secure_fields
// and tickets.override_checklist.

const PERMISSIONS = [
  {
    key: 'settings.manage_playbooks',
    category: 'settings',
    label: 'Manage forms, playbooks and MDMs',
    description: 'Build forms and playbooks, and keep the list of MDMs',
    roles: ['System Administrator'],
  },
  {
    key: 'tickets.view_secure_fields',
    category: 'tickets',
    label: 'Reveal secure form values',
    description: 'Reveal passwords, codes and other secure values recorded on ticket forms (every reveal is logged)',
    roles: ['System Administrator', 'System Technician'],
  },
  {
    key: 'tickets.override_checklist',
    category: 'tickets',
    label: 'Close tickets with unfinished forms',
    description: 'Close a ticket whose forms still have required steps, giving a reason',
    roles: ['System Administrator'],
  },
];
const OLD_STATUSES = "'active','in_repair','retired','in_storage','lost'";
const NEW_STATUSES = `${OLD_STATUSES},'ready_to_issue','on_hold'`;
const ASSET_COLUMNS = ['isManaged', 'mdmId', 'mdmDeviceId', 'hasCellular', 'imei', 'phoneNumber', 'carrierCompanyId', 'holdReason'];
const TABLES = ['TicketPlaybookSuggestions', 'TicketFormSecrets', 'TicketForms', 'TicketPlaybooks', 'Playbooks', 'FormVersions', 'Forms'];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const dt = Sequelize;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: dt.QueryTypes.SELECT, replacements });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const columnsOf = async (table) => (await select(
      'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
      { table }
    )).map((r) => r.c);
    const now = new Date();
    const fk = (model, onDelete = 'CASCADE', allowNull = false) => ({
      type: dt.INTEGER, allowNull, references: { model, key: 'id' }, onUpdate: 'CASCADE', onDelete,
    });

    if (!tables.includes('Mdms')) {
      await qi.createTable('Mdms', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(100), allowNull: false, unique: true },
        consoleUrl: { type: dt.STRING(500), allowNull: true },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }

    const assetCols = await columnsOf('Assets');
    const addAsset = async (name, spec) => { if (!assetCols.includes(name)) await qi.addColumn('Assets', name, spec); };
    await addAsset('isManaged', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    await addAsset('mdmId', fk('Mdms', 'SET NULL', true));
    await addAsset('mdmDeviceId', { type: dt.STRING(150), allowNull: true });
    await addAsset('hasCellular', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    await addAsset('imei', { type: dt.STRING(20), allowNull: true });
    await addAsset('phoneNumber', { type: dt.STRING(40), allowNull: true });
    await addAsset('carrierCompanyId', fk('Companies', 'SET NULL', true));
    await addAsset('holdReason', { type: dt.STRING(255), allowNull: true });
    const indexes = (await select("SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets'")).map((r) => r.n);
    if (!indexes.includes('assets_imei')) await qi.addIndex('Assets', ['imei'], { name: 'assets_imei' });
    if (!indexes.includes('assets_phone_number')) await qi.addIndex('Assets', ['phoneNumber'], { name: 'assets_phone_number' });

    const [status] = await select(
      "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets' AND COLUMN_NAME = 'status'"
    );
    if (status && !status.type.includes("'on_hold'")) {
      await qi.sequelize.query(`ALTER TABLE Assets MODIFY status ENUM(${NEW_STATUSES}) NOT NULL DEFAULT 'active'`);
    }

    if (!(await columnsOf('AssetCategories')).includes('cellularByDefault')) {
      await qi.addColumn('AssetCategories', 'cellularByDefault', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    }

    if (!tables.includes('Forms')) {
      await qi.createTable('Forms', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        usage: { type: dt.ENUM('ticket', 'device'), allowNull: false },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        // Not a foreign key: FormVersions points back at Forms, and a cycle of
        // constraints would make either table hard to fill or drop.
        currentVersionId: { type: dt.INTEGER, allowNull: true },
        createdBy: fk('Users', 'SET NULL', true),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('FormVersions')) {
      await qi.createTable('FormVersions', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        formId: fk('Forms'),
        version: { type: dt.INTEGER, allowNull: false },
        definition: { type: dt.JSON, allowNull: false },
        createdBy: fk('Users', 'SET NULL', true),
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('FormVersions', ['formId', 'version'], { unique: true, name: 'form_versions_form_version' });
    }
    if (!tables.includes('Playbooks')) {
      await qi.createTable('Playbooks', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false },
        description: { type: dt.TEXT, allowNull: true },
        needsPerson: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        // null: offered for every company; else an array of company ids.
        companyIds: { type: dt.JSON, allowNull: true },
        blocks: { type: dt.JSON, allowNull: false },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdBy: fk('Users', 'SET NULL', true),
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
    }
    if (!tables.includes('TicketPlaybooks')) {
      await qi.createTable('TicketPlaybooks', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: fk('Tickets'),
        playbookId: fk('Playbooks', 'RESTRICT'),
        snapshot: { type: dt.JSON, allowNull: false },
        contactId: fk('Contacts', 'SET NULL', true),
        appliedBy: fk('Users', 'SET NULL', true),
        appliedAt: { type: dt.DATE, allowNull: false },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TicketPlaybooks', ['ticketId'], { name: 'ticket_playbooks_ticket' });
    }
    if (!tables.includes('TicketForms')) {
      await qi.createTable('TicketForms', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: fk('Tickets'),
        ticketPlaybookId: fk('TicketPlaybooks', 'CASCADE', true),
        formVersionId: fk('FormVersions', 'RESTRICT'),
        assetId: fk('Assets', 'SET NULL', true),
        taskId: { ...fk('Tasks'), unique: true },
        answers: { type: dt.JSON, allowNull: false },
        state: { type: dt.ENUM('open', 'finished', 'skipped'), allowNull: false, defaultValue: 'open' },
        skipReason: { type: dt.STRING(500), allowNull: true },
        finishedAt: { type: dt.DATE, allowNull: true },
        finishedBy: fk('Users', 'SET NULL', true),
        actionDoneAt: { type: dt.DATE, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
        updatedAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TicketForms', ['ticketId'], { name: 'ticket_forms_ticket' });
      await qi.addIndex('TicketForms', ['assetId', 'state'], { name: 'ticket_forms_asset_state' });
    }
    if (!tables.includes('TicketFormSecrets')) {
      await qi.createTable('TicketFormSecrets', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketFormId: fk('TicketForms'),
        itemKey: { type: dt.STRING(60), allowNull: false },
        ciphertext: { type: dt.TEXT, allowNull: false },
        setBy: fk('Users', 'SET NULL', true),
        setAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TicketFormSecrets', ['ticketFormId', 'itemKey'], { unique: true, name: 'ticket_form_secrets_item' });
    }
    if (!tables.includes('TicketPlaybookSuggestions')) {
      await qi.createTable('TicketPlaybookSuggestions', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        ticketId: fk('Tickets'),
        playbookId: fk('Playbooks'),
        ruleId: fk('WorkflowRules', 'SET NULL', true),
        dismissedAt: { type: dt.DATE, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('TicketPlaybookSuggestions', ['ticketId', 'playbookId'], { unique: true, name: 'ticket_playbook_suggestions_pair' });
    }

    for (const { roles, ...permission } of PERMISSIONS) {
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: permission.key });
      // eslint-disable-next-line no-await-in-loop
      if (!existing) await qi.bulkInsert('Permissions', [{ ...permission, createdAt: now }]);
      // eslint-disable-next-line no-await-in-loop
      const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key: permission.key });
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query(
        `INSERT INTO RolePermissions (roleId, permissionId, granted)
         SELECT r.id, :pid, 1 FROM Roles r
          WHERE r.name IN (:roles) AND r.isSystemRole = 1
            AND NOT EXISTS (SELECT 1 FROM RolePermissions x WHERE x.roleId = r.id AND x.permissionId = :pid)`,
        { replacements: { pid: perm.id, roles } }
      );
    }
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const columnsOf = async (table) => (await select(
      'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
      { table }
    )).map((r) => r.c);

    for (const { key } of PERMISSIONS) {
      // eslint-disable-next-line no-await-in-loop
      const [perm] = await select('SELECT id FROM Permissions WHERE `key` = :key', { key });
      if (perm) {
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM RolePermissions WHERE permissionId = :id', { replacements: { id: perm.id } });
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM Permissions WHERE id = :id', { replacements: { id: perm.id } });
      }
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('DELETE FROM UserPermissionOverrides WHERE permissionKey = :key', { replacements: { key } });
    }

    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await qi.dropTable(table);
    }

    if ((await columnsOf('AssetCategories')).includes('cellularByDefault')) {
      await qi.removeColumn('AssetCategories', 'cellularByDefault');
    }

    // The new statuses fold into their nearest old ones: ready to issue is in
    // storage; on hold is out of service, as in repair.
    const [status] = await select(
      "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets' AND COLUMN_NAME = 'status'"
    );
    if (status && status.type.includes("'on_hold'")) {
      await qi.sequelize.query("UPDATE Assets SET status = 'in_storage' WHERE status = 'ready_to_issue'");
      await qi.sequelize.query("UPDATE Assets SET status = 'in_repair' WHERE status = 'on_hold'");
      await qi.sequelize.query(`ALTER TABLE Assets MODIFY status ENUM(${OLD_STATUSES}) NOT NULL DEFAULT 'active'`);
    }

    const assetCols = await columnsOf('Assets');
    const indexes = (await select("SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets'")).map((r) => r.n);
    if (indexes.includes('assets_imei')) await qi.removeIndex('Assets', 'assets_imei');
    if (indexes.includes('assets_phone_number')) await qi.removeIndex('Assets', 'assets_phone_number');
    for (const column of ['mdmId', 'carrierCompanyId']) {
      if (!assetCols.includes(column)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const fks = await select(
        `SELECT CONSTRAINT_NAME AS n FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Assets' AND COLUMN_NAME = :column AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { column }
      );
      // eslint-disable-next-line no-await-in-loop
      for (const { n } of fks) await qi.removeConstraint('Assets', n);
    }
    for (const column of ASSET_COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      if (assetCols.includes(column)) await qi.removeColumn('Assets', column);
    }

    if (tables.includes('Mdms')) await qi.dropTable('Mdms');
  },
};
