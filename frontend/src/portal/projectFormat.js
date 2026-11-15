// CN: helpers for the portal's project pages.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-01-30' → 'Jan 30'.
export function shortDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

export const statusTone = (behavior) => ({ closed: 'neutral', on_hold: 'waiting' }[behavior] || 'info');

// "Human Resources · In progress · 40% · due Jan 30"
export function projectLine(project, companyName) {
  const forName = project.forDepartment ? project.forDepartment.name : (companyName ? `All of ${companyName}` : 'The whole company');
  const bits = [forName];
  if (project.statusBehavior === 'closed') {
    bits.push(project.completedAt ? `Completed ${shortDay(project.completedAt)}` : 'Completed');
  } else {
    bits.push(`${project.progress.percent}%`);
    if (project.dueDate) bits.push(`due ${shortDay(project.dueDate)}`);
  }
  return bits.join(' · ');
}

// " · Nov 18 to Dec 20 · in progress"
export function stepLine(step) {
  const when = step.kind === 'milestone'
    ? shortDay(step.dueDate || step.startDate)
    : [step.startDate && shortDay(step.startDate), step.dueDate && shortDay(step.dueDate)].filter(Boolean).join(' to ');
  const state = { done: 'done', active: 'in progress' }[step.state];
  return [when, state].filter(Boolean).map((x) => ` · ${x}`).join('');
}
