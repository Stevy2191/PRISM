// Company helpers shared by controllers and services. The internal company is
// created by the client-companies migration and can never be deleted, so its
// id is cached for the life of the process.
const { Company } = require('../models');

let internalCompanyId = null;

async function getInternalCompanyId({ transaction } = {}) {
  if (internalCompanyId) return internalCompanyId;
  const row = await Company.findOne({ where: { isInternal: true }, attributes: ['id'], transaction });
  if (!row) throw new Error('No internal company — run the client-companies migration');
  internalCompanyId = row.id;
  return internalCompanyId;
}

// Free-mail domains never identify a company (spec: Data model → CompanyDomains).
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'fastmail.com',
]);

module.exports = { getInternalCompanyId, FREE_MAIL_DOMAINS };
