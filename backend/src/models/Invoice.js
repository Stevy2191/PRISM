const { DataTypes, Model } = require('sequelize');

// An invoice or credit note (Phase 3, step 3). Money columns are cents.
module.exports = (sequelize) => {
  class Invoice extends Model {}
  const money = () => ({ type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  Invoice.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      number: { type: DataTypes.STRING(30), allowNull: true },
      kind: { type: DataTypes.ENUM('invoice', 'credit_note'), allowNull: false, defaultValue: 'invoice' },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      agreementId: { type: DataTypes.INTEGER, allowNull: true },
      periodKey: { type: DataTypes.STRING(20), allowNull: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM('draft', 'sent', 'partly_paid', 'paid', 'void'), allowNull: false, defaultValue: 'draft' },
      issuedOn: { type: DataTypes.DATEONLY, allowNull: true },
      dueOn: { type: DataTypes.DATEONLY, allowNull: true },
      subtotal: money(),
      taxTotal: money(),
      total: money(),
      amountPaid: money(),
      creditApplied: money(),
      chargeTax: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      billToContactId: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      ledgerEntryId: { type: DataTypes.INTEGER, allowNull: true },
      payTokenHash: { type: DataTypes.CHAR(64), allowNull: true },
      payTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
      remindersSent: {
        type: DataTypes.JSON,
        allowNull: true,
        get() { return this.getDataValue('remindersSent') ?? []; },
      },
      lateFeeInvoiceId: { type: DataTypes.INTEGER, allowNull: true },
      creditForInvoiceId: { type: DataTypes.INTEGER, allowNull: true },
      voidReason: { type: DataTypes.STRING(255), allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { sequelize, modelName: 'Invoice', tableName: 'Invoices' }
  );
  return Invoice;
};
