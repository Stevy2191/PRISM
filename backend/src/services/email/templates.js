// Renders every outbound email (spec 5a): the template for a key (the
// admin's override, or the code default in catalog.js), its placeholders
// filled from a context, wrapped in the branded layout, plus a text part.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CATALOG } = require('./catalog');
const { sanitizeRichHtml, escapeHtml, htmlToPlainText } = require('../../utils/richHtml');

// Server code can hand over ready-made HTML for a placeholder under this key
// (e.g. a reply's text already escaped with line breaks kept). A Symbol
// can't arrive in parsed JSON, so request data can never use it.
const TRUSTED_HTML = Symbol('trustedHtml');

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function lookup(context, name) {
  const value = name.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), context);
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value);
}

function layout(innerHtml, { orgName, hasLogo }) {
  const logo = hasLogo ? '<img src="cid:org-logo" alt="" style="max-height:48px;max-width:200px;display:block;margin-bottom:8px">' : '';
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:6px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.5">'
    + `<tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0">${logo}<strong style="font-size:16px">${escapeHtml(orgName)}</strong></td></tr>`
    + `<tr><td style="padding:20px 24px">${innerHtml}</td></tr>`
    + '</table></td></tr></table></body></html>';
}

// Pure. `source` is { subject, bodyHtml, placeholders }; only placeholders
// on that list are filled, anything else renders empty.
function renderTemplate(source, context, { orgName, hasLogo }) {
  const ctx = context || {};
  const allowed = new Map((source.placeholders || []).map((p) => [p.name, p]));
  const trusted = ctx[TRUSTED_HTML] || {};

  const subject = String(source.subject || '')
    .replace(PLACEHOLDER, (m, name) => (allowed.has(name) ? lookup(ctx, name) : ''))
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '') // eslint-disable-line no-control-regex
    .trim();

  // Escaped values go in first and the result is sanitized again, so a
  // value can't become markup or a script link even inside an attribute.
  // Trusted HTML is swapped in afterwards through one-off tokens, and only
  // where the token sits in text — never inside a tag.
  const nonce = crypto.randomBytes(6).toString('hex');
  const htmlValues = [];
  const filled = String(source.bodyHtml || '').replace(PLACEHOLDER, (m, name) => {
    const def = allowed.get(name);
    if (!def) return '';
    const raw = Object.prototype.hasOwnProperty.call(trusted, name) ? trusted[name] : (def.html ? lookup(ctx, name) : null);
    if (raw === null) return escapeHtml(lookup(ctx, name));
    htmlValues.push(String(raw || ''));
    return `PRISMHTML${nonce}x${htmlValues.length - 1}x`;
  });
  const token = new RegExp(`PRISMHTML${nonce}x(\\d+)x`, 'g');
  const clean = sanitizeRichHtml(filled);
  const body = clean.replace(token, (m, i, offset) => {
    const before = clean.slice(0, offset);
    const insideTag = before.lastIndexOf('<') > before.lastIndexOf('>');
    return insideTag ? '' : htmlValues[Number(i)];
  });

  const html = layout(body, { orgName, hasLogo });
  const text = `${htmlToPlainText(body)}\n\n--\n${orgName || ''}`.trim();
  return { subject, html, text };
}

// ---- DB-backed ----

// Lazy: these modules load the models, and the pure part above is used by
// unit tests without a database.
function deps() {
  /* eslint-disable global-require */
  const { EmailTemplate } = require('../../models');
  const { getAllSettings, BRANDING_DIR } = require('../../controllers/settingsController');
  /* eslint-enable global-require */
  return { EmailTemplate, getAllSettings, BRANDING_DIR };
}

async function getTemplate(key) {
  const def = CATALOG[key];
  if (!def) return null;
  const row = await deps().EmailTemplate.findOne({ where: { key } });
  return row
    ? { key, subject: row.subject, bodyHtml: row.bodyHtml, enabled: !!row.enabled, isDefault: false }
    : { key, subject: def.subject, bodyHtml: def.bodyHtml, enabled: def.defaultEnabled, isDefault: true };
}

async function branding() {
  const { getAllSettings, BRANDING_DIR } = deps();
  const settings = await getAllSettings();
  const orgName = settings['company.name'] || settings['branding.appName'] || 'PRISM';
  const file = settings['company.logoFilename'];
  let logoPath = null;
  if (file && path.basename(file) === file) {
    const candidate = path.join(BRANDING_DIR, file);
    if (await fs.promises.access(candidate).then(() => true, () => false)) logoPath = candidate;
  }
  return { orgName, logoPath };
}

// `override` ({ subject, bodyHtml }) renders unsaved text (the editor's
// preview) with the key's placeholder list.
async function render(key, context, override) {
  const def = CATALOG[key];
  if (!def) throw new Error(`Unknown email template: ${key}`);
  const tpl = override ? { ...override, enabled: true } : await getTemplate(key);
  const { orgName, logoPath } = await branding();
  const out = renderTemplate(
    { subject: tpl.subject, bodyHtml: tpl.bodyHtml, placeholders: def.placeholders },
    { ...context, org: { name: orgName } },
    { orgName, hasLogo: !!logoPath }
  );
  return {
    ...out,
    attachments: logoPath ? [{ cid: 'org-logo', path: logoPath, filename: `logo${path.extname(logoPath)}` }] : [],
    enabled: !!tpl.enabled,
  };
}

module.exports = {
  TRUSTED_HTML, renderTemplate, render, getTemplate,
};
