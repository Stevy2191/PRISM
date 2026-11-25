const { DataTypes, Model } = require('sequelize');

// The one time ledger (sub-project 3): every minute of work, on a ticket or a
// project, lives here. Exactly one of ticketId / projectId is set (a database
// check enforces it). userId is who the time is FOR; loggedById is who
// entered it. "When it was entered" is createdAt; entryDate is the work date
// in the organization's time zone.
const billedError = () => {
  const { ApiError } = require('../middleware/error'); // eslint-disable-line global-require
  return new ApiError(409, 'This time is on an invoice and can\'t be changed or removed', 'TIME_BILLED');
};

module.exports = (sequelize) => {
  class TimeEntry extends Model {}

  TimeEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      projectId: { type: DataTypes.INTEGER, allowNull: true },
      taskId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      loggedById: { type: DataTypes.INTEGER, allowNull: true },
      entryDate: { type: DataTypes.DATEONLY, allowNull: false },
      // Set when known (timer, start/end picker); null for a plain duration.
      startTime: { type: DataTypes.DATE, allowNull: true },
      endTime: { type: DataTypes.DATE, allowNull: true },
      durationSeconds: { type: DataTypes.INTEGER, allowNull: false },
      billable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      workTypeId: { type: DataTypes.INTEGER, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
      // From userId's contractor rate (utils/laborCost.js); null for internal
      // staff, not 0. Recomputed whenever the duration or userId changes.
      laborCost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      // Phase 3: where the entry stands for billing; a billed entry is locked.
      billingStatus: { type: DataTypes.ENUM('unbilled', 'covered', 'billed', 'non_billable'), allowNull: false, defaultValue: 'unbilled' },
      // null = decide from the customer's support hours; true/false = override.
      afterHours: { type: DataTypes.BOOLEAN, allowNull: true },
      invoiceLineId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TimeEntry',
      tableName: 'TimeEntries',
      timestamps: true,
      hooks: {
        // Every way an entry is made (form, timer, import): time that isn't
        // billable is never waiting to be billed.
        beforeCreate: (entry) => {
          if (entry.billable === false && entry.billingStatus === 'unbilled') entry.billingStatus = 'non_billable';
        },
        // Billed time is locked on every path (the time API, a ticket merge,
        // a ticket or project delete): the invoice that billed it says what
        // it was. Only invoicing itself passes { allowBilled: true } (to bill
        // or, voiding an invoice, to un-bill).
        beforeUpdate: (entry, options) => {
          if (!options.allowBilled && entry.previous('billingStatus') === 'billed') throw billedError();
        },
        beforeDestroy: (entry, options) => {
          if (!options.allowBilled && entry.billingStatus === 'billed') throw billedError();
        },
        beforeBulkUpdate: async (options) => {
          if (!options.allowBilled && await anyBilled(options)) throw billedError();
        },
        beforeBulkDestroy: async (options) => {
          if (!options.allowBilled && await anyBilled(options)) throw billedError();
        },
      },
    }
  );

  // Would a bulk update or delete touch billed time?
  async function anyBilled(options) {
    const { Op } = require('sequelize'); // eslint-disable-line global-require
    return (await TimeEntry.count({ where: { [Op.and]: [options.where || {}, { billingStatus: 'billed' }] }, transaction: options.transaction })) > 0;
  }

  return TimeEntry;
};
