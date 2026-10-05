// Helpers shared by the ticket controller modules.
const {
  CsatResponse,
  CsatSurvey,
  Asset,
  Team,
  TeamMember,
  CustomField,
  TicketFieldValue,
  User,
  Contact,
  Project,
  Department,
  Company,
} = require('../../models');
const { Op, col } = require('sequelize');

const userAttrs = ['id', 'displayName', 'username', 'email'];

const ticketInclude = [
  { model: User, as: 'assignee', attributes: userAttrs },
  {
    model: Contact,
    as: 'contact',
    attributes: ['id', 'firstName', 'lastName', 'displayName', 'email', 'phone', 'departmentId'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  },
  { model: Team, as: 'team', attributes: ['id', 'name'] },
  // Only a project in the ticket's company: a link can outlive a move.
  {
    model: Project,
    as: 'project',
    attributes: ['id', 'name'],
    where: { companyId: { [Op.eq]: col('Ticket.companyId') } },
    required: false,
  },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: Company, as: 'company', attributes: ['id', 'name'] },
  { model: User, as: 'resolutionUpdatedByUser', attributes: userAttrs },
  { model: CsatResponse, as: 'csat' },
  // surveyToken excluded — it's the sole credential for the fully public,
  // unauthenticated POST /survey/:token endpoint, so embedding it here would
  // let any staff member who can view the ticket submit a fake response as
  // the customer. The ticket UI only ever reads status/rating/comment/sentAt.
  { model: CsatSurvey, as: 'csatSurvey', attributes: { exclude: ['surveyToken'] } },
  // Only assets in the ticket's company: a link can outlive a move of the
  // asset (or of the ticket's contact), and must not show across companies.
  {
    model: Asset,
    as: 'linkedAssets',
    through: { attributes: [] },
    attributes: ['id', 'assetTag', 'name'],
    where: { companyId: { [Op.eq]: col('Ticket.companyId') } },
    required: false,
  },
  {
    model: TicketFieldValue,
    as: 'fieldValues',
    include: [{ model: CustomField, as: 'field' }],
  },
];

// Upsert/remove a ticket's admin-defined custom field values.
// values: { fieldKey: value, ... } — an empty/null value deletes the row.
async function syncCustomFieldValues(ticketId, values, t) {
  if (!values || typeof values !== 'object') return;
  const keys = Object.keys(values);
  if (!keys.length) return;

  const fields = await CustomField.findAll({ where: { fieldKey: keys }, transaction: t });
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  for (const key of keys) {
    const field = fieldByKey.get(key);
    if (!field) continue; // eslint-disable-line no-continue
    const raw = values[key];
    const value = raw === undefined || raw === null ? '' : (Array.isArray(raw) ? JSON.stringify(raw) : String(raw));
    if (value === '') {
      // eslint-disable-next-line no-await-in-loop
      await TicketFieldValue.destroy({ where: { ticketId, fieldId: field.id }, transaction: t });
    } else {
      // eslint-disable-next-line no-await-in-loop
      const existing = await TicketFieldValue.findOne({ where: { ticketId, fieldId: field.id }, transaction: t });
      // eslint-disable-next-line no-await-in-loop
      if (existing) await existing.update({ value }, { transaction: t });
      // eslint-disable-next-line no-await-in-loop
      else await TicketFieldValue.create({ ticketId, fieldId: field.id, value }, { transaction: t });
    }
  }
}

// { fieldKey: value } from a ticket's loaded `fieldValues` association
// (each row's nested `field` gives the key). Multiselect values are stored
// as a JSON string and parsed back into an array here.
function buildCustomFieldsObject(fieldValues) {
  const out = {};
  for (const fv of fieldValues || []) {
    if (!fv.field) continue; // eslint-disable-line no-continue
    if (fv.field.fieldType === 'multiselect') {
      try {
        out[fv.field.fieldKey] = JSON.parse(fv.value);
      } catch {
        out[fv.field.fieldKey] = fv.value;
      }
    } else {
      out[fv.field.fieldKey] = fv.value;
    }
  }
  return out;
}

function withCustomFields(ticket) {
  const json = ticket.toJSON();
  json.customFields = buildCustomFieldsObject(ticket.fieldValues);
  return json;
}

// Admins and team leads may log time attributed to another tech.
async function canLogForOthers(user) {
  if (user.role === 'admin') return true;
  const lead = await TeamMember.findOne({ where: { userId: user.id, isLead: true } });
  return !!lead;
}

// Default page size for the per-record lists on a ticket's detail page
// (comments, attachments, time entries, activity). They use a "load more"
// control rather than numbered pages, so this is the chunk size.
const SUBLIST_LIMIT = 25;

// The detail-page lists grow by "load more", which asks for a larger single
// page rather than a second one — so their ceiling is higher than the shared
// 200 used for browsable tables.
const SUBLIST_MAX = 500;

module.exports = {
  ticketInclude,
  withCustomFields,
  syncCustomFieldValues,
  SUBLIST_LIMIT,
  SUBLIST_MAX,
  userAttrs,
  canLogForOthers,
  buildCustomFieldsObject,
};
