// Loads all models, registers them on the shared Sequelize instance,
// and wires up associations. Import { ...models } from here everywhere.
const sequelize = require('../config/database');

const User = require('./User')(sequelize);
const Department = require('./Department')(sequelize);
const Project = require('./Project')(sequelize);
const ProjectMember = require('./ProjectMember')(sequelize);
const ProjectTask = require('./ProjectTask')(sequelize);
const ProjectSubtask = require('./ProjectSubtask')(sequelize);
const ProjectTimeEntry = require('./ProjectTimeEntry')(sequelize);
const ProjectExpense = require('./ProjectExpense')(sequelize);
const ProjectMaterial = require('./ProjectMaterial')(sequelize);
const ProjectFile = require('./ProjectFile')(sequelize);
const ProjectActivity = require('./ProjectActivity')(sequelize);
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
const TicketStatus = require('./TicketStatus')(sequelize);
const ProjectStatus = require('./ProjectStatus')(sequelize);
const Role = require('./Role')(sequelize);
const Permission = require('./Permission')(sequelize);
const RolePermission = require('./RolePermission')(sequelize);
const UserRole = require('./UserRole')(sequelize);
const UserPermissionOverride = require('./UserPermissionOverride')(sequelize);
const SystemAuditLog = require('./SystemAuditLog')(sequelize);
const ProjectIdSequence = require('./ProjectIdSequence')(sequelize);
const Contact = require('./Contact')(sequelize);
const ContactActivity = require('./ContactActivity')(sequelize);
const WorkflowRule = require('./WorkflowRule')(sequelize);
const WorkflowCondition = require('./WorkflowCondition')(sequelize);
const WorkflowAction = require('./WorkflowAction')(sequelize);
const WorkflowRuleLog = require('./WorkflowRuleLog')(sequelize);
const SavedReportView = require('./SavedReportView')(sequelize);
const SavedCustomReport = require('./SavedCustomReport')(sequelize);
const UserCalendarIntegration = require('./UserCalendarIntegration')(sequelize);
const CalendarEventCache = require('./CalendarEventCache')(sequelize);
const DashboardLayout = require('./DashboardLayout')(sequelize);
const AdSyncLog = require('./AdSyncLog')(sequelize);
const AdGroupMapping = require('./AdGroupMapping')(sequelize);

const db = {
  sequelize,
  User,
  Department,
  Contact,
  ContactActivity,
  WorkflowRule,
  WorkflowCondition,
  DashboardLayout,
  AdSyncLog,
  AdGroupMapping,
  WorkflowAction,
  WorkflowRuleLog,
  SavedReportView,
  SavedCustomReport,
  UserCalendarIntegration,
  CalendarEventCache,
  Project,
  ProjectMember,
  ProjectTask,
  ProjectSubtask,
  ProjectTimeEntry,
  ProjectExpense,
  ProjectMaterial,
  ProjectFile,
  ProjectActivity,
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
  TicketStatus,
  ProjectStatus,
  Role,
  Permission,
  RolePermission,
  UserRole,
  UserPermissionOverride,
  SystemAuditLog,
  ProjectIdSequence,
};

// ---- Associations ----

// Department <-> User
Department.hasMany(User, { foreignKey: 'departmentId', as: 'members' });
User.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Department <-> Project (two distinct roles: who does the work vs. who
// it's for — see Project.js for the field-level explanation)
Department.hasMany(Project, { foreignKey: 'ownerDepartmentId', as: 'ownedProjects' });
Project.belongsTo(Department, { foreignKey: 'ownerDepartmentId', as: 'ownerDepartment' });
Department.hasMany(Project, { foreignKey: 'forDepartmentId', as: 'projectsFor' });
Project.belongsTo(Department, { foreignKey: 'forDepartmentId', as: 'forDepartment' });

// Project lead + team + creator
Project.belongsTo(User, { foreignKey: 'assignedToUserId', as: 'lead' });
User.hasMany(Project, { foreignKey: 'assignedToUserId', as: 'ledProjects' });
Project.belongsTo(Team, { foreignKey: 'teamId', as: 'team' });
Project.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Project <-> ProjectMember
Project.hasMany(ProjectMember, { foreignKey: 'projectId', as: 'members', onDelete: 'CASCADE' });
ProjectMember.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(ProjectMember, { foreignKey: 'userId', as: 'projectMemberships' });

// Project <-> ProjectTask <-> ProjectSubtask
Project.hasMany(ProjectTask, { foreignKey: 'projectId', as: 'tasks', onDelete: 'CASCADE' });
ProjectTask.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectTask.belongsTo(User, { foreignKey: 'assignedToUserId', as: 'assignee' });
ProjectTask.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
ProjectTask.belongsTo(ProjectStatus, { foreignKey: 'statusId', as: 'status' });
ProjectTask.belongsTo(Ticket, { foreignKey: 'linkedTicketId', as: 'linkedTicket' });
ProjectTask.hasMany(ProjectSubtask, { foreignKey: 'taskId', as: 'subtasks', onDelete: 'CASCADE' });
ProjectSubtask.belongsTo(ProjectTask, { foreignKey: 'taskId', as: 'task' });
ProjectSubtask.belongsTo(User, { foreignKey: 'assignedToUserId', as: 'assignee' });
ProjectSubtask.belongsTo(ProjectStatus, { foreignKey: 'statusId', as: 'status' });

// Project time entries / expenses / materials / files / activity
Project.hasMany(ProjectTimeEntry, { foreignKey: 'projectId', as: 'timeEntries', onDelete: 'CASCADE' });
ProjectTimeEntry.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectTimeEntry.belongsTo(ProjectTask, { foreignKey: 'taskId', as: 'task' });
ProjectTimeEntry.belongsTo(User, { foreignKey: 'userId', as: 'user' });
ProjectTimeEntry.belongsTo(User, { foreignKey: 'loggedForUserId', as: 'loggedFor' });

Project.hasMany(ProjectExpense, { foreignKey: 'projectId', as: 'expenses', onDelete: 'CASCADE' });
ProjectExpense.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectExpense.belongsTo(ProjectTask, { foreignKey: 'taskId', as: 'task' });
ProjectExpense.belongsTo(User, { foreignKey: 'loggedBy', as: 'loggedByUser' });

Project.hasMany(ProjectMaterial, { foreignKey: 'projectId', as: 'materials', onDelete: 'CASCADE' });
ProjectMaterial.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectMaterial.belongsTo(ProjectTask, { foreignKey: 'taskId', as: 'task' });
ProjectMaterial.belongsTo(User, { foreignKey: 'addedBy', as: 'addedByUser' });

Project.hasMany(ProjectFile, { foreignKey: 'projectId', as: 'files', onDelete: 'CASCADE' });
ProjectFile.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectFile.belongsTo(ProjectTask, { foreignKey: 'taskId', as: 'task' });
ProjectFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploadedByUser' });

Project.hasMany(ProjectActivity, { foreignKey: 'projectId', as: 'activity', onDelete: 'CASCADE' });
ProjectActivity.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
ProjectActivity.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Project <-> Ticket
Project.hasMany(Ticket, { foreignKey: 'projectId', as: 'tickets' });
Ticket.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Department <-> Ticket
Department.hasMany(Ticket, { foreignKey: 'departmentId', as: 'tickets' });
Ticket.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Ticket assignee / contact (customer). requesterId/requester is kept as a
// legacy association for historical rows only — new code uses contactId.
Ticket.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee' });
Ticket.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });
Ticket.belongsTo(User, { foreignKey: 'resolutionUpdatedBy', as: 'resolutionUpdatedByUser' });
Ticket.belongsTo(Contact, { foreignKey: 'contactId', as: 'contact' });
User.hasMany(Ticket, { foreignKey: 'assigneeId', as: 'assignedTickets' });
User.hasMany(Ticket, { foreignKey: 'requesterId', as: 'requestedTickets' });
Contact.hasMany(Ticket, { foreignKey: 'contactId', as: 'tickets' });

// Contact <-> Department / User (assignedTo, createdBy)
Contact.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
Department.hasMany(Contact, { foreignKey: 'departmentId', as: 'contacts' });
Contact.belongsTo(User, { foreignKey: 'assignedTo', as: 'assignedToUser' });
Contact.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });

// AD group -> department mapping (contacts sync)
AdGroupMapping.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
Department.hasMany(AdGroupMapping, { foreignKey: 'departmentId', as: 'adGroupMappings' });

// Contact <-> ContactActivity
Contact.hasMany(ContactActivity, { foreignKey: 'contactId', as: 'activity', onDelete: 'CASCADE' });
ContactActivity.belongsTo(Contact, { foreignKey: 'contactId', as: 'contact' });
ContactActivity.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Workflow rules
WorkflowRule.hasMany(WorkflowCondition, { foreignKey: 'ruleId', as: 'conditions', onDelete: 'CASCADE' });
WorkflowCondition.belongsTo(WorkflowRule, { foreignKey: 'ruleId', as: 'rule' });
WorkflowRule.hasMany(WorkflowAction, { foreignKey: 'ruleId', as: 'actions', onDelete: 'CASCADE' });
WorkflowAction.belongsTo(WorkflowRule, { foreignKey: 'ruleId', as: 'rule' });
WorkflowRule.hasMany(WorkflowRuleLog, { foreignKey: 'ruleId', as: 'logs', onDelete: 'CASCADE' });
WorkflowRuleLog.belongsTo(WorkflowRule, { foreignKey: 'ruleId', as: 'rule' });
WorkflowRuleLog.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
WorkflowRule.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Ticket.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });

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
BusinessHours.belongsTo(HolidayList, { foreignKey: 'holidayListId', as: 'holidayList' });
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
CustomField.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
CustomField.hasMany(TicketFieldValue, { foreignKey: 'fieldId', as: 'values', onDelete: 'CASCADE' });
TicketFieldValue.belongsTo(CustomField, { foreignKey: 'fieldId', as: 'field' });
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
User.hasMany(SavedReportView, { foreignKey: 'userId', as: 'savedReportViews', onDelete: 'CASCADE' });
SavedReportView.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(SavedCustomReport, { foreignKey: 'userId', as: 'savedCustomReports', onDelete: 'CASCADE' });
SavedCustomReport.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(DashboardLayout, { foreignKey: 'userId', as: 'dashboardLayout', onDelete: 'CASCADE' });
DashboardLayout.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(UserCalendarIntegration, { foreignKey: 'userId', as: 'calendarIntegrations', onDelete: 'CASCADE' });
UserCalendarIntegration.belongsTo(User, { foreignKey: 'userId', as: 'user' });
UserCalendarIntegration.hasMany(CalendarEventCache, { foreignKey: 'integrationId', as: 'cachedEvents', onDelete: 'CASCADE' });
CalendarEventCache.belongsTo(UserCalendarIntegration, { foreignKey: 'integrationId', as: 'integration' });

// Ticket watchers
Ticket.hasMany(TicketWatcher, { foreignKey: 'ticketId', as: 'watchers', onDelete: 'CASCADE' });
TicketWatcher.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });
TicketWatcher.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(TicketWatcher, { foreignKey: 'userId', as: 'watching', onDelete: 'CASCADE' });

// Roles & permissions
Department.hasMany(Role, { foreignKey: 'departmentId', as: 'roles' });
Role.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

// Department's default role for newly added users.
Department.belongsTo(Role, { foreignKey: 'defaultRoleId', as: 'defaultRole' });

Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', otherKey: 'permissionId', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', otherKey: 'roleId', as: 'roles' });
Role.hasMany(RolePermission, { foreignKey: 'roleId', as: 'rolePermissions', onDelete: 'CASCADE' });
RolePermission.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
RolePermission.belongsTo(Permission, { foreignKey: 'permissionId', as: 'permission' });

User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', otherKey: 'roleId', as: 'roles' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId', otherKey: 'userId', as: 'users' });
User.hasMany(UserRole, { foreignKey: 'userId', as: 'userRoles', onDelete: 'CASCADE' });
UserRole.belongsTo(User, { foreignKey: 'userId', as: 'user' });
UserRole.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
UserRole.belongsTo(User, { foreignKey: 'assignedBy', as: 'assignedByUser' });
UserRole.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

User.belongsTo(Role, { foreignKey: 'roleId', as: 'primaryRole' });

User.hasMany(UserPermissionOverride, { foreignKey: 'userId', as: 'permissionOverrides', onDelete: 'CASCADE' });
UserPermissionOverride.belongsTo(User, { foreignKey: 'userId', as: 'user' });
UserPermissionOverride.belongsTo(User, { foreignKey: 'grantedBy', as: 'grantedByUser' });

// System audit log (permission-change trail)
SystemAuditLog.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor' });
SystemAuditLog.belongsTo(User, { foreignKey: 'targetUserId', as: 'target' });

// Per-department project-ID sequence
Department.hasOne(ProjectIdSequence, { foreignKey: 'departmentId', as: 'projectIdSequence' });
ProjectIdSequence.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

module.exports = db;
