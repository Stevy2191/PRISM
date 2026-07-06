'use strict';

/**
 * Department-prefixed project/task/subtask IDs (e.g. IT-P00001, IT-P00001-T01,
 * IT-P00001-T01-S01) plus freeform project tags.
 *
 * `ProjectIdSequences` tracks one counter per department (project numbering
 * is per-department, starting at 1). Task/subtask numbering is NOT tracked
 * in a sequence table — it's derived from the current max number among
 * sibling task/subtask codes (see services/projectCodeService.js), since
 * those numbers can be freely renumbered later (Prompt: "rename/renumber
 * task ID") and a simple incrementing counter would fight with that.
 *
 * Existing rows are backfilled here in creation order (by id) so every
 * project/task/subtask gets a code immediately — codes are assigned once at
 * creation time using whatever the department's shortCode was then (or
 * "DEPT" if unset); they are not retroactively rewritten if the department's
 * shortCode changes later.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const {
      INTEGER, STRING, DATE,
    } = Sequelize;
    const JSONType = Sequelize.JSON; // avoid destructuring `JSON` — shadows the global
    const { QueryTypes } = Sequelize;
    const q = (sql, opts) => queryInterface.sequelize.query(sql, opts);
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    // ---- ProjectIdSequences ----
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('ProjectIdSequences')) {
      await queryInterface.createTable('ProjectIdSequences', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        departmentId: { type: INTEGER, allowNull: false, unique: true },
        lastSequence: { type: INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }

    // ---- New columns ----
    const projectCols = await queryInterface.describeTable('Projects');
    if (!projectCols.projectCode) {
      await queryInterface.addColumn('Projects', 'projectCode', { type: STRING(30), allowNull: true });
      await queryInterface.addIndex('Projects', ['projectCode'], { unique: true, name: 'projects_project_code_unique' });
    }
    if (!projectCols.tags) {
      await queryInterface.addColumn('Projects', 'tags', { type: JSONType, allowNull: true });
    }

    const taskCols = await queryInterface.describeTable('ProjectTasks');
    if (!taskCols.taskCode) {
      await queryInterface.addColumn('ProjectTasks', 'taskCode', { type: STRING(40), allowNull: true });
      await queryInterface.addIndex('ProjectTasks', ['taskCode'], { unique: true, name: 'project_tasks_task_code_unique' });
    }

    const subtaskCols = await queryInterface.describeTable('ProjectSubtasks');
    if (!subtaskCols.subtaskCode) {
      await queryInterface.addColumn('ProjectSubtasks', 'subtaskCode', { type: STRING(50), allowNull: true });
      await queryInterface.addIndex('ProjectSubtasks', ['subtaskCode'], { unique: true, name: 'project_subtasks_subtask_code_unique' });
    }

    // ---- Backfill existing rows ----
    const departments = await q('SELECT `id`, `shortCode` FROM `Departments`', { type: QueryTypes.SELECT });
    const shortCodeByDept = new Map(departments.map((d) => [d.id, d.shortCode]));

    const projects = await q('SELECT `id`, `ownerDepartmentId` FROM `Projects` ORDER BY `id` ASC', { type: QueryTypes.SELECT });
    const seqByDept = new Map();
    const projectCodeById = new Map();

    for (const project of projects) {
      const deptKey = project.ownerDepartmentId;
      const nextSeq = (seqByDept.get(deptKey) || 0) + 1;
      seqByDept.set(deptKey, nextSeq);
      const prefix = (deptKey && shortCodeByDept.get(deptKey)) || 'DEPT';
      const code = `${prefix}-P${String(nextSeq).padStart(5, '0')}`;
      projectCodeById.set(project.id, code);
      // eslint-disable-next-line no-await-in-loop
      await q('UPDATE `Projects` SET `projectCode` = :code WHERE `id` = :id', { replacements: { code, id: project.id } });
    }

    for (const [deptKey, count] of seqByDept.entries()) {
      if (deptKey == null) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.bulkInsert('ProjectIdSequences', [{ departmentId: deptKey, lastSequence: count, createdAt: new Date(), updatedAt: new Date() }]);
    }

    const tasks = await q('SELECT `id`, `projectId` FROM `ProjectTasks` ORDER BY `projectId` ASC, `id` ASC', { type: QueryTypes.SELECT });
    const seqByProject = new Map();
    const taskCodeById = new Map();
    for (const task of tasks) {
      const nextSeq = (seqByProject.get(task.projectId) || 0) + 1;
      seqByProject.set(task.projectId, nextSeq);
      const projectCode = projectCodeById.get(task.projectId) || 'DEPT-P00000';
      const code = `${projectCode}-T${String(nextSeq).padStart(2, '0')}`;
      taskCodeById.set(task.id, code);
      // eslint-disable-next-line no-await-in-loop
      await q('UPDATE `ProjectTasks` SET `taskCode` = :code WHERE `id` = :id', { replacements: { code, id: task.id } });
    }

    const subtasks = await q('SELECT `id`, `taskId` FROM `ProjectSubtasks` ORDER BY `taskId` ASC, `id` ASC', { type: QueryTypes.SELECT });
    const seqByTask = new Map();
    for (const subtask of subtasks) {
      const nextSeq = (seqByTask.get(subtask.taskId) || 0) + 1;
      seqByTask.set(subtask.taskId, nextSeq);
      const taskCode = taskCodeById.get(subtask.taskId) || 'DEPT-P00000-T00';
      const code = `${taskCode}-S${String(nextSeq).padStart(2, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      await q('UPDATE `ProjectSubtasks` SET `subtaskCode` = :code WHERE `id` = :id', { replacements: { code, id: subtask.id } });
    }

    return undefined;
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    const subtaskCols = await queryInterface.describeTable('ProjectSubtasks');
    if (subtaskCols.subtaskCode) await q('ALTER TABLE `ProjectSubtasks` DROP COLUMN `subtaskCode`');

    const taskCols = await queryInterface.describeTable('ProjectTasks');
    if (taskCols.taskCode) await q('ALTER TABLE `ProjectTasks` DROP COLUMN `taskCode`');

    const projectCols = await queryInterface.describeTable('Projects');
    if (projectCols.tags) await q('ALTER TABLE `Projects` DROP COLUMN `tags`');
    if (projectCols.projectCode) await q('ALTER TABLE `Projects` DROP COLUMN `projectCode`');

    await q('DROP TABLE IF EXISTS `ProjectIdSequences`');
    return undefined;
  },
};
