'use strict';

// Client portal (sub-project 7a): contacts sign in to a portal of their own.
//   Contacts         portalAccess switch, a password hash (for contacts who
//                    don't sign in with Microsoft) and the last sign-in time.
//   PortalTokens     one-time invite and password-reset links (sha256 only).
//   Company/DepartmentPortalAdmins
//                    contacts who see every ticket of their company or
//                    department in the portal.
//   TicketWatchers   a watcher is now a user OR a contact (exactly one).
//   Comments         authorContactId: a reply written in the portal;
//                    fromCustomer: a customer reply (portal or email).
//   Attachments      uploadedByContactId: a file the customer sent.
//   Tickets          portalCreatedByContactId: who raised it in the portal,
//                    when that isn't the ticket's contact.
//   KbArticles       visibility 'public' ("End users") becomes 'portal', read
//                    only by signed-in contacts; portalScope + KbArticleAudiences
//                    narrow it to chosen companies or departments.
// Plus the permission portal.manage and the setting portal.enabled (off).

const PERMISSION = {
  key: 'portal.manage', category: 'portal', label: 'Manage portal access', description: 'Turn portal access on for contacts, send invites and choose portal admins',
};
const SETTINGS = { 'portal.enabled': 'false' };

const contactFk = (dt, onDelete) => ({
  type: dt.INTEGER, allowNull: true, references: { model: 'Contacts', key: 'id' }, onUpdate: 'CASCADE', onDelete,
});

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

    const contacts = await qi.describeTable('Contacts');
    if (!contacts.portalAccess) await qi.addColumn('Contacts', 'portalAccess', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
    if (!contacts.passwordHash) await qi.addColumn('Contacts', 'passwordHash', { type: dt.STRING(255), allowNull: true });
    if (!contacts.portalLastSignInAt) await qi.addColumn('Contacts', 'portalLastSignInAt', { type: dt.DATE, allowNull: true });

    if (!tables.includes('PortalTokens')) {
      await qi.createTable('PortalTokens', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        contactId: fk('Contacts'),
        kind: { type: dt.ENUM('invite', 'reset'), allowNull: false },
        tokenHash: { type: dt.STRING(64), allowNull: false, unique: true },
        expiresAt: { type: dt.DATE, allowNull: false },
        usedAt: { type: dt.DATE, allowNull: true },
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('PortalTokens', ['contactId'], { name: 'portal_tokens_contact' });
    }
    if (!tables.includes('CompanyPortalAdmins')) {
      await qi.createTable('CompanyPortalAdmins', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        companyId: fk('Companies'),
        contactId: fk('Contacts'),
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('CompanyPortalAdmins', ['companyId', 'contactId'], { unique: true, name: 'company_portal_admins_pair' });
    }
    if (!tables.includes('DepartmentPortalAdmins')) {
      await qi.createTable('DepartmentPortalAdmins', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        departmentId: fk('Departments'),
        contactId: fk('Contacts'),
        createdAt: { type: dt.DATE, allowNull: false },
      });
      await qi.addIndex('DepartmentPortalAdmins', ['departmentId', 'contactId'], { unique: true, name: 'department_portal_admins_pair' });
    }

    const watchers = await qi.describeTable('TicketWatchers');
    if (!watchers.contactId) {
      // MODIFY keeps the existing userId foreign key and its unique index;
      // NULLs never collide in a unique index, so contact rows are fine there.
      // "Exactly one of userId/contactId" is the model's validation: MariaDB
      // refuses a CHECK on a column with a cascading foreign key.
      await qi.sequelize.query('ALTER TABLE TicketWatchers MODIFY userId INT NULL');
      await qi.addColumn('TicketWatchers', 'contactId', contactFk(dt, 'CASCADE'));
      await qi.addIndex('TicketWatchers', ['ticketId', 'contactId'], { unique: true, name: 'ticket_watchers_ticket_contact' });
    }

    const comments = await qi.describeTable('Comments');
    if (!comments.authorContactId) await qi.addColumn('Comments', 'authorContactId', contactFk(dt, 'SET NULL'));
    // A staff answer is type 'reply' too, so a customer reply needs its own
    // mark. Existing inbound email replies are found by their processing log
    // (same ticket, logged within a minute).
    if (!comments.fromCustomer) {
      await qi.addColumn('Comments', 'fromCustomer', { type: dt.BOOLEAN, allowNull: false, defaultValue: false });
      await qi.sequelize.query(
        `UPDATE Comments c JOIN EmailProcessingLogs l
            ON l.ticketId = c.ticketId AND l.action = 'reply_added'
           AND ABS(TIMESTAMPDIFF(SECOND, l.processedAt, c.createdAt)) <= 60
            SET c.fromCustomer = 1
          WHERE c.type = 'reply' AND c.viaEmail = 0`
      );
    }
    // Files the customer sent (portal upload, or an email that opened the
    // ticket). Staff uploads stay out of the portal unless they hang off a
    // public reply.
    if (!(await qi.describeTable('Attachments')).uploadedByContactId) {
      await qi.addColumn('Attachments', 'uploadedByContactId', contactFk(dt, 'SET NULL'));
      await qi.sequelize.query(
        `UPDATE Attachments a JOIN Tickets t ON t.id = a.ticketId
            SET a.uploadedByContactId = t.contactId
          WHERE t.source = 'email' AND t.contactId IS NOT NULL AND a.commentId IS NULL
            AND ABS(TIMESTAMPDIFF(SECOND, a.createdAt, t.createdAt)) <= 60`
      );
    }
    if (!(await qi.describeTable('Tickets')).portalCreatedByContactId) await qi.addColumn('Tickets', 'portalCreatedByContactId', contactFk(dt, 'SET NULL'));

    const articles = await qi.describeTable('KbArticles');
    if (!articles.portalScope) {
      await qi.sequelize.query("ALTER TABLE KbArticles MODIFY visibility ENUM('internal','public','portal') NOT NULL DEFAULT 'internal'");
      await qi.sequelize.query("UPDATE KbArticles SET visibility = 'portal' WHERE visibility = 'public'");
      await qi.sequelize.query("ALTER TABLE KbArticles MODIFY visibility ENUM('internal','portal') NOT NULL DEFAULT 'internal'");
      await qi.addColumn('KbArticles', 'portalScope', { type: dt.ENUM('all', 'companies', 'departments'), allowNull: false, defaultValue: 'all' });
    }
    if (!tables.includes('KbArticleAudiences')) {
      await qi.createTable('KbArticleAudiences', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        articleId: fk('KbArticles'),
        companyId: fk('Companies', 'CASCADE', true),
        departmentId: fk('Departments', 'CASCADE', true),
      });
      await qi.addIndex('KbArticleAudiences', ['articleId', 'companyId'], { unique: true, name: 'kb_article_audiences_company' });
      await qi.addIndex('KbArticleAudiences', ['articleId', 'departmentId'], { unique: true, name: 'kb_article_audiences_department' });
    }

    for (const [key, value] of Object.entries(SETTINGS)) {
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await select('SELECT `key` FROM SystemSettings WHERE `key` = :key', { key });
      // eslint-disable-next-line no-await-in-loop
      if (!existing) await qi.sequelize.query('INSERT INTO SystemSettings (`key`, value, updatedAt) VALUES (:key, :value, NOW())', { replacements: { key, value } });
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
    await qi.sequelize.query('DELETE FROM SystemSettings WHERE `key` IN (:keys)', { replacements: { keys: Object.keys(SETTINGS) } });

    if (tables.includes('KbArticleAudiences')) await qi.dropTable('KbArticleAudiences');
    if ((await qi.describeTable('KbArticles')).portalScope) {
      // Only an article every signed-in contact could read goes back to
      // "End users"; one narrowed to chosen companies or departments must not
      // become readable by anyone on the anonymous /kb, so it turns internal.
      await qi.sequelize.query("ALTER TABLE KbArticles MODIFY visibility ENUM('internal','public','portal') NOT NULL DEFAULT 'internal'");
      await qi.sequelize.query("UPDATE KbArticles SET visibility = IF(portalScope = 'all', 'public', 'internal') WHERE visibility = 'portal'");
      await qi.sequelize.query("ALTER TABLE KbArticles MODIFY visibility ENUM('internal','public') NOT NULL DEFAULT 'internal'");
      await qi.removeColumn('KbArticles', 'portalScope');
    }

    if ((await qi.describeTable('Tickets')).portalCreatedByContactId) await qi.removeColumn('Tickets', 'portalCreatedByContactId');
    if ((await qi.describeTable('Attachments')).uploadedByContactId) await qi.removeColumn('Attachments', 'uploadedByContactId');
    if ((await qi.describeTable('Comments')).fromCustomer) await qi.removeColumn('Comments', 'fromCustomer');
    if ((await qi.describeTable('Comments')).authorContactId) await qi.removeColumn('Comments', 'authorContactId');

    if ((await qi.describeTable('TicketWatchers')).contactId) {
      await qi.sequelize.query('DELETE FROM TicketWatchers WHERE userId IS NULL');
      // MariaDB won't drop a column that is part of a multi-column index
      // (error 1072), so the pair index goes first, and the foreign key with it.
      const [fk] = await select(
        `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TicketWatchers' AND COLUMN_NAME = 'contactId' AND REFERENCED_TABLE_NAME IS NOT NULL`
      );
      if (fk) await qi.sequelize.query(`ALTER TABLE TicketWatchers DROP FOREIGN KEY \`${fk.name}\``);
      if ((await qi.showIndex('TicketWatchers')).some((i) => i.name === 'ticket_watchers_ticket_contact')) {
        await qi.removeIndex('TicketWatchers', 'ticket_watchers_ticket_contact');
      }
      await qi.removeColumn('TicketWatchers', 'contactId');
      await qi.sequelize.query('ALTER TABLE TicketWatchers MODIFY userId INT NOT NULL');
    }

    for (const table of ['DepartmentPortalAdmins', 'CompanyPortalAdmins', 'PortalTokens']) {
      // eslint-disable-next-line no-await-in-loop
      if (tables.includes(table)) await qi.dropTable(table);
    }
    const contacts = await qi.describeTable('Contacts');
    for (const col of ['portalLastSignInAt', 'passwordHash', 'portalAccess']) {
      // eslint-disable-next-line no-await-in-loop
      if (contacts[col]) await qi.removeColumn('Contacts', col);
    }
  },
};
