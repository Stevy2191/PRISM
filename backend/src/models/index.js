// Loads all models, registers them on the shared Sequelize instance,
// and wires up associations. Import { ...models } from here everywhere.
const sequelize = require('../config/database');

const User = require('./User')(sequelize);
const Department = require('./Department')(sequelize);
const Project = require('./Project')(sequelize);
const Milestone = require('./Milestone')(sequelize);
const Ticket = require('./Ticket')(sequelize);
const Comment = require('./Comment')(sequelize);
const Attachment = require('./Attachment')(sequelize);
const TimeEntry = require('./TimeEntry')(sequelize);
const ApiKey = require('./ApiKey')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const Blueprint = require('./Blueprint')(sequelize);
const TicketRelation = require('./TicketRelation')(sequelize);
const SystemSettings = require('./SystemSettings')(sequelize);
const BusinessHours = require('./BusinessHours')(sequelize);
const HolidayList = require('./HolidayList')(sequelize);
const Holiday = require('./Holiday')(sequelize);
const CsatResponse = require('./CsatResponse')(sequelize);
const Team = require('./Team')(sequelize);
const TeamMember = require('./TeamMember')(sequelize);
const ModuleVisibility = require('./ModuleVisibility')(sequelize);
const CustomField = require('./CustomField')(sequelize);
const TicketFieldValue = require('./TicketFieldValue')(sequelize);
const ActiveTimer = require('./ActiveTimer')(sequelize);
const Notification = require('./Notification')(sequelize);
const SavedFilter = require('./SavedFilter')(sequelize);
const TicketWatcher = require('./TicketWatcher')(sequelize);
const TicketTask = require('./TicketTask')(sequelize);
const TicketActivity = require('./TicketActivity')(sequelize);

const db = {
  sequelize,
  User,
  Department,
  Project,
  Milestone,
  Ticket,
  Comment,
  Attachment,
  TimeEntry,
  ApiKey,
  AuditLog,
  Blueprint,
  TicketRelation,
  SystemSettings,
  BusinessHours,
  HolidayList,
  Holiday,
  CsatResponse,
  Team,
  TeamMember,
  ModuleVisibility,
  CustomField,
  TicketFieldValue,
  ActiveTimer,
  Notification,
  SavedFilter,
  TicketWatcher,
  TicketTask,
  TicketActivity,
};

// ---- Associations ----

// Department <-> User
Department.hasMany(User, { foreignKey: 'departmentId', as: 'members' });
User.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Department <-> Project
Department.hasMany(Project, { foreignKey: 'departmentId', as: 'projects' });
Project.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Project owner
Project.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
User.hasMany(Project, { foreignKey: 'ownerId', as: 'ownedProjects' });

// Project <-> Milestone
Project.hasMany(Milestone, { foreignKey: 'projectId', as: 'milestones', onDelete: 'CASCADE' });
Milestone.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Project <-> Ticket
Project.hasMany(Ticket, { foreignKey: 'projectId', as: 'tickets' });
Ticket.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Department <-> Ticket
Department.hasMany(Ticket, { foreignKey: 'departmentId', as: 'tickets' });
Ticket.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Ticket assignee / requester
Ticket.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });
Ticket.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });
User.hasMany(Ticket, { foreignKey: 'assigneeId', as: 'assignedTickets' });
User.hasMany(Ticket, { foreignKey: 'requesterId', as: 'requestedTickets' });

// Ticket <-> Comment
Ticket.hasMany(Comment, { foreignKey: 'ticketId', as: 'comments', onDelete: 'CASCADE' });
Comment.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
Comment.belongsTo(User, { foreignKey: 'authorId', as: 'author' });
User.hasMany(Comment, { foreignKey: 'authorId', as: 'comments' });

// Ticket <-> Attachment
Ticket.hasMany(Attachment, { foreignKey: 'ticketId', as: 'attachments', onDelete: 'CASCADE' });
Attachment.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
Attachment.belongsTo(User, { foreignKey: 'uploadedById', as: 'uploadedBy' });

// Ticket <-> TimeEntry
Ticket.hasMany(TimeEntry, { foreignKey: 'ticketId', as: 'timeEntries', onDelete: 'CASCADE' });
TimeEntry.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TimeEntry.belongsTo(User, { foreignKey: 'userId', as: 'user' });
TimeEntry.belongsTo(User, { foreignKey: 'loggedById', as: 'loggedBy' });
User.hasMany(TimeEntry, { foreignKey: 'userId', as: 'timeEntries' });

// Project <-> TimeEntry (project-level time)
Project.hasMany(TimeEntry, { foreignKey: 'projectId', as: 'timeEntries', onDelete: 'CASCADE' });
TimeEntry.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Blueprint
Blueprint.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });
Blueprint.belongsTo(Department, { foreignKey: 'defaultDepartmentId', as: 'defaultDepartment' });
Ticket.belongsTo(Blueprint, { foreignKey: 'blueprintId', as: 'blueprint' });

// Ticket relations (self-referential many-to-many via TicketRelation)
Ticket.hasMany(TicketRelation, { foreignKey: 'ticketId', as: 'relations', onDelete: 'CASCADE' });
Ticket.hasMany(TicketRelation, { foreignKey: 'relatedTicketId', as: 'inverseRelations', onDelete: 'CASCADE' });
TicketRelation.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TicketRelation.belongsTo(Ticket, { foreignKey: 'relatedTicketId', as: 'relatedTicket' });

// User <-> ApiKey
User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys', onDelete: 'CASCADE' });
ApiKey.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> AuditLog
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Teams
Department.hasMany(Team, { foreignKey: 'departmentId', as: 'teams' });
Team.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
Team.belongsToMany(User, { through: TeamMember, foreignKey: 'teamId', otherKey: 'userId', as: 'members' });
User.belongsToMany(Team, { through: TeamMember, foreignKey: 'userId', otherKey: 'teamId', as: 'teams' });
Team.hasMany(TeamMember, { foreignKey: 'teamId', as: 'memberships', onDelete: 'CASCADE' });
TeamMember.belongsTo(Team, { foreignKey: 'teamId', as: 'team' });
TeamMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Ticket.belongsTo(Team, { foreignKey: 'teamId', as: 'team' });
Team.hasMany(Ticket, { foreignKey: 'teamId', as: 'tickets' });

// Business hours / holidays
BusinessHours.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
HolidayList.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
HolidayList.hasMany(Holiday, { foreignKey: 'holidayListId', as: 'holidays', onDelete: 'CASCADE' });
Holiday.belongsTo(HolidayList, { foreignKey: 'holidayListId', as: 'holidayList' });

// CSAT
Ticket.hasOne(CsatResponse, { foreignKey: 'ticketId', as: 'csat', onDelete: 'CASCADE' });
CsatResponse.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
CsatResponse.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// System settings
SystemSettings.belongsTo(User, { foreignKey: 'updatedById', as: 'updatedBy' });

// Custom fields (Layouts & Fields)
CustomField.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
CustomField.hasMany(TicketFieldValue, { foreignKey: 'customFieldId', as: 'values', onDelete: 'CASCADE' });
TicketFieldValue.belongsTo(CustomField, { foreignKey: 'customFieldId', as: 'field' });
Ticket.hasMany(TicketFieldValue, { foreignKey: 'ticketId', as: 'fieldValues', onDelete: 'CASCADE' });
TicketFieldValue.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });

// Active timer (one per user)
User.hasOne(ActiveTimer, { foreignKey: 'userId', as: 'activeTimer', onDelete: 'CASCADE' });
ActiveTimer.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Ticket tasks (checklist)
Ticket.hasMany(TicketTask, { foreignKey: 'ticketId', as: 'tasks', onDelete: 'CASCADE' });
TicketTask.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TicketTask.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });

// Ticket activity (per-ticket timeline)
Ticket.hasMany(TicketActivity, { foreignKey: 'ticketId', as: 'activity', onDelete: 'CASCADE' });
TicketActivity.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TicketActivity.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Notifications
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Ticket.hasMany(Notification, { foreignKey: 'ticketId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });

// Saved ticket filters
User.hasMany(SavedFilter, { foreignKey: 'userId', as: 'savedFilters', onDelete: 'CASCADE' });
SavedFilter.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Ticket watchers
Ticket.hasMany(TicketWatcher, { foreignKey: 'ticketId', as: 'watchers', onDelete: 'CASCADE' });
TicketWatcher.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TicketWatcher.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(TicketWatcher, { foreignKey: 'userId', as: 'watching', onDelete: 'CASCADE' });

module.exports = db;
