'use strict';

// Playbooks, simpler: checklists and bundles (PB2).
//   TicketForms.contactId         the person a checklist added on its own is for
//   Playbooks.suggestCategoryIds  ticket categories a bundle suggests itself on
// And the three playbook permissions get the screens' words: forms are
// checklists, playbooks are bundles. Their keys don't change.

const LABELS = [
  {
    key: 'settings.manage_playbooks',
    label: 'Manage checklists, bundles and MDMs',
    description: 'Build checklists and bundles, and keep the list of MDMs',
    was: ['Manage forms, playbooks and MDMs', 'Build forms and playbooks, and keep the list of MDMs'],
  },
  {
    key: 'tickets.view_secure_fields',
    label: 'Reveal hidden passwords and codes on checklists',
    description: 'Reveal passwords, codes and other hidden values recorded on ticket checklists (every reveal is logged)',
    was: ['Reveal secure form values', 'Reveal passwords, codes and other secure values recorded on ticket forms (every reveal is logged)'],
  },
  {
    key: 'tickets.override_checklist',
    label: 'Close tickets with unfinished checklists',
    description: 'Close a ticket whose checklists still have required steps, giving a reason',
    was: ['Close tickets with unfinished forms', 'Close a ticket whose forms still have required steps, giving a reason'],
  },
];

async function columnsOf(qi, Sequelize, table) {
  const rows = await qi.sequelize.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
    { type: Sequelize.QueryTypes.SELECT, replacements: { table } }
  );
  return rows.map((r) => r.c);
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    if (!(await columnsOf(qi, Sequelize, 'TicketForms')).includes('contactId')) {
      await qi.addColumn('TicketForms', 'contactId', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Contacts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
    if (!(await columnsOf(qi, Sequelize, 'Playbooks')).includes('suggestCategoryIds')) {
      await qi.addColumn('Playbooks', 'suggestCategoryIds', { type: Sequelize.JSON, allowNull: true });
    }
    for (const { key, label, description } of LABELS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('UPDATE Permissions SET label = :label, description = :description WHERE `key` = :key', {
        replacements: { key, label, description },
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    for (const { key, was: [label, description] } of LABELS) {
      // eslint-disable-next-line no-await-in-loop
      await qi.sequelize.query('UPDATE Permissions SET label = :label, description = :description WHERE `key` = :key', {
        replacements: { key, label, description },
      });
    }
    if ((await columnsOf(qi, Sequelize, 'Playbooks')).includes('suggestCategoryIds')) {
      await qi.removeColumn('Playbooks', 'suggestCategoryIds');
    }
    if ((await columnsOf(qi, Sequelize, 'TicketForms')).includes('contactId')) {
      // MariaDB needs the foreign key gone before the column.
      const [fk] = await qi.sequelize.query(
        `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TicketForms' AND COLUMN_NAME = 'contactId' AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { type: Sequelize.QueryTypes.SELECT }
      );
      if (fk) await qi.removeConstraint('TicketForms', fk.name);
      await qi.removeColumn('TicketForms', 'contactId');
    }
  },
};
