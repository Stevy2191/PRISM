// PRISM -> external calendar push (the optional "Sync PRISM events to this
// calendar" per-integration toggle). Deliberately structured so every call
// site (ticket/project controllers) can fire-and-forget this — it never
// throws, and a failure here must never affect the ticket/project mutation
// that triggered it.
const {
  UserCalendarIntegration, CalendarEventCache, Ticket, Project,
} = require('../models');
const { ensureValidAccessToken, providerCredentials } = require('./calendarSync');
const google = require('./googleCalendar');
const microsoft = require('./microsoftCalendar');

const PROVIDER_LIBS = { google, microsoft };

async function syncEnabledIntegrationsFor(userId) {
  if (!userId) return [];
  return UserCalendarIntegration.findAll({ where: { userId, syncEnabled: true, isActive: true } });
}

// prismEvent: { type: 'ticket'|'project', id, title, dueDate, url }
async function pushUpsert(prismEvent, ownerUserId) {
  const integrations = await syncEnabledIntegrationsFor(ownerUserId);
  // eslint-disable-next-line no-restricted-syntax
  for (const integration of integrations) {
    // eslint-disable-next-line no-await-in-loop
    await pushToOneIntegration(integration, prismEvent).catch((err) => {
      console.error(`[calendar-push] integration ${integration.id} upsert failed:`, err.message);
    });
  }
}

async function pushDelete(type, itemId, ownerUserId) {
  const integrations = await syncEnabledIntegrationsFor(ownerUserId);
  // eslint-disable-next-line no-restricted-syntax
  for (const integration of integrations) {
    // eslint-disable-next-line no-await-in-loop
    await deleteFromOneIntegration(integration, type, itemId).catch((err) => {
      console.error(`[calendar-push] integration ${integration.id} delete failed:`, err.message);
    });
  }
}

async function pushToOneIntegration(integration, prismEvent) {
  const providerLib = PROVIDER_LIBS[integration.provider];
  if (!providerLib || !integration.calendarId) return; // ical can't be a push target; no calendar chosen yet

  const creds = await providerCredentials(integration.provider);
  const accessToken = await ensureValidAccessToken(integration, providerLib, creds);
  if (!accessToken) return; // needsReconnect already recorded by ensureValidAccessToken

  const existing = await CalendarEventCache.findOne({
    where: { integrationId: integration.id, prismEventType: prismEvent.type, prismEventId: prismEvent.id },
  });

  let externalEvent;
  if (existing) {
    externalEvent = await providerLib.updateEvent(accessToken, integration.calendarId, existing.externalEventId, prismEvent);
  } else {
    externalEvent = await providerLib.createEvent(accessToken, integration.calendarId, prismEvent);
  }
  const externalId = externalEvent?.id;
  if (!externalId) return;

  const payload = {
    integrationId: integration.id,
    externalEventId: externalId,
    title: prismEvent.title,
    startDate: new Date(`${prismEvent.dueDate}T00:00:00Z`),
    endDate: null,
    isAllDay: true,
    prismEventType: prismEvent.type,
    prismEventId: prismEvent.id,
    lastFetched: new Date(),
  };
  if (existing) {
    await existing.update(payload);
  } else {
    await CalendarEventCache.create(payload);
  }
}

async function deleteFromOneIntegration(integration, type, itemId) {
  const providerLib = PROVIDER_LIBS[integration.provider];
  if (!providerLib) return;
  const existing = await CalendarEventCache.findOne({
    where: { integrationId: integration.id, prismEventType: type, prismEventId: itemId },
  });
  if (!existing) return;

  const creds = await providerCredentials(integration.provider);
  const accessToken = await ensureValidAccessToken(integration, providerLib, creds);
  if (accessToken && integration.calendarId) {
    await providerLib.deleteEvent(accessToken, integration.calendarId, existing.externalEventId);
  }
  await existing.destroy();
}

// ---- Public entry points called from ticket/project controllers ----

// Call after a ticket is created/updated with a non-null dueDate, or delete
// its pushed event if dueDate was just cleared. Fire-and-forget — never
// await this in a way that blocks the HTTP response.
async function syncTicketToExternalCalendars(ticketId) {
  try {
    const ticket = await Ticket.findByPk(ticketId, { attributes: ['id', 'title', 'dueDate', 'assigneeId'] });
    if (!ticket) return;
    if (!ticket.dueDate) {
      await pushDelete('ticket', ticket.id, ticket.assigneeId);
      return;
    }
    await pushUpsert({
      type: 'ticket', id: ticket.id, title: ticket.title, dueDate: ticket.dueDate,
      url: `/tickets/${ticket.id}`,
    }, ticket.assigneeId);
  } catch (err) {
    console.error('[calendar-push] syncTicketToExternalCalendars failed:', err.message);
  }
}

async function removeTicketFromExternalCalendars(ticketId, assigneeId) {
  try {
    await pushDelete('ticket', ticketId, assigneeId);
  } catch (err) {
    console.error('[calendar-push] removeTicketFromExternalCalendars failed:', err.message);
  }
}

async function syncProjectToExternalCalendars(projectId) {
  try {
    const project = await Project.findByPk(projectId, { attributes: ['id', 'name', 'projectCode', 'dueDate', 'assignedToUserId'] });
    if (!project) return;
    if (!project.dueDate) {
      await pushDelete('project', project.id, project.assignedToUserId);
      return;
    }
    await pushUpsert({
      type: 'project', id: project.id, title: `[${project.projectCode}] ${project.name}`, dueDate: project.dueDate,
      url: `/projects/${project.id}`,
    }, project.assignedToUserId);
  } catch (err) {
    console.error('[calendar-push] syncProjectToExternalCalendars failed:', err.message);
  }
}

async function removeProjectFromExternalCalendars(projectId, leadUserId) {
  try {
    await pushDelete('project', projectId, leadUserId);
  } catch (err) {
    console.error('[calendar-push] removeProjectFromExternalCalendars failed:', err.message);
  }
}

module.exports = {
  syncTicketToExternalCalendars, removeTicketFromExternalCalendars,
  syncProjectToExternalCalendars, removeProjectFromExternalCalendars,
};
