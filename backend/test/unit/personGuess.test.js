const { guessFrom } = require('../../src/services/playbooks/personGuess');

// Sub-project PB, task 6: who a ticket seems to be about.

const c = (id, firstName, lastName, email, displayName = `${firstName} ${lastName}`) => ({
  id, firstName, lastName, email, displayName,
});
const jordan = c(1, 'Jordan', 'Reyes', 'jreyes@county.example');
const jordanB = c(2, 'Jordan', 'Blake', 'jblake@county.example');
const jose = c(3, 'José', 'Núñez', 'jnunez@county.example');
const pat = c(4, 'Pat', 'Morgan', 'pmorgan@county.example');
const al = c(5, 'Al', 'Ng', 'al@county.example');
const everyone = [jordan, jordanB, jose, pat, al];
const ids = (text) => guessFrom(text, everyone).map((x) => x.id);

it('finds a full name in the subject', () => {
  expect(ids('Termination: Jordan Reyes, last day Nov 14')).toEqual([1]);
});

it('two people with the same first name: only the one named', () => {
  expect(ids('New laptop for jordan blake')).toEqual([2]);
  expect(ids('Jordan needs a laptop')).toEqual([]);
});

it('ignores accents and case', () => {
  expect(ids('Offboarding JOSE NUNEZ')).toEqual([3]);
});

it('matches an email name as a whole word, best matches first', () => {
  expect(ids('Disable jreyes and remove Pat Morgan from Finance')).toEqual([4, 1]);
  expect(ids('please disable jreyesx')).toEqual([]);
  // Too short an email name to trust.
  expect(ids('al is leaving')).toEqual([]);
});

it('nothing named, nothing guessed', () => {
  expect(ids('Printer on floor 2 jams')).toEqual([]);
  expect(ids('')).toEqual([]);
});
