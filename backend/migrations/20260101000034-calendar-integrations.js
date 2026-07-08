'use strict';

// External calendar integrations (Google/Microsoft/iCal) — each user connects
// their own, read-only into PRISM except for the optional "push PRISM events
// out" direction. accessToken/refreshToken are stored AES-256-GCM encrypted
// (see backend/src/utils/tokenCrypto.js) — never store OAuth tokens in
// plaintext.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes: dt } = Sequelize;
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));

    if (!tableNames.includes('UserCalendarIntegrations')) {
      await queryInterface.createTable('UserCalendarIntegrations', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: dt.INTEGER, allowNull: false },
        provider: { type: dt.ENUM('google', 'microsoft', 'ical'), allowNull: false },
        name: { type: dt.STRING(255), allowNull: false },
        color: { type: dt.STRING(9), allowNull: false, defaultValue: '#2563eb' },
        isActive: { type: dt.BOOLEAN, allowNull: false, defaultValue: true },
        // OAuth (google/microsoft only) — AES-256-GCM ciphertext, never plaintext.
        accessToken: { type: dt.TEXT, allowNull: true },
        refreshToken: { type: dt.TEXT, allowNull: true },
        tokenExpiry: { type: dt.DATE, allowNull: true },
        calendarId: { type: dt.STRING(500), allowNull: true },
        // iCal only.
        icalUrl: { type: dt.TEXT, allowNull: true },
        // Whether PRISM ticket/project due dates get pushed *out* to this
        // calendar — separate from whether we're pulling events *in*
        // (pulling is controlled by isActive; ical providers can never push).
        syncEnabled: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        lastSynced: { type: dt.DATE, allowNull: true },
        // Set when a token refresh fails (expired/revoked) — surfaced in the
        // UI as a "Reconnect" badge instead of silently failing forever.
        needsReconnect: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
        updatedAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
      });
      await queryInterface.addIndex('UserCalendarIntegrations', ['userId']);
    }

    if (!tableNames.includes('CalendarEventCaches')) {
      await queryInterface.createTable('CalendarEventCaches', {
        id: { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
        integrationId: { type: dt.INTEGER, allowNull: false },
        externalEventId: { type: dt.STRING(500), allowNull: false },
        title: { type: dt.STRING(500), allowNull: false },
        startDate: { type: dt.DATE, allowNull: false },
        endDate: { type: dt.DATE, allowNull: true },
        isAllDay: { type: dt.BOOLEAN, allowNull: false, defaultValue: false },
        location: { type: dt.STRING(500), allowNull: true },
        description: { type: dt.TEXT, allowNull: true },
        // Set only on rows created by the PRISM -> external push direction
        // (syncEnabled integrations) — lets calendarPush.js find "does this
        // ticket/project already have a pushed event on this integration"
        // without a separate mapping table. Null for normal pulled-in rows.
        prismEventType: { type: dt.ENUM('ticket', 'project'), allowNull: true },
        prismEventId: { type: dt.INTEGER, allowNull: true },
        lastFetched: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
        createdAt: { type: dt.DATE, allowNull: false, defaultValue: dt.NOW },
      });
      await queryInterface.addIndex('CalendarEventCaches', ['integrationId']);
      await queryInterface.addIndex('CalendarEventCaches', ['integrationId', 'prismEventType', 'prismEventId'], { name: 'calendar_event_cache_prism_ref' });
      await queryInterface.addIndex('CalendarEventCaches', ['integrationId', 'externalEventId'], { unique: true, name: 'calendar_event_cache_integration_external_unique' });
      await queryInterface.addIndex('CalendarEventCaches', ['startDate']);
    }
  },

  down: async (queryInterface) => {
    const existing = await queryInterface.showAllTables();
    const tableNames = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tableNames.includes('CalendarEventCaches')) await queryInterface.dropTable('CalendarEventCaches');
    if (tableNames.includes('UserCalendarIntegrations')) await queryInterface.dropTable('UserCalendarIntegrations');
  },
};
