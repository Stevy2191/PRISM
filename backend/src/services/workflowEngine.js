// Workflow rule execution engine. A rule is: a trigger event, a set of
// conditions (matched ALL or ANY), and an ordered list of actions. See
// backend/migrations/20260101000026-workflow-rules.js for the schema and
// the API spec this was built against for the full condition-field /
// action-type contract.
const { Op } = require('sequelize');
const {
  Ticket, Contact, Department, User, Role, TeamMember, Comment, CustomField, TicketFieldValue,
  WorkflowRule, WorkflowCondition, WorkflowAction, WorkflowRuleLog,
} = require('../models');
const { createNotification } = require('./notifications');

const ticketEvalInclude = [
  { model: Contact, as: 'contact', include: [{ model: Department, as: 'department' }] },
  { model: Department, as: 'department' },
  { model: User, as: 'assignee' },
  { model: User, as: 'createdByUser', include: [{ model: Role, as: 'primaryRole' }] },
  { model: TicketFieldValue, as: 'fieldValues', include: [{ model: CustomField, as: 'field' }] },
];

function buildCustomFieldsMap(fieldValues) {
  const out = {};
  for (const fv of fieldValues || []) {
    if (!fv.field) continue; // eslint-disable-line no-continue
    if (fv.field.fieldType === 'multiselect') {
      try { out[fv.field.fieldKey] = JSON.parse(fv.value); } catch { out[fv.field.fieldKey] = fv.value; }
    } else {
      out[fv.field.fieldKey] = fv.value;
    }
  }
  return out;
}

// Resolves a condition `field` string to the ticket's current value for it.
// Returns { value, isArray } — `isArray` marks fields (tags) that need
// membership-style matching instead of plain equality/substring.
function extractFieldValue(ticket, field) {
  if (field.startsWith('custom_field:')) {
    const key = field.slice('custom_field:'.length);
    const cf = buildCustomFieldsMap(ticket.fieldValues)[key];
    return { value: Array.isArray(cf) ? cf : cf, isArray: Array.isArray(cf) };
  }
  switch (field) {
    case 'status': return { value: ticket.status };
    case 'priority': return { value: ticket.priority };
    case 'type': return { value: ticket.type };
    case 'department': return { value: ticket.department?.name || null };
    case 'contact_department': return { value: ticket.contact?.department?.name || null };
    case 'assignee': return { value: ticket.assigneeId ? String(ticket.assigneeId) : 'unassigned' };
    case 'team': return { value: ticket.teamId ? String(ticket.teamId) : 'no_team' };
    case 'tag': return { value: ticket.tags || [], isArray: true };
    case 'title': return { value: ticket.title || '' };
    case 'created_by_role': return { value: ticket.createdByUser?.primaryRole?.name || null };
    case 'time_since_created':
      return { value: (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000 };
    case 'time_since_last_update':
      return { value: (Date.now() - new Date(ticket.updatedAt).getTime()) / 3600000 };
    default:
      return { value: null };
  }
}

function normalize(v) {
  return v === null || v === undefined ? '' : String(v).toLowerCase().trim();
}

function evaluateCondition(ticket, condition) {
  const { value, isArray } = extractFieldValue(ticket, condition.field);
  const target = condition.value;

  if (isArray) {
    const arr = Array.isArray(value) ? value : [];
    const has = target ? arr.some((v) => normalize(v) === normalize(target)) : arr.length > 0;
    switch (condition.operator) {
      case 'equals': case 'contains': return has;
      case 'not_equals': case 'not_contains': return !has;
      case 'is_empty': return arr.length === 0;
      case 'is_not_empty': return arr.length > 0;
      default: return has;
    }
  }

  if (condition.operator === 'is_empty') return value === null || value === undefined || String(value).trim() === '';
  if (condition.operator === 'is_not_empty') return !(value === null || value === undefined || String(value).trim() === '');

  if (condition.operator === 'greater_than' || condition.operator === 'less_than') {
    const a = parseFloat(value);
    const b = parseFloat(target);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return condition.operator === 'greater_than' ? a > b : a < b;
  }

  const a = normalize(value);
  const b = normalize(target);
  switch (condition.operator) {
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    default: return false;
  }
}

function evaluateConditions(ticket, conditions, matchMode) {
  if (!conditions.length) return true;
  return matchMode === 'any'
    ? conditions.some((c) => evaluateCondition(ticket, c))
    : conditions.every((c) => evaluateCondition(ticket, c));
}

function renderTemplate(text, ticket) {
  if (!text) return text;
  return text
    .replace(/\{\{\s*ticket\.title\s*\}\}/g, ticket.title || '')
    .replace(/\{\{\s*ticket\.status\s*\}\}/g, ticket.status || '')
    .replace(/\{\{\s*contact\.name\s*\}\}/g, ticket.contact?.displayName || 'the customer');
}

// Heuristic round robin: no dedicated "last assigned index" is tracked, so
// the next assignee is whoever among the team follows the member most
// recently assigned *any* ticket. Falls back to the first member if none of
// the team has ever been assigned anything.
async function pickRoundRobinAssignee(teamId) {
  const members = await TeamMember.findAll({ where: { teamId }, order: [['userId', 'ASC']] });
  if (!members.length) return null;
  const memberIds = members.map((m) => m.userId);
  // updatedAt alone isn't a reliable tiebreaker — MariaDB's DATETIME here
  // has only second precision, so tickets created in rapid succession (e.g.
  // several in the same request burst) can tie exactly. `id DESC` as a
  // secondary key makes "most recently assigned" deterministic.
  const lastAssigned = await Ticket.findOne({
    where: { assigneeId: { [Op.in]: memberIds } },
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
  });
  if (!lastAssigned) return memberIds[0];
  const idx = memberIds.indexOf(lastAssigned.assigneeId);
  return memberIds[(idx + 1) % memberIds.length];
}

// Executes one action against `ticket` (a live Sequelize instance — actions
// run sequentially so later actions in the same rule see earlier ones'
// changes). Returns a short human-readable summary for the log; throws on
// failure so the caller can catch-and-skip without aborting the rest of the
// rule's actions.
async function executeAction(ticket, action, rule) {
  const v = action.actionValue || {};
  switch (action.actionType) {
    case 'assign_to_user': {
      await ticket.update({ assigneeId: v.userId });
      return `assigned to user #${v.userId}`;
    }
    case 'assign_to_team': {
      await ticket.update({ teamId: v.teamId });
      return `assigned to team #${v.teamId}`;
    }
    case 'assign_round_robin': {
      const userId = await pickRoundRobinAssignee(v.teamId);
      if (!userId) throw new Error(`Team #${v.teamId} has no members for round robin`);
      await ticket.update({ assigneeId: userId, teamId: v.teamId });
      return `round-robin assigned to user #${userId}`;
    }
    case 'set_status': {
      await ticket.update({ status: v.status });
      return `status set to "${v.status}"`;
    }
    case 'set_priority': {
      await ticket.update({ priority: v.priority });
      return `priority set to "${v.priority}"`;
    }
    case 'add_tag': {
      const tags = new Set(ticket.tags || []);
      tags.add(v.tag);
      await ticket.update({ tags: [...tags] });
      return `tag "${v.tag}" added`;
    }
    case 'remove_tag': {
      const tags = (ticket.tags || []).filter((t) => t !== v.tag);
      await ticket.update({ tags: tags.length ? tags : null });
      return `tag "${v.tag}" removed`;
    }
    case 'set_due_date': {
      const ms = (v.unit === 'days' ? 86400000 : 3600000) * Number(v.amount || 0);
      const due = new Date(Date.now() + ms).toISOString().slice(0, 10);
      await ticket.update({ dueDate: due });
      return `due date set to ${due}`;
    }
    case 'send_notification': {
      const message = renderTemplate(v.message, ticket) || `Workflow rule "${rule.name}" fired on ticket: ${ticket.title}`;
      if (v.recipient === 'assignee') {
        if (!ticket.assigneeId) return 'notification skipped (no assignee)';
        await createNotification({ userId: ticket.assigneeId, type: 'workflow', message, ticketId: ticket.id });
        return 'notification sent to assignee';
      }
      if (v.recipient === 'contact') {
        // Contacts have no PRISM login/notification inbox (see the Contacts
        // module) — nothing to deliver until a customer portal exists.
        return 'notification skipped (contacts have no inbox yet)';
      }
      if (v.recipient === 'user') {
        await createNotification({ userId: v.userId, type: 'workflow', message, ticketId: ticket.id });
        return `notification sent to user #${v.userId}`;
      }
      if (v.recipient === 'team') {
        const members = await TeamMember.findAll({ where: { teamId: v.teamId } });
        await Promise.all(members.map((m) => createNotification({ userId: m.userId, type: 'workflow', message, ticketId: ticket.id })));
        return `notification sent to ${members.length} team member(s)`;
      }
      throw new Error(`Unknown notification recipient "${v.recipient}"`);
    }
    case 'add_private_comment': {
      if (!rule.createdBy) throw new Error('Rule has no createdBy — cannot attribute automated comment');
      await Comment.create({
        ticketId: ticket.id,
        authorId: rule.createdBy,
        type: 'comment_private',
        body: renderTemplate(v.text, ticket) || '(automated comment)',
      });
      return 'private comment added';
    }
    case 'escalate_to_user': {
      await ticket.update({ assigneeId: v.userId, priority: 'urgent' });
      return `escalated to user #${v.userId} (priority: urgent)`;
    }
    default:
      throw new Error(`Unknown action type "${action.actionType}"`);
  }
}

async function loadTicketForEvaluation(ticketId) {
  return Ticket.findByPk(ticketId, { include: ticketEvalInclude });
}

async function getActiveRulesForTrigger(triggerEvent) {
  return WorkflowRule.findAll({
    where: { isActive: true, triggerEvent },
    include: [
      { model: WorkflowCondition, as: 'conditions', separate: true, order: [['position', 'ASC']] },
      { model: WorkflowAction, as: 'actions', separate: true, order: [['position', 'ASC']] },
    ],
    order: [['position', 'ASC']],
  });
}

// Runs one already-loaded rule (with its conditions/actions) against one
// ticket: evaluates conditions, executes actions in order if they match, and
// always writes a WorkflowRuleLog row (even on a non-match, so admins can
// see "this rule didn't fire because..." from the log alone). A failing
// action is caught and skipped — it never aborts the rest of the rule's
// actions. Shared by evaluateRules() (event-driven) and the scheduler
// (time-driven, which pre-filters which (rule, ticket) pairs are due).
async function runRuleForTicket(rule, ticketId, changedFields = null) {
  const ticket = await loadTicketForEvaluation(ticketId);
  if (!ticket) return null; // ticket deleted since the caller queued this run

  const matched = evaluateConditions(ticket, rule.conditions, rule.conditionMatch);
  const executed = [];
  const errors = [];

  if (matched) {
    // eslint-disable-next-line no-restricted-syntax
    for (const action of rule.actions) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const summary = await executeAction(ticket, action, rule);
        executed.push({ actionType: action.actionType, summary });
      } catch (err) {
        errors.push(`${action.actionType}: ${err.message}`);
      }
    }
    await rule.update({ lastTriggeredAt: new Date() });
  }

  const notesParts = [];
  if (changedFields) notesParts.push(`changed: ${Array.isArray(changedFields) ? changedFields.join(', ') : String(changedFields)}`);
  if (errors.length) notesParts.push(`errors: ${errors.join('; ')}`);

  await WorkflowRuleLog.create({
    ruleId: rule.id,
    ticketId,
    conditionsMet: matched,
    actionsExecuted: executed.length ? executed.map((e) => e.actionType) : null,
    notes: notesParts.length ? notesParts.join(' | ') : null,
  });

  return { matched, executed, errors };
}

// Runs every active rule for `triggerEvent` against `ticketId`, in position
// order. Used by the event-driven hooks in ticketsController.js.
async function evaluateRules(ticketId, triggerEvent, changedFields = null) {
  const rules = await getActiveRulesForTrigger(triggerEvent);
  if (!rules.length) return;

  // eslint-disable-next-line no-restricted-syntax
  for (const rule of rules) {
    // eslint-disable-next-line no-await-in-loop
    await runRuleForTicket(rule, ticketId, changedFields);
  }
}

// Dry run for the Settings UI's "Test this rule" button — evaluates
// conditions against a real ticket and describes what each action WOULD do,
// without mutating the ticket or writing a log entry.
async function testRule(ruleId, ticketId) {
  const rule = await WorkflowRule.findByPk(ruleId, {
    include: [
      { model: WorkflowCondition, as: 'conditions', separate: true, order: [['position', 'ASC']] },
      { model: WorkflowAction, as: 'actions', separate: true, order: [['position', 'ASC']] },
    ],
  });
  if (!rule) throw new Error('Rule not found');

  const ticket = await loadTicketForEvaluation(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const conditionResults = rule.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value,
    matched: evaluateCondition(ticket, c),
  }));
  const matched = evaluateConditions(ticket, rule.conditions, rule.conditionMatch);

  const wouldExecute = matched
    ? rule.actions.map((a) => describeAction(a, ticket))
    : [];

  return { matched, conditionResults, wouldExecute };
}

// Human-readable "what this action would do" for the test-rule preview —
// deliberately read-only (no DB writes), unlike executeAction.
function describeAction(action, ticket) {
  const v = action.actionValue || {};
  switch (action.actionType) {
    case 'assign_to_user': return { actionType: action.actionType, description: `Assign to user #${v.userId}` };
    case 'assign_to_team': return { actionType: action.actionType, description: `Assign to team #${v.teamId}` };
    case 'assign_round_robin': return { actionType: action.actionType, description: `Round-robin assign within team #${v.teamId}` };
    case 'set_status': return { actionType: action.actionType, description: `Set status to "${v.status}"` };
    case 'set_priority': return { actionType: action.actionType, description: `Set priority to "${v.priority}"` };
    case 'add_tag': return { actionType: action.actionType, description: `Add tag "${v.tag}"` };
    case 'remove_tag': return { actionType: action.actionType, description: `Remove tag "${v.tag}"` };
    case 'set_due_date': return { actionType: action.actionType, description: `Set due date to +${v.amount} ${v.unit}` };
    case 'send_notification': return { actionType: action.actionType, description: `Notify ${v.recipient}: "${renderTemplate(v.message, ticket) || '(default message)'}"` };
    case 'add_private_comment': return { actionType: action.actionType, description: `Add private comment: "${renderTemplate(v.text, ticket) || ''}"` };
    case 'escalate_to_user': return { actionType: action.actionType, description: `Escalate to user #${v.userId} (priority: urgent)` };
    default: return { actionType: action.actionType, description: 'Unknown action' };
  }
}

module.exports = {
  evaluateRules,
  testRule,
  evaluateConditions,
  evaluateCondition,
  runRuleForTicket,
  getActiveRulesForTrigger,
};
