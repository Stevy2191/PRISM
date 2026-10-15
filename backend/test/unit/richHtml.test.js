const {
  sanitizeRichHtml, htmlToPlainText, textToHtml, escapeHtml, stripToText,
} = require('../../src/utils/richHtml');

// The one sanitizer for stored rich HTML (KB articles, email templates,
// signatures) and the conversions email needs between HTML and text.

it('strips script, event handlers and javascript: urls', () => {
  const out = sanitizeRichHtml(
    '<p onclick="x()">Hi<script>alert(1)</script></p><img src="x" onerror="alert(1)">'
    + '<a href="javascript:alert(1)">bad</a><a href="JaVaScRiPt:alert(1)">bad2</a><iframe src="https://e.com"></iframe>'
  );
  expect(out).not.toMatch(/script|onclick|onerror|javascript|iframe/i);
  expect(out).toContain('<p>Hi</p>');
  expect(out).toContain('<a target="_blank" rel="noopener noreferrer nofollow">bad</a>');
});

it('keeps the KB toolbar formatting', () => {
  const html = '<h2 style="text-align:center">T</h2><p><strong>b</strong> <em>i</em> <u>u</u> '
    + '<span style="color:#ff0000">red</span></p><ul><li>one</li></ul>'
    + '<a href="https://example.com">link</a><table><tbody><tr><td>c</td></tr></tbody></table>';
  const out = sanitizeRichHtml(html);
  for (const part of ['<h2 style="text-align:center">', '<strong>b</strong>', '<em>i</em>', '<u>u</u>',
    '<span style="color:#ff0000">red</span>', '<ul><li>one</li></ul>', 'href="https://example.com"', '<td>c</td>']) {
    expect(out).toContain(part);
  }
  expect(sanitizeRichHtml('')).toBe('');
  expect(sanitizeRichHtml(null)).toBe('');
});

it('htmlToPlainText keeps paragraphs and link urls', () => {
  const text = htmlToPlainText('<p>Hello &amp; welcome</p><p>Line one<br>Line two</p>'
    + '<p>See <a href="https://example.com/x">the guide</a>.</p><ul><li>a</li><li>b</li></ul><style>p{}</style>');
  expect(text).toBe('Hello & welcome\n\nLine one\nLine two\n\nSee the guide (https://example.com/x).\n\na\nb');
  // A link whose text is its url isn't repeated.
  expect(htmlToPlainText('<a href="https://e.com">https://e.com</a>')).toBe('https://e.com');
  expect(htmlToPlainText('&lt;b&gt; &quot;q&quot; &#39;s&#39; &nbsp;x')).toBe('<b> "q" \'s\'  x');
});

it('textToHtml escapes and keeps line breaks', () => {
  expect(textToHtml('a <b>bold</b> & "q"\nnext\r\nlast')).toBe('a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;<br>next<br>last');
  expect(textToHtml(null)).toBe('');
  expect(escapeHtml(`<'">&`)).toBe('&lt;&#39;&quot;&gt;&amp;');
});

it('stripToText flattens to one line for excerpts', () => {
  expect(stripToText('<p>a</p>\n<p>b  c</p>')).toBe('a b c');
});
