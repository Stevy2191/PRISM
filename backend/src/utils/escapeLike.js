// Escapes LIKE wildcards (and the escape character) in user text, so a
// search for "%" or "_" matches those characters literally. MariaDB's
// default LIKE escape is the backslash.
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

module.exports = { escapeLike };
