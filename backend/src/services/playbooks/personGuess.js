// Who a ticket is about, guessed from its subject and description
// (Playbooks, PB, task 6). "Termination: Jordan Reyes, last day Nov 14" is
// raised by HR about Jordan. The guess is only offered in the Apply dialog;
// the person applying confirms or changes it.
//
// Matches, best first: a contact's full name, then "first last", then the
// part of their email before the @ (jreyes). Whole words only, ignoring case
// and accents. Inactive contacts are included: a termination is often raised
// after the account is switched off.
const { Op } = require('sequelize');
const { Contact } = require('../../models');
const { stripToText } = require('../../utils/richHtml');

const MAX_GUESSES = 3;
const MAX_CONTACTS = 5000;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// Does `phrase` (already split into words) appear as whole words in `textWords`?
function hasPhrase(textWords, phrase) {
  if (!phrase.length) return false;
  for (let i = 0; i + phrase.length <= textWords.length; i += 1) {
    if (phrase.every((w, j) => textWords[i + j] === w)) return true;
  }
  return false;
}

// Pure: → contacts that the text names, best first, at most MAX_GUESSES.
function guessFrom(text, contacts) {
  const textWords = words(text);
  if (!textWords.length) return [];
  const scored = [];
  for (const c of contacts) {
    let score = 0;
    const full = words(c.displayName);
    const firstLast = words(`${c.firstName || ''} ${c.lastName || ''}`);
    const local = c.email ? words(String(c.email).split('@')[0]) : [];
    if (full.length >= 2 && hasPhrase(textWords, full)) score = 3;
    else if (firstLast.length >= 2 && hasPhrase(textWords, firstLast)) score = 2;
    else if (local.length === 1 && local[0].length >= 4 && textWords.includes(local[0])) score = 1;
    if (score) scored.push({ contact: c, score });
  }
  scored.sort((a, b) => b.score - a.score || fold(a.contact.displayName).localeCompare(fold(b.contact.displayName)));
  return scored.slice(0, MAX_GUESSES).map((s) => s.contact);
}

// → contacts of the ticket's company the ticket names.
async function guessPerson(ticket) {
  const text = `${ticket.title || ''} ${stripToText(ticket.description || '')}`;
  if (!words(text).length) return [];
  const contacts = await Contact.findAll({
    where: { companyId: ticket.companyId, isPlaceholder: false, [Op.or]: [{ status: 'active' }, { status: 'inactive' }] },
    attributes: ['id', 'firstName', 'lastName', 'displayName', 'email', 'departmentId', 'companyId', 'status'],
    limit: MAX_CONTACTS,
  });
  return guessFrom(text, contacts);
}

module.exports = { guessFrom, guessPerson };
