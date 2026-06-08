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

module.exports = db;
