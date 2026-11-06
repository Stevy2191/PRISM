// A finished (or skipped) ticket form as a PDF, for the record (Playbooks,
// PB, task 7). Every item that showed, with who did it and when, and each
// recorded answer. Secure values are never in it: their line says the value
// was recorded, not what it is.
const {
  newDocument, drawHeader, sectionTitle, fieldGrid, paragraph, streamPdfResponse,
} = require('../pdfReport');
const { stripToText } = require('../../utils/richHtml');
const { User, Contact } = require('../../models');
const { stateOf, secretsOf } = require('./ticketForms');
const { ApiError } = require('../../middleware/error');

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

async function streamFormPdf(res, ticket, tf) {
  if (tf.state === 'open') throw new ApiError(409, 'The PDF is ready once the form is finished or skipped', 'FORM_OPEN');
  const def = tf.formVersion.definition;
  const secrets = await secretsOf(tf);
  const secretKeys = new Set(secrets.map((s) => s.itemKey));
  const state = stateOf(tf, secrets);
  const shown = new Map(state.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  const sectionShown = new Map(state.sections.map((s) => [s.key, s.shown]));
  const answers = tf.answers || {};
  const userIds = [...new Set([
    ...Object.values(answers).map((a) => a && a.by).filter(Boolean),
    ...def.sections.flatMap((s) => s.items).filter((i) => i.kind === 'field' && i.fieldType === 'staff').map((i) => answers[i.key]).filter(Boolean),
    tf.finishedBy,
  ].filter(Boolean))];
  const users = new Map((await User.findAll({ where: { id: userIds }, attributes: ['id', 'displayName'] })).map((u) => [u.id, u.displayName]));
  const contactIds = def.sections.flatMap((s) => s.items).filter((i) => i.kind === 'field' && i.fieldType === 'contact').map((i) => answers[i.key]).filter(Boolean);
  const contacts = new Map((await Contact.findAll({ where: { id: contactIds }, attributes: ['id', 'displayName'] })).map((c) => [c.id, c.displayName]));
  const formName = tf.formVersion.form ? tf.formVersion.form.name : 'Form';
  const p = tf.ticketPlaybook && tf.ticketPlaybook.contact;

  const fieldText = (item, v) => {
    if (v === undefined || v === null || v === '') return '—';
    if (item.fieldType === 'yesno') return v ? 'Yes' : 'No';
    if (item.fieldType === 'choices') return v.join(', ');
    if (item.fieldType === 'staff') return users.get(v) || `#${v}`;
    if (item.fieldType === 'contact') return contacts.get(v) || `#${v}`;
    return String(v);
  };
  const byLine = (a) => (a && a.done ? ` (${a.byAgent ? 'PRISM agent' : users.get(a.by) || 'someone'}, ${when(a.at)})` : '');

  const filename = `${formName.replace(/[^\w .()-]/g, '_')} - ticket ${String(ticket.id).padStart(5, '0')}.pdf`;
  const doc = newDocument();
  await streamPdfResponse(res, filename, doc, async () => {
    await drawHeader(doc, formName);
    fieldGrid(doc, [
      ['Ticket', `#${String(ticket.id).padStart(5, '0')} ${ticket.title}`],
      ['Form version', String(tf.formVersion.version)],
      ['Device', tf.asset ? `${tf.asset.name} (${tf.asset.assetTag})` : ''],
      ['For', p ? p.displayName : ''],
      ['State', tf.state === 'skipped' ? `Skipped: ${tf.skipReason || ''}` : 'Finished'],
      ['Finished', `${when(tf.finishedAt)}${tf.finishedBy ? ` by ${users.get(tf.finishedBy) || ''}` : ''}`],
    ]);
    for (const section of def.sections) {
      if (!sectionShown.get(section.key)) continue; // eslint-disable-line no-continue
      sectionTitle(doc, section.title);
      for (const item of section.items) {
        const s = shown.get(item.key);
        if (!s || !s.shown) continue; // eslint-disable-line no-continue
        const a = answers[item.key];
        if (item.kind === 'text') paragraph(doc, stripToText(item.body));
        else if (item.kind === 'field') paragraph(doc, `${item.label}: ${fieldText(item, a)}`);
        else if (item.kind === 'secure') paragraph(doc, `${item.label}: ${secretKeys.has(item.key) ? 'recorded, not shown' : 'not recorded'}`);
        else paragraph(doc, `[${a && a.done ? 'x' : ' '}] ${stripToText(item.body || (item.action === 'check_out' ? 'Check out this device' : 'Check in this device'))}${byLine(a)}${a && a.note ? `. Note: ${a.note}` : ''}`);
      }
    }
  });
}

module.exports = { streamFormPdf };
