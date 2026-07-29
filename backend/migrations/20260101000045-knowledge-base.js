'use strict';

// Knowledge Base module — staff-authored how-to articles (rich HTML) with
// optional file attachments (uploaded PDFs / Word docs), organized into
// categories. Published articles marked `public` are also served on the
// auth-less /kb portal. Follows the same conventions as the Assets/Licenses
// modules: no DB-level FK constraints (plain INTEGER FK columns + Sequelize
// associations), idempotent createTable guards. Also seeds the
// ModuleVisibility row so the nav tab shows for staff roles.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const now = { type: dt.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = await queryInterface.showAllTables();

    // ---- Categories ----
    if (!tables.includes('KbCategories')) {
      await queryInterface.createTable('KbCategories', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: dt.STRING(150), allowNull: false },
        slug: { type: dt.STRING(180), allowNull: false, unique: true },
        description: { type: dt.STRING(500), allowNull: true },
        icon: { type: dt.STRING(16), allowNull: true },
        position: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }

    // ---- Articles ----
    if (!tables.includes('KbArticles')) {
      await queryInterface.createTable('KbArticles', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: dt.STRING(255), allowNull: false },
        slug: { type: dt.STRING(280), allowNull: false, unique: true },
        excerpt: { type: dt.STRING(500), allowNull: true },
        body: { type: dt.TEXT('long'), allowNull: true },
        categoryId: { type: dt.INTEGER, allowNull: true },
        status: { type: dt.ENUM('draft', 'published'), allowNull: false, defaultValue: 'draft' },
        visibility: { type: dt.ENUM('internal', 'public'), allowNull: false, defaultValue: 'internal' },
        viewCount: { type: dt.INTEGER, allowNull: false, defaultValue: 0 },
        authorId: { type: dt.INTEGER, allowNull: true },
        updatedById: { type: dt.INTEGER, allowNull: true },
        publishedAt: { type: dt.DATE, allowNull: true },
        createdAt: now,
        updatedAt: now,
      });
      await queryInterface.addIndex('KbArticles', ['categoryId']);
      await queryInterface.addIndex('KbArticles', ['status']);
      await queryInterface.addIndex('KbArticles', ['visibility']);
    }

    // ---- Attachments ----
    if (!tables.includes('KbAttachments')) {
      await queryInterface.createTable('KbAttachments', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        articleId: { type: dt.INTEGER, allowNull: false },
        filename: { type: dt.STRING(255), allowNull: false },
        originalName: { type: dt.STRING(255), allowNull: false },
        mimeType: { type: dt.STRING(100), allowNull: true },
        size: { type: dt.INTEGER, allowNull: true },
        uploadedById: { type: dt.INTEGER, allowNull: true },
        createdAt: now,
      });
      await queryInterface.addIndex('KbAttachments', ['articleId']);
    }

    // ---- Nav visibility ----
    const existing = await queryInterface.rawSelect(
      'ModuleVisibility',
      { where: { moduleName: 'knowledge' } },
      ['id']
    );
    if (!existing) {
      await queryInterface.bulkInsert('ModuleVisibility', [
        { moduleName: 'knowledge', visibleToRoles: JSON.stringify(['admin', 'technician']) },
      ]);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('ModuleVisibility', { moduleName: 'knowledge' });
    await queryInterface.dropTable('KbAttachments');
    await queryInterface.dropTable('KbArticles');
    await queryInterface.dropTable('KbCategories');
  },
};
