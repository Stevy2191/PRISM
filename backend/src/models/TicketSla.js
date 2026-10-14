const { DataTypes, Model } = require('sequelize');

// One ticket's SLA clocks. A ticket without a row has no SLA (tickets from
// before the SLA engine). Each clock — assign, response, resolution — keeps
// the same state: target, minutes banked while stopped, when the current
// running spell began (null = stopped), and the derived due/warn instants
// plus when it was warned, breached and met. See services/sla/clock.js.
const CLOCKS = ['assign', 'response', 'resolution'];

function clockAttributes() {
  const attrs = {};
  CLOCKS.forEach((c) => {
    attrs[`${c}TargetMinutes`] = { type: DataTypes.INTEGER, allowNull: true };
    attrs[`${c}UsedMinutes`] = { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 };
    ['RunningSince', 'DueAt', 'WarnAt', 'WarnedAt', 'BreachedAt', 'MetAt'].forEach((s) => {
      attrs[`${c}${s}`] = { type: DataTypes.DATE, allowNull: true };
    });
  });
  return attrs;
}

module.exports = (sequelize) => {
  class TicketSla extends Model {}

  TicketSla.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      slaPolicyId: { type: DataTypes.INTEGER, allowNull: false },
      // The ticket type and priority the targets were read for.
      ticketType: { type: DataTypes.ENUM('incident', 'request', 'problem', 'change', 'task'), allowNull: false, defaultValue: 'incident' },
      priority: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low'), allowNull: false },
      ...clockAttributes(),
      // The resolution due date the SLA first set; extensions move
      // resolutionDueAt, never this (only Set SLA policy recomputes it).
      resolutionOriginalDueAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TicketSla',
      tableName: 'TicketSlas',
      timestamps: true,
    }
  );

  TicketSla.CLOCKS = CLOCKS;
  return TicketSla;
};
