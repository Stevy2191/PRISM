'use strict';

// Each company's "Unknown tray user" is the stand-in requester for agent
// tickets from people who match no contact. Nothing stopped it from being
// edited, so on at least one install it was given a real person's name and
// email (owner, 2026-11-13): it still caught every unknown person's tickets,
// and that person's own agent never matched it (placeholders are skipped).
//
// A placeholder that now has an email, or a name of its own, has become a
// real contact: stop treating it as the placeholder. The next agent ticket
// from an unknown person makes a fresh "Unknown tray user" for the company.
// Its tickets stay with it; one that someone else raised says so in its
// description, and can be moved to that person's contact by hand.

const NAME = 'Unknown tray user';
const NOTE = 'Requester of tickets raised from the PRISM agent by people who match no contact. Each ticket says who raised it.';

module.exports = {
  up: async (queryInterface) => {
    const cols = await queryInterface.describeTable('Contacts');
    if (!cols.isPlaceholder) return;
    await queryInterface.sequelize.query(
      'UPDATE Contacts SET notes = NULL WHERE isPlaceholder = 1 AND notes = :note AND (email IS NOT NULL OR displayName <> :name)',
      { replacements: { note: NOTE, name: NAME } }
    );
    await queryInterface.sequelize.query(
      'UPDATE Contacts SET isPlaceholder = 0 WHERE isPlaceholder = 1 AND (email IS NOT NULL OR displayName <> :name)',
      { replacements: { name: NAME } }
    );
  },
  // Nothing to undo: which contacts were placeholders isn't kept, and
  // turning a real person back into one would be wrong.
  down: async () => {},
};
