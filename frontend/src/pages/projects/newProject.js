// Pure helpers for the New project screen (sub-project 6). Dates are
// 'YYYY-MM-DD' strings and are only compared and formatted, never added to.
import { dateRange, shortDate, weekdayDate } from './detail/taskFilters.js';

const sameId = (a, b) => String(a) === String(b);

// The /project-templates/:id/preview answer as the "What you'll get" panel
// shows it: per phase its dates, task count, hours and milestones.
export function previewSummary(plan) {
  const tasks = plan?.tasks || [];
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const phaseOf = (t) => (t.parentId != null ? byId.get(String(t.parentId))?.phaseId : t.phaseId);
  const group = (name, id, list) => {
    const dated = list.filter((t) => t.startDate);
    const start = dated.reduce((min, t) => (min == null || t.startDate < min ? t.startDate : min), null);
    const end = dated.reduce((max, t) => (max == null || t.dueDate > max ? t.dueDate : max), null);
    return {
      id,
      name,
      range: start ? dateRange(start, end) : '',
      taskCount: list.filter((t) => !t.isMilestone).length,
      minutes: list.reduce((sum, t) => sum + (t.isMilestone ? 0 : t.estimateMinutes || 0), 0),
      milestones: list.filter((t) => t.isMilestone).map((t) => ({ id: t.id, title: t.title, date: weekdayDate(t.startDate) })),
    };
  };
  const phases = (plan?.phases || []).map((p) => group(p.name, p.id, tasks.filter((t) => phaseOf(t) != null && sameId(phaseOf(t), p.id))));
  const loose = tasks.filter((t) => phaseOf(t) == null || !(plan.phases || []).some((p) => sameId(p.id, phaseOf(t))));
  if (loose.length) phases.unshift(group('No phase', 'none', loose));
  return {
    phases,
    taskCount: tasks.filter((t) => !t.isMilestone).length,
    milestoneCount: tasks.filter((t) => t.isMilestone).length,
    linkCount: (plan?.dependencies || []).length,
    minutes: tasks.reduce((sum, t) => sum + (t.isMilestone ? 0 : t.estimateMinutes || 0), 0),
    finishDate: plan?.finishDate || '',
  };
}

// The POST /projects body. `budget` is minutes, null (no budget) or
// undefined (leave to the template).
export function createBody({
  form, tags, origin, copyId, budget, memberIds,
}) {
  const body = {
    name: form.name.trim(),
    ownerDepartmentId: form.ownerDepartmentId,
    forDepartmentId: form.forDepartmentId || undefined,
    companyId: form.companyId || undefined,
    assignedToUserId: form.assignedToUserId || null,
    tags, // always sent: [] means no tags, absent means "take the template's"
    memberIds,
  };
  if (form.startDate) body.startDate = form.startDate;
  if (origin === 'template') body.templateId = form.templateId;
  if (origin === 'copy') body.copyFromProjectId = copyId;
  if (origin !== 'blank' && form.finishDate) body.finishDate = form.finishDate;
  if (origin === 'blank' && form.finishDate) body.dueDate = form.finishDate;
  if (budget !== undefined) body.hourBudgetMinutes = budget;
  return body;
}

// Why the plan ends later than the finish date asked for (a task that waits on
// another is pushed past it), or '' when it ends on time.
export function finishNote(plan, requested) {
  const finish = plan?.finishDate;
  if (!finish || !requested || finish <= requested) return '';
  const last = (plan.tasks || []).filter((t) => t.parentId == null && t.dueDate === finish && t.startDate)[0];
  const waits = (plan.dependencies || []).filter((d) => last && sameId(d.successorId, last.id));
  const before = waits.map((d) => (plan.tasks || []).find((t) => sameId(t.id, d.predecessorId))).filter(Boolean).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))[0];
  const because = last && before ? `${last.title} waits on ${before.title}` : 'some tasks wait on others';
  return `Finishes ${shortDate(finish)} because ${because}`;
}
