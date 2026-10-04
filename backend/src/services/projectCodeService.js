// Generates the department-prefixed project/task/subtask display IDs:
//   Project:  [DEPT_CODE]-P[NNNNN]        e.g. IT-P00001
//   Task:     [projectCode]-T[NN]          e.g. IT-P00001-T04
//   Subtask:  [taskCode]-S[NN]             e.g. IT-P00001-T04-S02
//
// Project numbers come from a real per-department counter (ProjectIdSequences)
// since they must never repeat even after deletions. Task/subtask numbers are
// derived from the current max among sibling codes instead of their own
// counter table, because those numbers can be freely renumbered later (see
// renumberTaskCode/renumberSubtaskCode) — a persistent counter would drift out
// of sync with manual renumbering, while "current max + 1" self-corrects.
const { Transaction } = require('sequelize');
const { Department, ProjectIdSequence, ProjectTask, ProjectSubtask } = require('../models');

const DEFAULT_PREFIX = 'DEPT';

function pad(n, width) {
  return String(n).padStart(width, '0');
}

// Atomically increments (or creates) the department's project-number counter.
// `transaction` is required, and must be READ COMMITTED: the row lock below
// only protects the increment when it's held for the whole
// transaction, and under REPEATABLE READ MariaDB 11's innodb_snapshot_isolation
// fails the locking write with error 1020 ("Record has changed since last
// read") whenever a concurrent create committed after this transaction's
// first read — so two simultaneous creates in one department would error
// instead of queueing.
async function nextProjectSequence(departmentId, transaction) {
  if (transaction?.options?.isolationLevel !== Transaction.ISOLATION_LEVELS.READ_COMMITTED) {
    throw new Error('nextProjectSequence needs a READ COMMITTED transaction');
  }
  // One atomic statement, rather than findOrCreate + SELECT ... FOR UPDATE:
  // two first-ever creates for a department would both miss the row and race
  // to insert it, and a duplicate-key check takes a *shared* lock, so several
  // creates holding shared locks and waiting to upgrade them deadlock. INSERT
  // ... ON DUPLICATE KEY UPDATE takes the row's exclusive lock straight away;
  // a concurrent create queues behind it until this transaction commits.
  await ProjectIdSequence.sequelize.query(
    'INSERT INTO `ProjectIdSequences` (`departmentId`, `lastSequence`, `createdAt`, `updatedAt`) '
    + 'VALUES (:departmentId, 1, NOW(), NOW()) '
    + 'ON DUPLICATE KEY UPDATE `lastSequence` = `lastSequence` + 1, `updatedAt` = NOW()',
    { replacements: { departmentId }, transaction }
  );
  // This transaction now holds the row's lock, so this reads its own increment.
  const row = await ProjectIdSequence.findOne({ where: { departmentId }, transaction });
  return row.lastSequence;
}

async function generateProjectCode(departmentId, transaction) {
  const department = departmentId ? await Department.findByPk(departmentId, { transaction }) : null;
  const prefix = department?.shortCode || DEFAULT_PREFIX;
  const seq = await nextProjectSequence(departmentId, transaction);
  return `${prefix}-P${pad(seq, 5)}`;
}

// Parses the trailing -T<digits> (or -S<digits>) off a code; returns 0 if
// the code is missing/malformed so a first task/subtask still gets number 1.
function parseTrailingNumber(code, suffixLetter) {
  if (!code) return 0;
  const match = new RegExp(`-${suffixLetter}(\\d+)$`).exec(code);
  return match ? parseInt(match[1], 10) : 0;
}

async function maxTaskNumber(projectId, transaction) {
  const tasks = await ProjectTask.findAll({ where: { projectId }, attributes: ['taskCode'], transaction });
  return tasks.reduce((max, t) => Math.max(max, parseTrailingNumber(t.taskCode, 'T')), 0);
}

async function maxSubtaskNumber(taskId, transaction) {
  const subtasks = await ProjectSubtask.findAll({ where: { taskId }, attributes: ['subtaskCode'], transaction });
  return subtasks.reduce((max, s) => Math.max(max, parseTrailingNumber(s.subtaskCode, 'S')), 0);
}

function formatTaskCode(projectCode, number) {
  return `${projectCode}-T${pad(number, 2)}`;
}

function formatSubtaskCode(taskCode, number) {
  return `${taskCode}-S${pad(number, 2)}`;
}

async function generateTaskCode(projectId, projectCode, transaction) {
  const next = (await maxTaskNumber(projectId, transaction)) + 1;
  return formatTaskCode(projectCode, next);
}

async function generateSubtaskCode(taskId, taskCode, transaction) {
  const next = (await maxSubtaskNumber(taskId, transaction)) + 1;
  return formatSubtaskCode(taskCode, next);
}

module.exports = {
  generateProjectCode,
  generateTaskCode,
  generateSubtaskCode,
  formatTaskCode,
  formatSubtaskCode,
};
