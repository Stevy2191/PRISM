// Completion rollup for the Projects module. Every "is this closed?" check
// here goes through ProjectStatuses.behaviorType (via statusBehavior.js) —
// never a hardcoded status name — so a custom/renamed status is honored
// immediately.
const { ProjectTask, ProjectSubtask } = require('../models');
const { getProjectStatusIdBehaviorMap } = require('./statusBehavior');

// A task with subtasks is complete when every subtask is closed-behavior;
// with none, it's complete when its own status is closed-behavior.
function isTaskComplete(task, subtasks, statusIdBehavior) {
  if (subtasks && subtasks.length > 0) {
    return subtasks.every((st) => statusIdBehavior.get(st.statusId) === 'closed');
  }
  return statusIdBehavior.get(task.statusId) === 'closed';
}

// null when there are no subtasks (nothing to show a bar for).
function subtaskCompletionPercent(subtasks, statusIdBehavior) {
  if (!subtasks || subtasks.length === 0) return null;
  const closed = subtasks.filter((st) => statusIdBehavior.get(st.statusId) === 'closed').length;
  return Math.round((closed / subtasks.length) * 100);
}

// Full rollup for one project: fetches every task (with its subtasks) and
// returns { percent, totalTasks, closedTasks, tasks: [{ task, isComplete,
// subtaskPercent }] }. Tasks are pre-sorted by position (drag order).
async function computeProjectCompletion(projectId) {
  const statusIdBehavior = await getProjectStatusIdBehaviorMap();
  const tasks = await ProjectTask.findAll({
    where: { projectId },
    include: [{ model: ProjectSubtask, as: 'subtasks', order: [['position', 'ASC']] }],
    order: [['position', 'ASC']],
  });

  let closedTasks = 0;
  const annotated = tasks.map((task) => {
    const subtasks = task.subtasks || [];
    const complete = isTaskComplete(task, subtasks, statusIdBehavior);
    if (complete) closedTasks += 1;
    return { task, isComplete: complete, subtaskPercent: subtaskCompletionPercent(subtasks, statusIdBehavior) };
  });

  const totalTasks = tasks.length;
  const percent = totalTasks ? Math.round((closedTasks / totalTasks) * 100) : 0;
  return { percent, totalTasks, closedTasks, tasks: annotated };
}

module.exports = { isTaskComplete, subtaskCompletionPercent, computeProjectCompletion };
