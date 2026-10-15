// Settings → Email templates (spec 5a). Admins override the subject, body
// and on/off switch of the code-defined templates; Reset deletes the
// override. Bodies are sanitized here, on save — the editor isn't trusted.
const { EmailTemplate } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { writeAudit } = require('../middleware/audit');
const { CATALOG } = require('../services/email/catalog');
const { getTemplate, render } = require('../services/email/templates');
const { sanitizeRichHtml, escapeHtml } = require('../utils/richHtml');
const { surveyBaseUrl } = require('../services/csatService');

const MAX_BODY_BYTES = 100 * 1024;

function catalogEntry(key) {
  if (!Object.prototype.hasOwnProperty.call(CATALOG, key)) throw new ApiError(404, 'Email template not found', 'NOT_FOUND');
  return CATALOG[key];
}

function validate(body) {
  const { subject, bodyHtml, enabled } = body || {};
  if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 255) {
    throw new ApiError(400, 'Subject must be 1 to 255 characters', 'VALIDATION_ERROR');
  }
  if (typeof bodyHtml !== 'string' || Buffer.byteLength(bodyHtml) > MAX_BODY_BYTES) {
    throw new ApiError(400, 'Body must be text of at most 100 KB', 'VALIDATION_ERROR');
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new ApiError(400, 'enabled must be true or false', 'VALIDATION_ERROR');
  }
  return { subject: subject.trim(), bodyHtml: sanitizeRichHtml(bodyHtml), enabled };
}

const withMeta = (key, tpl) => ({ ...tpl, name: CATALOG[key].name, audience: CATALOG[key].audience, placeholders: CATALOG[key].placeholders });

// GET /settings/email-templates
const list = asyncHandler(async (req, res) => {
  const rows = await EmailTemplate.findAll({ attributes: ['key', 'enabled'] });
  const saved = new Map(rows.map((r) => [r.key, r]));
  const templates = Object.entries(CATALOG).map(([key, def]) => ({
    key,
    name: def.name,
    audience: def.audience,
    enabled: saved.has(key) ? !!saved.get(key).enabled : def.defaultEnabled,
    isDefault: !saved.has(key),
  }));
  res.json({ templates });
});

// GET /settings/email-templates/:key
const get = asyncHandler(async (req, res) => {
  catalogEntry(req.params.key);
  res.json({ template: withMeta(req.params.key, await getTemplate(req.params.key)) });
});

// PUT /settings/email-templates/:key
const update = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const def = catalogEntry(key);
  const { subject, bodyHtml, enabled } = validate(req.body);
  const existing = await EmailTemplate.findOne({ where: { key } });
  const values = {
    subject,
    bodyHtml,
    enabled: enabled !== undefined ? enabled : (existing ? existing.enabled : def.defaultEnabled),
    updatedById: req.user.id,
  };
  if (existing) await existing.update(values);
  else await EmailTemplate.create({ key, ...values });
  await writeAudit(req, 'emailTemplate.update', 'EmailTemplate', null, { key, enabled: values.enabled });
  res.json({ template: withMeta(key, await getTemplate(key)) });
});

// DELETE /settings/email-templates/:key — back to the default.
const reset = asyncHandler(async (req, res) => {
  const { key } = req.params;
  catalogEntry(key);
  const removed = await EmailTemplate.destroy({ where: { key } });
  if (removed) await writeAudit(req, 'emailTemplate.reset', 'EmailTemplate', null, { key });
  res.json({ template: withMeta(key, await getTemplate(key)) });
});

function sampleStarLinks(url) {
  return [1, 2, 3, 4, 5].map((n) => `<a href="${escapeHtml(`${url}?rating=${n}`)}" style="display:inline-block;margin:0 4px;padding:6px 10px;background:#fef3c7;border-radius:6px;color:#b45309;text-decoration:none">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</a>`).join('');
}

// POST /settings/email-templates/:key/preview — renders unsaved text with a
// sample ticket. Nothing is stored.
const preview = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const def = catalogEntry(key);
  const { subject, bodyHtml } = validate(req.body);
  const base = surveyBaseUrl();
  const surveyUrl = `${base}/survey/sample`;
  const context = {
    ticket: {
      number: '00042', title: 'Printer on the 2nd floor is offline', url: `${base}/tickets/42`, status: 'Open', priority: 'high',
    },
    contact: { firstName: 'Ann', name: 'Ann Smith' },
    tech: { name: req.user.displayName || req.user.username },
    comment: { body: 'I have restarted the print server. Can you try printing again?' },
    signature: req.user.emailSignature || '<p><strong>Your name</strong><br>Service desk</p>',
    notification: { message: 'Ticket assigned to you: Printer on the 2nd floor is offline' },
    survey: { question: 'How satisfied were you with our support?', starLinks: sampleStarLinks(surveyUrl), url: surveyUrl },
  };
  const out = await render(key, context, { subject, bodyHtml });
  const allowed = new Set(def.placeholders.map((p) => p.name));
  const used = [...`${subject} ${bodyHtml}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  res.json({ subject: out.subject, html: out.html, unknownPlaceholders: [...new Set(used.filter((n) => !allowed.has(n)))] });
});

module.exports = {
  list, get, update, reset, preview,
};
