'use strict';

/**
 * Initial PRISM schema. Creates all application tables in dependency order
 * with foreign keys. The Sessions table is created at runtime by
 * connect-session-sequelize and is intentionally not managed here.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Do not destructure `JSON` from Sequelize — it shadows the global JSON.
    // Use Sequelize.JSON for column types instead.
    const { INTEGER, STRING, TEXT, DATE, DATEONLY, BOOLEAN, ENUM } = Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    // Departments
    await queryInterface.createTable('Departments', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: STRING(255), allowNull: false, unique: true },
      description: { type: TEXT, allowNull: true },
      createdAt: now,
    });

    // Users
    await queryInterface.createTable('Users', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: STRING(255), allowNull: false, unique: true },
      displayName: { type: STRING(255), allowNull: false },
      email: { type: STRING(255), allowNull: true },
      role: { type: ENUM('admin', 'technician', 'requester'), allowNull: false, defaultValue: 'requester' },
      departmentId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      lastLogin: { type: DATE, allowNull: true },
      createdAt: now,
      updatedAt: now,
    });

    // Projects
    await queryInterface.createTable('Projects', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: STRING(255), allowNull: false },
      description: { type: TEXT, allowNull: true },
      status: {
        type: ENUM('active', 'on_hold', 'completed', 'archived'),
        allowNull: false,
        defaultValue: 'active',
      },
      departmentId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      ownerId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      dueDate: { type: DATEONLY, allowNull: true },
      createdAt: now,
      updatedAt: now,
    });

    // Milestones
    await queryInterface.createTable('Milestones', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      projectId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Projects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      title: { type: STRING(255), allowNull: false },
      dueDate: { type: DATEONLY, allowNull: true },
      completed: { type: BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: now,
    });

    // Tickets
    await queryInterface.createTable('Tickets', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: STRING(255), allowNull: false },
      description: { type: TEXT, allowNull: true },
      status: {
        type: ENUM('open', 'in_progress', 'on_hold', 'resolved', 'closed'),
        allowNull: false,
        defaultValue: 'open',
      },
      priority: {
        type: ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'medium',
      },
      type: {
        type: ENUM('incident', 'request', 'task', 'change'),
        allowNull: false,
        defaultValue: 'request',
      },
      assigneeId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      requesterId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      projectId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Projects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      departmentId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      dueDate: { type: DATEONLY, allowNull: true },
      resolvedAt: { type: DATE, allowNull: true },
      createdAt: now,
      updatedAt: now,
    });

    // Comments
    await queryInterface.createTable('Comments', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      body: { type: TEXT, allowNull: false },
      authorId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ticketId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: now,
      updatedAt: now,
    });

    // Attachments
    await queryInterface.createTable('Attachments', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      filename: { type: STRING(255), allowNull: false },
      originalName: { type: STRING(255), allowNull: false },
      mimeType: { type: STRING(255), allowNull: true },
      size: { type: INTEGER, allowNull: false },
      ticketId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      uploadedById: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: now,
    });

    // TimeEntries
    await queryInterface.createTable('TimeEntries', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      minutes: { type: INTEGER, allowNull: false },
      note: { type: TEXT, allowNull: true },
      loggedAt: now,
    });

    // ApiKeys
    await queryInterface.createTable('ApiKeys', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: STRING(255), allowNull: false },
      keyHash: { type: STRING(255), allowNull: false },
      prefix: { type: STRING(16), allowNull: true },
      userId: {
        type: INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      lastUsed: { type: DATE, allowNull: true },
      expiresAt: { type: DATE, allowNull: true },
      createdAt: now,
    });

    // AuditLogs
    await queryInterface.createTable('AuditLogs', {
      id: { type: INTEGER, primaryKey: true, autoIncrement: true },
      userId: {
        type: INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action: { type: STRING(255), allowNull: false },
      entityType: { type: STRING(255), allowNull: true },
      entityId: { type: INTEGER, allowNull: true },
      meta: { type: Sequelize.JSON, allowNull: true },
      createdAt: now,
    });

    // Helpful indexes for common filters.
    await queryInterface.addIndex('Tickets', ['status']);
    await queryInterface.addIndex('Tickets', ['priority']);
    await queryInterface.addIndex('Tickets', ['assigneeId']);
    await queryInterface.addIndex('Tickets', ['requesterId']);
    await queryInterface.addIndex('Tickets', ['projectId']);
    await queryInterface.addIndex('Tickets', ['departmentId']);
    await queryInterface.addIndex('Comments', ['ticketId']);
    await queryInterface.addIndex('Attachments', ['ticketId']);
    await queryInterface.addIndex('TimeEntries', ['ticketId']);
    await queryInterface.addIndex('TimeEntries', ['userId']);
    await queryInterface.addIndex('ApiKeys', ['prefix']);
    await queryInterface.addIndex('AuditLogs', ['entityType', 'entityId']);
  },

  async down(queryInterface) {
    // Drop in reverse dependency order.
    await queryInterface.dropTable('AuditLogs');
    await queryInterface.dropTable('ApiKeys');
    await queryInterface.dropTable('TimeEntries');
    await queryInterface.dropTable('Attachments');
    await queryInterface.dropTable('Comments');
    await queryInterface.dropTable('Tickets');
    await queryInterface.dropTable('Milestones');
    await queryInterface.dropTable('Projects');
    await queryInterface.dropTable('Users');
    await queryInterface.dropTable('Departments');
  },
};
