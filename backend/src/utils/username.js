// Usernames a person sets (a new local account, or a rename). No "@": the
// sign-in box takes a username or an email, so a username shaped like someone
// else's email could match the wrong account. Existing usernames (directory
// and single sign-on ones included) are not re-checked.
const { User } = require('../models');
const { ApiError } = require('../middleware/error');

const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;

function normalizeUsername(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!USERNAME.test(name)) {
    throw new ApiError(400, 'Usernames are 3 to 64 characters: letters, numbers, dots, dashes and underscores', 'INVALID_USERNAME');
  }
  return name;
}

const usernameTaken = () => new ApiError(409, 'A user with this username already exists', 'USERNAME_TAKEN');

// The column's collation ignores case, so "Admin" finds "admin".
async function assertUsernameFree(name, exceptUserId = null) {
  const existing = await User.findOne({ where: { username: name }, attributes: ['id'] });
  if (existing && existing.id !== exceptUserId) throw usernameTaken();
}

// Two requests racing for one name: the unique index catches the second.
function rethrowIfUsernameTaken(err) {
  if (err && err.name === 'SequelizeUniqueConstraintError'
    && (err.errors || []).some((e) => e.path === 'username' || /username/.test(e.path || ''))) {
    throw usernameTaken();
  }
  throw err;
}

module.exports = { normalizeUsername, assertUsernameFree, rethrowIfUsernameTaken };
