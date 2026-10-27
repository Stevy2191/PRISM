// One-time client-portal links (invite / password reset). The token is 32
// random bytes, base64url, and exists only in the email; the database keeps
// its sha256. A token is good once, for TOKEN_LIFETIME_MS, and only while it
// is the newest unused one of its kind for that contact.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { PortalToken, Contact } = require('../../models');
const { ApiError } = require('../../middleware/error');

const TOKEN_LIFETIME_MS = 72 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function issuePortalToken(contactId, kind) {
  const now = new Date();
  // Any earlier link of this kind stops working the moment a new one is sent.
  await PortalToken.update({ usedAt: now }, { where: { contactId, kind, usedAt: null } });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);
  await PortalToken.create({ contactId, kind, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

const invalid = () => new ApiError(400, 'This link is invalid or has expired. Ask for a new one.', 'TOKEN_INVALID');

// Checks a token without spending it, so a refused password doesn't burn the
// link. Returns { row, contact } (contact read with its password hash).
async function findUsableToken(token, kind) {
  if (typeof token !== 'string' || !token || token.length > 100) throw invalid();
  const row = await PortalToken.findOne({
    where: {
      tokenHash: hashToken(token), kind, usedAt: null, expiresAt: { [Op.gt]: new Date() },
    },
  });
  if (!row) throw invalid();
  const contact = await Contact.scope('withPassword').findByPk(row.contactId);
  if (!contact) throw invalid();
  return { row, contact };
}

// Spends the token atomically (a second request racing the first gets
// TOKEN_INVALID) and returns the contact it belongs to.
async function consumePortalToken(token, kind) {
  const { row, contact } = await findUsableToken(token, kind);
  const [spent] = await PortalToken.update(
    { usedAt: new Date() },
    { where: { id: row.id, usedAt: null, expiresAt: { [Op.gt]: new Date() } } }
  );
  if (spent !== 1) throw invalid();
  return contact;
}

module.exports = {
  issuePortalToken, consumePortalToken, findUsableToken, hashToken, TOKEN_LIFETIME_MS,
};
