// Helpers shared by the ticket controller modules.
const {
  CsatResponse,
  CsatSurvey,
  Asset,
  Team,
  CustomField,
  TicketFieldValue,
  User,
  Contact,
  Project,
  Department,
  Company,
  TicketSla,
  SlaPolicy,
  TicketDueDateChange,
  Ticket,
} = require('../../models');
const { toSlaView } = require('../../services/sla/slaView');
const { ticketWaitingView } = require('../../services/ticketWaiting');
const { Op, col } = require('sequelize');
const { ApiError } = require('../../middleware/error');
const { toDateString } = require('../../utils/orgTime');
const {
  canEditTicket, canAccessProject, canModerateTicketContent, hasPermission, canAccessTicket,
} = require('../../services/permissionService');

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
    // The department and company columns are for the viewer check (shownTicketFor), never sent.
    attributes: ['id', 'name', 'companyId', 'ownerDepartmentId', 'forDepartmentId'],
    where: { companyId: { [Op.eq]: col('Ticket.companyId') } },
    required: false,
  },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: Company, as: 'company', attributes: ['id', 'name'] },
  { model: User, as: 'resolutionUpdatedByUser', attributes: userAttrs },
  { model: CsatResponse, as: 'csat' },
  { model: TicketSla, as: 'sla', include: [{ model: SlaPolicy, as: 'policy', attributes: ['id', 'name'] }] },
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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const isScalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// A value must fit its field (Q29): numbers are numbers, dates real dates,
// choices among the options, links http(s). Empty clears the value, as before.
function fitsField(field, raw) {
  const options = Array.isArray(field.options) ? field.options.map(String) : [];
  if (field.fieldType === 'multiselect') return Array.isArray(raw) && raw.every((v) => isScalar(v) && options.includes(String(v)));
  if (!isScalar(raw)) return false;
  const v = String(raw).trim();
  switch (field.fieldType) {
    case 'number': return NUMBER.test(v);
    case 'date': return v.length === 10 && toDateString(v) === v;
    case 'datetime': return DATETIME.test(v) && !Number.isNaN(new Date(v).getTime()) && !!toDateString(v);
    case 'dropdown': return options.includes(String(raw));
    case 'checkbox': return v === 'true' || v === 'false';
    case 'email': return EMAIL.test(v);
    case 'url': return /^https?:\/\/\S+$/i.test(v);
    default: return true;
  }
}

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
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length);
    if (!empty && !fitsField(field, raw)) {
      throw new ApiError(400, `"${field.label}" doesn't accept that value`, 'VALIDATION_ERROR');
    }
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

// A ticket as a viewer may see it: its project shows only its id when the
// viewer can't open that project (as a restricted linked ticket does, Q18).
async function shownTicketFor(viewer, ticket) {
  const json = withCustomFields(ticket);
  // Only when the SLA row was loaded: null then means "no SLA".
  if (ticket.sla !== undefined) json.sla = toSlaView(ticket.sla);
  if (ticket.project) {
    json.project = (await canAccessProject(viewer, ticket.project))
      ? { id: ticket.project.id, name: ticket.project.name }
      : { id: ticket.project.id, restricted: true };
  }
  return json;
}

// Default page size for the per-record lists on a ticket's detail page
// (comments, attachments, time entries, activity). They use a "load more"
// control rather than numbered pages, so this is the chunk size.
const SUBLIST_LIMIT = 25;

// The detail-page lists grow by "load more", which asks for a larger single
// page rather than a second one — so their ceiling is higher than the shared
// 200 used for browsable tables.
const SUBLIST_MAX = 500;

// Changing a ticket's own data needs the edit tier on it (Q26); call after
// the view check, which answers "can't see it" first.
async function assertCanEditTicket(user, ticket) {
  if (!(await canEditTicket(user, ticket))) throw new ApiError(403, 'You do not have permission to edit this ticket', 'FORBIDDEN');
}

// What the viewer may do with this ticket, for the screens to follow (the
// server re-checks every request).
// The ticket as GET /tickets/:id returns it: the viewer's view, its access
// flags, and on its SLA the due date history.
async function ticketDetailFor(viewer, ticket) {
  const json = await shownTicketFor(viewer, ticket);
  if (ticket.sla) {
    const changes = await TicketDueDateChange.findAll({
      where: { ticketId: ticket.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'displayName'] }],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    });
    json.sla = toSlaView(ticket.sla, new Date(), changes);
  }
  json.waiting = await ticketWaitingView(ticket);
  // Merged away (5b): the live ticket, with its title only for viewers who
  // can open it.
  json.mergedInto = null;
  if (ticket.mergedIntoId) {
    const into = await Ticket.findByPk(ticket.mergedIntoId, { attributes: ['id', 'title', 'companyId', 'departmentId', 'assigneeId'] });
    if (into) json.mergedInto = (await canAccessTicket(viewer, into)) ? { id: into.id, title: into.title } : { id: into.id };
  }
  return { ...json, access: await ticketAccessFor(viewer, ticket) };
}

async function ticketAccessFor(viewer, ticket) {
  const edit = await canEditTicket(viewer, ticket);
  return {
    edit,
    moderate: await canModerateTicketContent(viewer, ticket),
    delete: edit && (await hasPermission(viewer.id, 'tickets.delete')),
  };
}

module.exports = {
  assertCanEditTicket,
  shownTicketFor,
  ticketDetailFor,
  ticketAccessFor,
  ticketInclude,
  withCustomFields,
  syncCustomFieldValues,
  SUBLIST_LIMIT,
  SUBLIST_MAX,
  userAttrs,
  buildCustomFieldsObject,
};
