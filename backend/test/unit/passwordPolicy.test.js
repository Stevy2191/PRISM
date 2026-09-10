const { validatePassword, describeProblems, MIN_PASSWORD_LENGTH } = require('../../src/utils/passwordPolicy');

const ok = (p, identity) => validatePassword(p, identity).ok;

describe('validatePassword', () => {
  it('accepts a strong passphrase', () => {
    expect(ok('CorrectHorse7Battery')).toBe(true);
    expect(ok('Tr0ub4dor&3xyz')).toBe(true);
  });

  it(`requires at least ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(ok('Sh0rt!aa')).toBe(false);
  });

  it('requires three character classes', () => {
    expect(ok('alllowercaseletters')).toBe(false);
    expect(ok('MixedCaseOnlyHere')).toBe(false);
  });

  // A long passphrase with spaces clears the bar on its own — the space
  // counts as the third class, which is the intended outcome rather than a
  // loophole.
  it('accepts a spaced passphrase', () => {
    expect(ok('Mixed Case Only Here')).toBe(true);
  });

  it('rejects well-known passwords', () => {
    expect(ok('password')).toBe(false);
    expect(ok('changeme')).toBe(false);
    expect(ok('Password123')).toBe(false);
  });

  it('rejects long sequential runs', () => {
    expect(ok('abcd1234EFGH')).toBe(false);
    expect(ok('Zyxw!87654321')).toBe(false);
  });

  it('rejects a single repeated character', () => {
    expect(ok('aaaaaaaaaaaaaa')).toBe(false);
  });

  // Anyone who can see the user list can guess these.
  it('rejects passwords containing the account identity', () => {
    expect(ok('MyAdminPass99!', { username: 'myadmin' })).toBe(false);
    expect(ok('Jsmith!2026xyz', { username: 'jsmith' })).toBe(false);
    expect(ok('Casey!Contact42', { firstName: 'Casey', lastName: 'Contact' })).toBe(false);
    expect(ok('Helpdesk!99xyz', { email: 'helpdesk@example.com' })).toBe(false);
  });

  it('ignores identity fragments shorter than three characters', () => {
    expect(ok('CorrectHorse7Battery', { username: 'jo' })).toBe(true);
  });

  it('rejects absurdly long input rather than passing it to bcrypt', () => {
    expect(ok(`Aa1!${'x'.repeat(500)}`)).toBe(false);
  });

  it('handles null and undefined without throwing', () => {
    expect(ok(null)).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});

describe('describeProblems', () => {
  it('builds a single actionable sentence', () => {
    const { problems } = validatePassword('short');
    const message = describeProblems(problems);
    expect(message.startsWith('Password must ')).toBe(true);
    expect(message.endsWith('.')).toBe(true);
  });

  it('is empty when there are no problems', () => {
    expect(describeProblems([])).toBe('');
  });
});
