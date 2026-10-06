// Task codes. Project tasks: IT-P00012-T04; ticket tasks: #00012-T04.
// Subtasks append -S02 to their task's code. A new number is "current max + 1"
// among siblings, so renumbering (1–99) never drifts out of step.
const { Task } = require('../../models');

const pad2 = (n) => String(n).padStart(2, '0');

function parentPrefix(parent) {
  return parent.kind === 'ticket' ? `#${String(parent.record.id).padStart(5, '0')}` : parent.record.projectCode;
}

function formatTaskCode(parent, number) {
  return `${parentPrefix(parent)}-T${pad2(number)}`;
}

function formatSubtaskCode(taskCode, number) {
  return `${taskCode}-S${pad2(number)}`;
}

function trailingNumber(code, letter) {
  const match = code ? new RegExp(`-${letter}(\\d+)$`).exec(code) : null;
  return match ? parseInt(match[1], 10) : 0;
}

async function nextCode(parent, parentTask, transaction) {
  const where = parentTask ? { parentTaskId: parentTask.id } : { ...parent.where, parentTaskId: null };
  const siblings = await Task.findAll({ where, attributes: ['code'], transaction });
  const letter = parentTask ? 'S' : 'T';
  const next = siblings.reduce((max, s) => Math.max(max, trailingNumber(s.code, letter)), 0) + 1;
  return parentTask ? formatSubtaskCode(parentTask.code, next) : formatTaskCode(parent, next);
}

module.exports = { formatTaskCode, formatSubtaskCode, trailingNumber, nextCode, pad2 };
