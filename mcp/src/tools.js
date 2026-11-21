// The tools Claude sees. Each one is a thin wrapper over a PRISM API call;
// PRISM itself enforces permissions and company boundaries for the key's owner.
import { z } from 'zod';
import { PrismApiError } from './prismClient.js';

// Results bigger than this are cut, with a note, so one call can't flood the
// conversation. Narrow the query (filters, a smaller limit) to see the rest.
export const MAX_RESULT_CHARS = 60_000;

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const ticketRef = z.union([z.number().int().positive(), z.string().min(1).max(64)])
  .describe('The ticket: its id (42) or its company ticket number (for example LITS-T0042)');
const recordId = (what) => z.number().int().positive().describe(`The ${what}'s id`);
const page = z.number().int().min(1).optional().describe('Page number, from 1 (default 1)');
const limit = (dflt) => z.number().int().min(1).max(200).optional().describe(`How many per page (default ${dflt}, at most 200)`);
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export function formatResult(data) {
  let text = JSON.stringify(data, null, 2);
  if (text === undefined) text = 'null';
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n[Cut at ${MAX_RESULT_CHARS} characters. Ask for fewer results or narrow the filters to see the rest.]`;
  }
  return { content: [{ type: 'text', text }] };
}

export function formatError(err) {
  if (err instanceof PrismApiError) {
    const hint = {
      401: ' The API key was refused: it may be revoked, expired, or its owner deactivated.',
      403: ' The API key\'s owner does not have permission for this.',
      429: ' PRISM is rate limiting this key; wait a little and try again.',
    }[err.status] || '';
    return { isError: true, content: [{ type: 'text', text: `PRISM error (${err.code}): ${err.message}.${hint}` }] };
  }
  return { isError: true, content: [{ type: 'text', text: `Error: ${(err && err.message) || String(err)}` }] };
}

// Write endpoints take the numeric id; reads also take the company number.
// Reading first resolves either form and checks the caller can see the ticket.
async function resolveTicketId(client, ref) {
  if (typeof ref === 'number') return ref;
  if (/^\d+$/.test(ref)) return parseInt(ref, 10);
  const { ticket } = await client.get(`/tickets/${encodeURIComponent(ref)}`);
  return ticket.id;
}

// Each entry: name, config (title, description, inputSchema, annotations), run(client, args).
export const TOOLS = [
  // --- Who and what -------------------------------------------------------
  {
    name: 'prism_whoami',
    config: {
      title: 'Who am I in PRISM',
      description: 'The PRISM user this connection acts as (the API key\'s owner), with their role. Every other tool sees and changes only what this user may.',
      inputSchema: {},
      annotations: READ,
    },
    run: (c) => c.get('/auth/me'),
  },
  {
    name: 'prism_search',
    config: {
      title: 'Search PRISM',
      description: 'Quick search across tickets (title or number), projects (name or code) and contacts (name or email). Returns up to 5 of each. Use the list tools for more.',
      inputSchema: { query: z.string().min(1).max(200).describe('Words, a ticket number like LITS-T0042, a project code, a name or an email') },
      annotations: READ,
    },
    run: (c, { query }) => c.get('/search', { q: query }),
  },
  {
    name: 'prism_dashboard',
    config: {
      title: 'Dashboard',
      description: 'The help desk at a glance for this user: open work, what needs attention, SLA state, project health and team workload.',
      inputSchema: {},
      annotations: READ,
    },
    run: (c) => c.get('/dashboard'),
  },

  // --- Tickets ------------------------------------------------------------
  {
    name: 'prism_list_tickets',
    config: {
      title: 'List tickets',
      description: 'Tickets matching filters, newest activity first unless sorted otherwise. status accepts a status name, or "not_closed", "on_hold" or "closed" for every status of that kind; several may be given.',
      inputSchema: {
        status: z.array(z.string().max(100)).max(20).optional().describe('Status names or "not_closed" / "on_hold" / "closed"'),
        priority: priority.optional(),
        type: z.enum(['incident', 'request', 'problem', 'task', 'change']).optional(),
        companyId: recordId('company').optional(),
        contactId: recordId('contact').optional(),
        assigneeId: recordId('assignee (user)').optional(),
        teamId: recordId('team').optional(),
        projectId: recordId('project').optional(),
        search: z.string().max(200).optional().describe('Text to look for in the title and description'),
        myTickets: z.boolean().optional().describe('Only tickets assigned to me'),
        unassigned: z.boolean().optional().describe('Only tickets with no assignee'),
        overdue: z.boolean().optional().describe('Only tickets past their due date'),
        sortBy: z.enum(['id', 'title', 'priority', 'status', 'dueDate', 'createdAt', 'updatedAt']).optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
        page,
        limit: limit(25),
      },
      annotations: READ,
    },
    run: (c, a) => c.get('/tickets', {
      status: a.status,
      priority: a.priority,
      type: a.type,
      companyId: a.companyId,
      contactId: a.contactId,
      assignee: a.assigneeId,
      team: a.teamId,
      project: a.projectId,
      search: a.search,
      myTickets: a.myTickets ? 'true' : undefined,
      unassigned: a.unassigned ? 'true' : undefined,
      overdue: a.overdue ? 'true' : undefined,
      sortBy: a.sortBy,
      sortDir: a.sortDir,
      page: a.page,
      limit: a.limit ?? 25,
    }),
  },
  {
    name: 'prism_get_ticket',
    config: {
      title: 'Get a ticket',
      description: 'One ticket in full: its details, SLA clocks and, unless left out, its conversation (replies and comments, including private notes the user may see).',
      inputSchema: {
        ticket: ticketRef,
        includeConversation: z.boolean().optional().describe('Include replies and comments (default true)'),
      },
      annotations: READ,
    },
    run: async (c, { ticket, includeConversation = true }) => {
      const detail = await c.get(`/tickets/${encodeURIComponent(ticket)}`);
      if (!includeConversation) return detail;
      const comments = await c.get(`/tickets/${detail.ticket.id}/comments`);
      return { ...detail, ...comments };
    },
  },
  {
    name: 'prism_ticket_activity',
    config: {
      title: 'Ticket history',
      description: 'The change history of a ticket: who changed its status, assignee, priority and other fields, and when.',
      inputSchema: { ticket: ticketRef },
      annotations: READ,
    },
    run: async (c, { ticket }) => c.get(`/tickets/${await resolveTicketId(c, ticket)}/activity`),
  },
  {
    name: 'prism_create_ticket',
    config: {
      title: 'Create a ticket',
      description: 'Raise a new ticket for a contact. Find the contact first (prism_search or prism_list_contacts). Notifications and workflow rules run as they would for a ticket made in the web app.',
      inputSchema: {
        contactId: recordId('contact the ticket is for'),
        title: z.string().min(1).max(255),
        description: z.string().max(50_000).optional().describe('What the problem or request is'),
        priority: priority.optional(),
        type: z.enum(['incident', 'request', 'problem', 'task', 'change']).optional(),
        categoryId: recordId('ticket category').optional(),
        assigneeId: recordId('assignee (user)').optional(),
        teamId: recordId('team').optional(),
        dueDate: isoDate.optional(),
        source: z.enum(['manual', 'phone', 'email']).optional().describe('How the request came in (default manual)'),
      },
      annotations: WRITE,
    },
    run: (c, a) => c.post('/tickets', a),
  },
  {
    name: 'prism_update_ticket',
    config: {
      title: 'Update a ticket',
      description: 'Change a ticket\'s fields: status, priority, assignee, team, due date, category, title or resolution. Only the fields given change. Use prism_list_ticket_statuses for valid status names and prism_list_users for assignees.',
      inputSchema: {
        ticket: ticketRef,
        status: z.string().max(100).optional(),
        priority: priority.optional(),
        assigneeId: recordId('assignee (user)').nullable().optional().describe('A user id, or null to unassign'),
        teamId: recordId('team').nullable().optional(),
        dueDate: isoDate.nullable().optional(),
        categoryId: recordId('ticket category').optional(),
        title: z.string().min(1).max(255).optional(),
        resolution: z.string().max(50_000).optional().describe('How it was resolved (the customer can see this)'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run: async (c, { ticket, ...changes }) => {
      const body = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(body).length) throw new Error('Give at least one field to change');
      return c.patch(`/tickets/${await resolveTicketId(c, ticket)}`, body);
    },
  },
  {
    name: 'prism_add_ticket_comment',
    config: {
      title: 'Reply or comment on a ticket',
      description: 'Add to a ticket\'s conversation. kind "private_note" is staff-only and never emailed. kind "reply" is EMAILED to the ticket\'s contact and CCs, so confirm the wording with the user before sending one. kind "public_comment" is visible to the customer in the portal.',
      inputSchema: {
        ticket: ticketRef,
        body: z.string().min(1).max(50_000),
        kind: z.enum(['private_note', 'reply', 'public_comment']).optional().describe('Default private_note'),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    run: async (c, { ticket, body, kind = 'private_note' }) => {
      const type = { private_note: 'comment_private', reply: 'reply', public_comment: 'comment_public' }[kind];
      return c.post(`/tickets/${await resolveTicketId(c, ticket)}/comments`, { body, type });
    },
  },
  {
    name: 'prism_log_ticket_time',
    config: {
      title: 'Log time on a ticket',
      description: 'Record time worked on a ticket for the key\'s owner. The date defaults to today and cannot be in the future; the work type defaults to the ticket\'s default.',
      inputSchema: {
        ticket: ticketRef,
        durationMinutes: z.number().int().min(1).max(24 * 60),
        note: z.string().max(5000).optional(),
        entryDate: isoDate.optional(),
        billable: z.boolean().optional(),
        workTypeId: recordId('work type').optional(),
      },
      annotations: WRITE,
    },
    run: async (c, { ticket, ...entry }) => c.post(`/tickets/${await resolveTicketId(c, ticket)}/time`, entry),
  },
  {
    name: 'prism_list_ticket_statuses',
    config: {
      title: 'Ticket statuses',
      description: 'The ticket statuses this help desk uses, with whether each counts as open, on hold or closed.',
      inputSchema: {},
      annotations: READ,
    },
    run: (c) => c.get('/ticket-statuses'),
  },
  {
    name: 'prism_list_ticket_categories',
    config: {
      title: 'Ticket categories',
      description: 'The ticket categories (a tree), optionally the ones offered for one company.',
      inputSchema: { companyId: recordId('company').optional() },
      annotations: READ,
    },
    run: (c, { companyId }) => c.get('/ticket-categories', { companyId }),
  },

  // --- People and companies ----------------------------------------------
  {
    name: 'prism_list_users',
    config: {
      title: 'Staff who can be assigned',
      description: 'Staff users who can be assigned tickets, optionally only those who can reach one company.',
      inputSchema: { companyId: recordId('company').optional() },
      annotations: READ,
    },
    run: (c, { companyId }) => c.get('/users/assignable', { companyId }),
  },
  {
    name: 'prism_list_companies',
    config: {
      title: 'List companies',
      description: 'Customer and vendor companies this user can reach.',
      inputSchema: {
        search: z.string().max(200).optional().describe('Part of the company name'),
        kind: z.enum(['client', 'vendor']).optional(),
        status: z.enum(['active', 'inactive']).optional(),
        page,
        limit: limit(50),
      },
      annotations: READ,
    },
    run: (c, a) => c.get('/companies', a),
  },
  {
    name: 'prism_get_company',
    config: {
      title: 'Get a company',
      description: 'One company: its details plus an at-a-glance summary (open tickets, projects, contacts, devices).',
      inputSchema: { companyId: recordId('company') },
      annotations: READ,
    },
    run: async (c, { companyId }) => {
      const [company, glance] = await Promise.all([
        c.get(`/companies/${companyId}`),
        c.get(`/companies/${companyId}/glance`).catch(() => null),
      ]);
      return glance ? { ...company, glance } : company;
    },
  },
  {
    name: 'prism_list_contacts',
    config: {
      title: 'List contacts',
      description: 'The people you support (customers\' contacts), searchable by name, email or phone.',
      inputSchema: {
        search: z.string().max(200).optional(),
        companyId: recordId('company').optional(),
        status: z.enum(['active', 'inactive']).optional(),
        page,
        limit: limit(50),
      },
      annotations: READ,
    },
    run: (c, a) => c.get('/contacts', a),
  },
  {
    name: 'prism_get_contact',
    config: {
      title: 'Get a contact',
      description: 'One contact\'s details and, unless left out, their recent tickets.',
      inputSchema: {
        contactId: recordId('contact'),
        includeTickets: z.boolean().optional().describe('Include their tickets (default true)'),
      },
      annotations: READ,
    },
    run: async (c, { contactId, includeTickets = true }) => {
      const contact = await c.get(`/contacts/${contactId}`);
      if (!includeTickets) return contact;
      return { ...contact, tickets: await c.get(`/contacts/${contactId}/tickets`) };
    },
  },

  // --- Projects -----------------------------------------------------------
  {
    name: 'prism_list_projects',
    config: {
      title: 'List projects',
      description: 'Projects this user can see.',
      inputSchema: {
        search: z.string().max(200).optional().describe('Part of the name or project code'),
        companyId: recordId('company').optional(),
        status: z.string().max(100).optional().describe('A project status name'),
        myProjects: z.boolean().optional().describe('Only projects I own or work on'),
        overdue: z.boolean().optional(),
        page,
        limit: limit(25),
      },
      annotations: READ,
    },
    run: (c, a) => c.get('/projects', {
      ...a,
      myProjects: a.myProjects ? 'true' : undefined,
      overdue: a.overdue ? 'true' : undefined,
      limit: a.limit ?? 25,
    }),
  },
  {
    name: 'prism_get_project',
    config: {
      title: 'Get a project',
      description: 'One project with its phases, tasks and progress figures (hours and budget).',
      inputSchema: { projectId: recordId('project') },
      annotations: READ,
    },
    run: async (c, { projectId }) => {
      const [project, phases, tasks, stats] = await Promise.all([
        c.get(`/projects/${projectId}`),
        c.get(`/projects/${projectId}/phases`).catch(() => null),
        c.get(`/projects/${projectId}/tasks`).catch(() => null),
        c.get(`/projects/${projectId}/stats`).catch(() => null),
      ]);
      return { ...project, phases, tasks, stats };
    },
  },

  // --- Assets and knowledge ---------------------------------------------
  {
    name: 'prism_list_assets',
    config: {
      title: 'List assets',
      description: 'Equipment, licenses and contracts tracked as assets, including computers kept current by the PRISM agent.',
      inputSchema: {
        search: z.string().max(200).optional().describe('Name, tag or serial number'),
        companyId: recordId('company').optional(),
        status: z.string().max(100).optional(),
        page,
        limit: limit(25),
      },
      annotations: READ,
    },
    run: (c, a) => c.get('/assets', { ...a, limit: a.limit ?? 25 }),
  },
  {
    name: 'prism_get_asset',
    config: {
      title: 'Get an asset',
      description: 'One asset in full, including, for agent-managed computers, the device\'s hardware and who uses it.',
      inputSchema: { assetId: recordId('asset') },
      annotations: READ,
    },
    run: (c, { assetId }) => c.get(`/assets/${assetId}`),
  },
  {
    name: 'prism_search_knowledge',
    config: {
      title: 'Search the knowledge base',
      description: 'Knowledge base articles matching words, for answering a question or suggesting a fix. Read one in full with prism_get_article.',
      inputSchema: {
        query: z.string().max(200).optional(),
        categoryId: recordId('knowledge category').optional(),
      },
      annotations: READ,
    },
    run: (c, { query, categoryId }) => c.get('/knowledge/articles', { q: query, categoryId }),
  },
  {
    name: 'prism_get_article',
    config: {
      title: 'Read a knowledge article',
      description: 'One knowledge base article in full.',
      inputSchema: { articleId: recordId('article') },
      annotations: READ,
    },
    run: (c, { articleId }) => c.get(`/knowledge/articles/${articleId}`),
  },
];

export const WRITE_TOOL_NAMES = new Set(TOOLS.filter((t) => !t.config.annotations.readOnlyHint).map((t) => t.name));

// Registers the tools on an McpServer. readOnly leaves out every tool that
// changes anything, for connections that should only look.
export function registerTools(server, client, { readOnly = false } = {}) {
  for (const tool of TOOLS) {
    if (readOnly && WRITE_TOOL_NAMES.has(tool.name)) continue;
    server.registerTool(tool.name, tool.config, async (args) => {
      try {
        return formatResult(await tool.run(client, args || {}));
      } catch (err) {
        return formatError(err);
      }
    });
  }
}
