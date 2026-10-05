// Keeps every record in a company whatever code path creates it — HTTP
// handlers, inbound email, AD sync, the schedulers, tests calling
// Model.create. Registered from models/index.js once associations exist.
module.exports = function registerCompanyHooks(models) {
  const {
    Contact, Ticket, Department, Project, Asset, License, Contract, Site,
  } = models;
  // Required lazily: companyService requires models/index.js.
  const internalId = (options) => require('../services/companyService') // eslint-disable-line global-require
    .getInternalCompanyId({ transaction: options.transaction });

  const defaultToInternal = async (record, options) => {
    if (record.companyId == null) record.companyId = await internalId(options);
  };
  // bulkCreate skips per-record hooks (unless individualHooks), so the same
  // rules run from beforeBulkCreate over each record.
  const eachRecord = (fn) => async (records, options) => {
    for (const record of records) await fn(record, options); // eslint-disable-line no-await-in-loop
  };
  [Department, Contact, Project, Asset, License, Contract].forEach((M) => {
    M.addHook('beforeValidate', 'defaultCompany', defaultToInternal);
    M.addHook('beforeBulkCreate', 'defaultCompanyBulk', eachRecord(defaultToInternal));
  });

  // A ticket's company is always its contact's (spec decision "Ticket
  // company"); a companyId sent directly is overwritten.
  const companyFromContact = async (ticket, options) => {
    if (ticket.contactId && (ticket.isNewRecord || ticket.changed('contactId') || ticket.changed('companyId'))) {
      const contact = await Contact.findByPk(ticket.contactId, { attributes: ['companyId'], transaction: options.transaction });
      if (contact) ticket.companyId = contact.companyId;
    }
    if (ticket.companyId == null) ticket.companyId = await internalId(options);
  };
  // Create: beforeValidate, because companyId is NOT NULL and must be set
  // before validation. Edit: beforeUpdate only. An update saves just the
  // fields changed when save() began plus those a before{Create,Update} hook
  // changes; a field already changed by a beforeValidate hook is classed as
  // "changed but not saved" and ignored — so running this on edits from
  // beforeValidate would silently drop the new companyId.
  Ticket.addHook('beforeValidate', 'companyFromContact', async (ticket, options) => {
    if (ticket.isNewRecord) await companyFromContact(ticket, options);
  });
  Ticket.addHook('beforeUpdate', 'companyFromContactOnUpdate', companyFromContact);
  Ticket.addHook('beforeBulkCreate', 'companyFromContactBulk', eachRecord(companyFromContact));

  // A contact that moves company takes its tickets, and drops a department
  // or site that belonged to the old company.
  Contact.addHook('beforeUpdate', 'clearForeignPlacement', async (contact, options) => {
    if (!contact.changed('companyId')) return;
    if (contact.departmentId) {
      const dept = await Department.findByPk(contact.departmentId, { attributes: ['companyId'], transaction: options.transaction });
      if (!dept || dept.companyId !== contact.companyId) contact.departmentId = null;
    }
    if (contact.siteId) {
      const site = await Site.findByPk(contact.siteId, { attributes: ['companyId'], transaction: options.transaction });
      if (!site || site.companyId !== contact.companyId) contact.siteId = null;
    }
  });
  Contact.addHook('afterUpdate', 'moveTickets', async (contact, options) => {
    // after* hooks run before Sequelize resets changed(), so this still sees the move.
    if (!contact.changed('companyId')) return;
    await Ticket.update(
      { companyId: contact.companyId },
      { where: { contactId: contact.id }, transaction: options.transaction, hooks: false }
    );
  });
};
