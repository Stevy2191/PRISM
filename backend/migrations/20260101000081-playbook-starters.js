'use strict';

// Playbooks (PB, task 10): vendor-neutral starter forms and playbooks, for
// each organization to copy and edit. Seeded only into an install with no
// forms yet, so nothing an organization built is touched; once deleted they
// don't come back (this migration runs once). The definitions are in
// src/services/playbooks/starters.js, checked by the starters test.

const { FORMS, PLAYBOOKS } = require('../src/services/playbooks/starters');
const { validateDefinition } = require('../src/services/playbooks/formDefinition');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const [{ n }] = await select('SELECT COUNT(*) AS n FROM Forms');
    if (Number(n) > 0) return;
    const now = new Date();
    const ids = {};
    for (const f of FORMS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.bulkInsert('Forms', [{
        name: f.name, description: f.description, usage: f.usage, isActive: true, currentVersionId: null, createdBy: null, createdAt: now, updatedAt: now,
      }]);
      // eslint-disable-next-line no-await-in-loop
      const [form] = await select('SELECT id FROM Forms WHERE name = :name AND createdBy IS NULL ORDER BY id DESC LIMIT 1', { name: f.name });
      // eslint-disable-next-line no-await-in-loop
      await qi.bulkInsert('FormVersions', [{
        formId: form.id, version: 1, definition: JSON.stringify(validateDefinition(f.definition, { usage: f.usage })), createdBy: null, createdAt: now,
      }]);
      // eslint-disable-next-line no-await-in-loop
      const [version] = await select('SELECT id FROM FormVersions WHERE formId = :id AND version = 1', { id: form.id });
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('UPDATE Forms SET currentVersionId = :v WHERE id = :id', { replacements: { v: version.id, id: form.id } });
      ids[f.ref] = form.id;
    }
    for (const [i, p] of PLAYBOOKS.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await qi.bulkInsert('Playbooks', [{
        name: p.name,
        description: p.description,
        needsPerson: p.needsPerson,
        companyIds: null,
        blocks: JSON.stringify(p.blocks.map((b) => ({ formId: ids[b.form], applies: b.applies, limits: b.limits }))),
        isActive: true,
        position: i + 1,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      }]);
    }
  },

  // Removes the starters that nobody has used or changed: a playbook still
  // as seeded, and a form with only its first version and no ticket forms.
  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, replacements });
    const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (!tables.includes('Forms')) return;
    for (const p of PLAYBOOKS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query(
        `DELETE FROM Playbooks WHERE name = :name AND createdBy IS NULL
           AND NOT EXISTS (SELECT 1 FROM TicketPlaybooks tp WHERE tp.playbookId = Playbooks.id)`,
        { replacements: { name: p.name } }
      );
    }
    for (const f of FORMS) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await select(
        `SELECT f.id FROM Forms f WHERE f.name = :name AND f.createdBy IS NULL
           AND (SELECT COUNT(*) FROM FormVersions v WHERE v.formId = f.id) = 1
           AND NOT EXISTS (SELECT 1 FROM TicketForms tf JOIN FormVersions v ON v.id = tf.formVersionId WHERE v.formId = f.id)`,
        { name: f.name }
      );
      for (const { id } of rows) {
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM FormVersions WHERE formId = :id', { replacements: { id } });
        // eslint-disable-next-line no-await-in-loop
        await qi.sequelize.query('DELETE FROM Forms WHERE id = :id', { replacements: { id } });
      }
    }
  },
};
