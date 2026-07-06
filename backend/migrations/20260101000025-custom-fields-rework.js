'use strict';

// Reworks the CustomFields/TicketFieldValues scaffolding (added early on but
// never wired into any UI — no field editor, no ticket-form integration) to
// match the full custom-fields-builder spec:
//   - CustomFields: name -> label, + fieldKey slug, ticketType (single) ->
//     ticketTypes (JSON array), required -> isRequired, + isActive,
//     + placeholder/defaultValue, displayOrder -> position, + createdBy,
//     fieldType ENUM gains multiselect/datetime/email/phone and renames
//     'select' -> 'dropdown'. departmentId scoping is dropped — the new
//     spec scopes fields by ticket type only.
//   - TicketFieldValues: customFieldId -> fieldId (matches the new fieldKey
//     naming throughout the API).
// Since nothing reads this table from the frontend yet, this is a straight
// rework rather than an additive/legacy-preserving change — but the
// migration still defensively backfills any rows that do exist rather than
// assuming the table is empty.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt, QueryTypes } = Sequelize;

    const cfCols = await queryInterface.describeTable('CustomFields');

    // ---- Rename simple columns first (data-preserving) ----
    if (cfCols.name && !cfCols.label) {
      await queryInterface.renameColumn('CustomFields', 'name', 'label');
    }
    if (cfCols.required && !cfCols.isRequired) {
      await queryInterface.renameColumn('CustomFields', 'required', 'isRequired');
    }
    if (cfCols.displayOrder && !cfCols.position) {
      await queryInterface.renameColumn('CustomFields', 'displayOrder', 'position');
    }

    const colsAfterRename = await queryInterface.describeTable('CustomFields');

    // ---- Add new columns ----
    if (!colsAfterRename.fieldKey) {
      await queryInterface.addColumn('CustomFields', 'fieldKey', { type: dt.STRING(100), allowNull: true });
    }
    if (!colsAfterRename.ticketTypes) {
      await queryInterface.addColumn('CustomFields', 'ticketTypes', { type: dt.JSON, allowNull: true });
    }
    if (!colsAfterRename.isActive) {
      await queryInterface.addColumn('CustomFields', 'isActive', { type: dt.BOOLEAN, allowNull: false, defaultValue: true });
    }
    if (!colsAfterRename.placeholder) {
      await queryInterface.addColumn('CustomFields', 'placeholder', { type: dt.STRING(255), allowNull: true });
    }
    if (!colsAfterRename.defaultValue) {
      await queryInterface.addColumn('CustomFields', 'defaultValue', { type: dt.TEXT, allowNull: true });
    }
    if (!colsAfterRename.createdBy) {
      await queryInterface.addColumn('CustomFields', 'createdBy', { type: dt.INTEGER, allowNull: true });
    }
    if (!colsAfterRename.updatedAt) {
      await queryInterface.addColumn('CustomFields', 'updatedAt', { type: dt.DATE, allowNull: true });
      await queryInterface.sequelize.query('UPDATE CustomFields SET updatedAt = createdAt WHERE updatedAt IS NULL');
      await queryInterface.sequelize.query('ALTER TABLE CustomFields MODIFY COLUMN updatedAt DATETIME NOT NULL');
    }

    // ---- Data migration: old singular ticketType -> new ticketTypes array ----
    if (colsAfterRename.ticketType) {
      const rows = await queryInterface.sequelize.query(
        'SELECT id, ticketType FROM CustomFields WHERE ticketType IS NOT NULL',
        { type: QueryTypes.SELECT }
      );
      // eslint-disable-next-line no-restricted-syntax
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(
          'UPDATE CustomFields SET ticketTypes = :types WHERE id = :id',
          { replacements: { types: JSON.stringify([row.ticketType]), id: row.id } }
        );
      }
      await queryInterface.sequelize.query('ALTER TABLE CustomFields DROP COLUMN ticketType');
    }
    if (colsAfterRename.departmentId) {
      const fks = await queryInterface.sequelize.query(`
        SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CustomFields'
          AND COLUMN_NAME = 'departmentId' AND REFERENCED_TABLE_NAME IS NOT NULL
      `, { type: QueryTypes.SELECT });
      // eslint-disable-next-line no-restricted-syntax
      for (const fk of fks) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(`ALTER TABLE CustomFields DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      }
      await queryInterface.sequelize.query('ALTER TABLE CustomFields DROP COLUMN departmentId');
    }

    // ---- fieldType ENUM: add new values, migrate 'select' -> 'dropdown' ----
    await queryInterface.sequelize.query(
      "ALTER TABLE CustomFields MODIFY COLUMN fieldType ENUM('text','textarea','number','date','datetime','dropdown','multiselect','checkbox','url','email','phone','select') NOT NULL DEFAULT 'text'"
    );
    await queryInterface.sequelize.query("UPDATE CustomFields SET fieldType = 'dropdown' WHERE fieldType = 'select'");
    await queryInterface.sequelize.query(
      "ALTER TABLE CustomFields MODIFY COLUMN fieldType ENUM('text','textarea','number','date','datetime','dropdown','multiselect','checkbox','url','email','phone') NOT NULL DEFAULT 'text'"
    );

    // ---- Backfill fieldKey + position for any existing rows, then enforce constraints ----
    const existingFields = await queryInterface.sequelize.query(
      'SELECT id, label, fieldKey FROM CustomFields ORDER BY position ASC, id ASC',
      { type: QueryTypes.SELECT }
    );
    const usedKeys = new Set();
    let nextPosition = 1;
    // eslint-disable-next-line no-restricted-syntax
    for (const row of existingFields) {
      let key = row.fieldKey;
      if (!key) {
        let base = String(row.label || 'field').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
        key = base;
        let n = 2;
        while (usedKeys.has(key)) { key = `${base}_${n}`; n += 1; }
      }
      usedKeys.add(key);
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.sequelize.query(
        'UPDATE CustomFields SET fieldKey = :key, position = :position WHERE id = :id',
        { replacements: { key, position: nextPosition, id: row.id } }
      );
      nextPosition += 1;
    }
    await queryInterface.sequelize.query('ALTER TABLE CustomFields MODIFY COLUMN fieldKey VARCHAR(100) NOT NULL');
    await queryInterface.addIndex('CustomFields', ['fieldKey'], { unique: true, name: 'custom_fields_field_key_unique' });

    // ---- TicketFieldValues: customFieldId -> fieldId ----
    const tfvCols = await queryInterface.describeTable('TicketFieldValues');
    if (tfvCols.customFieldId && !tfvCols.fieldId) {
      await queryInterface.renameColumn('TicketFieldValues', 'customFieldId', 'fieldId');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;

    const tfvCols = await queryInterface.describeTable('TicketFieldValues');
    if (tfvCols.fieldId && !tfvCols.customFieldId) {
      await queryInterface.renameColumn('TicketFieldValues', 'fieldId', 'customFieldId');
    }

    const cfCols = await queryInterface.describeTable('CustomFields');
    try { await queryInterface.removeIndex('CustomFields', 'custom_fields_field_key_unique'); } catch { /* may not exist */ }

    if (cfCols.label && !cfCols.name) await queryInterface.renameColumn('CustomFields', 'label', 'name');
    if (cfCols.isRequired && !cfCols.required) await queryInterface.renameColumn('CustomFields', 'isRequired', 'required');
    if (cfCols.position && !cfCols.displayOrder) await queryInterface.renameColumn('CustomFields', 'position', 'displayOrder');

    if (!cfCols.ticketType) {
      await queryInterface.addColumn('CustomFields', 'ticketType', {
        type: dt.ENUM('incident', 'request', 'problem', 'task', 'change'),
        allowNull: true,
      });
    }
    if (!cfCols.departmentId) {
      await queryInterface.addColumn('CustomFields', 'departmentId', { type: dt.INTEGER, allowNull: true });
    }

    for (const col of ['fieldKey', 'ticketTypes', 'isActive', 'placeholder', 'defaultValue', 'createdBy']) {
      // eslint-disable-next-line no-await-in-loop
      const cols = await queryInterface.describeTable('CustomFields');
      if (cols[col]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.sequelize.query(`ALTER TABLE CustomFields DROP COLUMN ${col}`);
      }
    }
    await queryInterface.sequelize.query(
      "ALTER TABLE CustomFields MODIFY COLUMN fieldType ENUM('text','textarea','number','select','checkbox','date','url') NOT NULL DEFAULT 'text'"
    );
  },
};
