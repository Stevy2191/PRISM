// Stored rich HTML (KB articles, email templates, signatures) and the
// conversions outbound email needs between HTML and plain text.
const sanitizeHtml = require('sanitize-html');

// Rich HTML authored in the editor is later rendered — on the auth-less
// public KB portal, and in email — so it MUST be sanitized before storage.
// This is the real enforcement point (the frontend editor is not trusted).
// Allows the formatting the toolbar can produce (headings, marks, lists,
// quotes, code, links, images, tables, text color/highlight, alignment) and
// nothing script-bearing.
const colorRe = [/^#(0x)?[0-9a-f]{3,8}$/i, /^rgb\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/i, /^rgba\(\s*(\d{1,3}\s*,\s*){3}[\d.]+\s*\)$/i, /^[a-z]+$/i];
const SANITIZE_CONFIG = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'span', 'mark',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['style'],
    mark: ['style'],
    p: ['style'], h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'],
    li: ['style'], blockquote: ['style'], td: ['style', 'colspan', 'rowspan'], th: ['style', 'colspan', 'rowspan'],
    col: ['style', 'span'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      color: colorRe,
      'background-color': colorRe,
      width: [/^\d+(\.\d+)?(px|%)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Data URIs allowed only for inline images (pasted/embedded), never for
  // links or other tags.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    // Force external links safe — new tab + no referrer/opener leakage.
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
  },
};

function sanitizeRichHtml(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), SANITIZE_CONFIG);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain text typed in a textarea → HTML that shows it as typed.
function textToHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&#(\d+);/g, (m, d) => (Number(d) < 0x110000 ? String.fromCodePoint(Number(d)) : m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => (parseInt(h, 16) < 0x110000 ? String.fromCodePoint(parseInt(h, 16)) : m))
    .replace(/&amp;/g, '&');
}

const BLOCK_END = /<\/(p|div|h[1-6]|blockquote|pre|table|ul|ol)>/gi;

// HTML → readable plain text for an email's text part: blocks become blank
// lines, <br> and list items new lines, and a link keeps its url.
function htmlToPlainText(html) {
  // Normalizing through the sanitizer first drops script/style contents and
  // leaves well-formed markup the replacements below can rely on.
  const clean = sanitizeHtml(String(html || ''), {
    allowedTags: ['a', 'br', 'p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'ul', 'ol'],
    allowedAttributes: { a: ['href'] },
  });
  const text = clean
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, '');
      return decodeEntities(label).trim() === decodeEntities(href) ? label : `${label} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n\n')
    .replace(/<\/(li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// HTML → one line of text (KB excerpts and search previews).
function stripToText(html) {
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  SANITIZE_CONFIG, sanitizeRichHtml, escapeHtml, textToHtml, htmlToPlainText, stripToText,
};
