const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Ticket extends Model {
    // Zero-padded 5-digit display id (e.g. 114 -> "00114"), included in every
    // API response that serializes a Ticket instance.
    toJSON() {
      const values = { ...this.get() };
      values.ticketNumber = String(values.id).padStart(5, '0');
      return values;
    }
  }

  Ticket.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Free-form string matching a TicketStatus row's `name` — admins can
      // add/rename/reorder statuses, so this is no longer a fixed ENUM.
      // Renaming a status cascades to every ticket using the old name (see
      // statusesController), so this always stays in sync.
      status: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Open',
      },
      priority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'medium',
      },
      type: {
        type: DataTypes.ENUM('incident', 'request', 'problem', 'task', 'change'),
        allowNull: false,
        defaultValue: 'request',
      },
      // How this ticket came into existence. 'email'/'portal' are only ever
      // set by the system (inbound email processing / future customer
      // portal) — never selectable on the manual ticket-creation form,
      // which only offers 'manual'/'phone'.
      source: {
        type: DataTypes.ENUM('manual', 'email', 'phone', 'portal'),
        allowNull: false,
        defaultValue: 'manual',
      },
      assigneeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Optional team assignment (in addition to or instead of an individual).
      teamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Legacy FK to Users, kept for historical rows only — no longer
      // populated on new tickets. See contactId, which replaces it.
      requesterId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The contact (customer/end-user) this ticket was filed for. Contacts
      // are a separate directory from Users — they have no PRISM login.
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The staff member who filed the ticket (never tracked before this
      // field was added) — used by the workflow engine's created_by_role
      // condition.
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // Optional time-of-day companion to dueDate — "HH:MM:SS" or null.
      // A ticket can have a due date with no specific time; it can never
      // have a dueTime without a dueDate (enforced in the controller, not
      // here, to keep the same validation shape as the rest of the app).
      dueTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // The blueprint this ticket was created from (if any).
      blueprintId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Filled-in custom field values from a blueprint:
      //   [{ name, label, type, value }]
      customFields: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Freeform labels, e.g. ["vpn", "escalated"].
      tags: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // What fixed the issue — customer-visible, staff-editable.
      resolution: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      resolutionUpdatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      resolutionUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Ticket',
      tableName: 'Tickets',
      timestamps: true,
      hooks: {
        // Keep resolvedAt in sync with status transitions. Status is now a
        // free-form string matching a TicketStatus row's name, so "closed"
        // is resolved dynamically via that row's behaviorType rather than a
        // fixed set of literal strings. Required lazily to dodge the
        // models/index.js <-> Ticket.js circular require.
        beforeSave: async (ticket) => {
          if (ticket.changed('status')) {
            const { TicketStatus } = require('./index'); // eslint-disable-line global-require
            const statusRow = await TicketStatus.findOne({ where: { name: ticket.status } });
            const isClosed = statusRow?.behaviorType === 'closed';
            if (isClosed && !ticket.resolvedAt) {
              ticket.resolvedAt = new Date();
            } else if (!isClosed) {
              ticket.resolvedAt = null;
            }
          }
        },
      },
    }
  );

  return Ticket;
};
