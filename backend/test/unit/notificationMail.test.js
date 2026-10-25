// Which notification types email, and the defaults (sub-project 6, task 4).
const { EMAIL_EVENTS, DEFAULT_EMAIL_PREFS, effectiveEmailPref } = require('../../src/services/email/notificationMail');
const { CATALOG } = require('../../src/services/email/catalog');

describe('project notification emails', () => {
  it('task_unblocked email default off', () => {
    expect(EMAIL_EVENTS.task_unblocked).toBe('staff_task_unblocked');
    expect(DEFAULT_EMAIL_PREFS.task_unblocked).toBe(false);
    expect(effectiveEmailPref(null, 'task_unblocked', null)).toBe(false);
    expect(CATALOG.staff_task_unblocked.defaultEnabled).toBe(true); // the per-user switch decides, not the template
  });

  it('budget_* and task_added email default on', () => {
    expect(EMAIL_EVENTS).toMatchObject({
      budget_warning: 'staff_budget_warning', budget_reached: 'staff_budget_reached', task_added: 'staff_task_added',
    });
    for (const type of ['budget_warning', 'budget_reached', 'task_added']) {
      expect(effectiveEmailPref(null, type, null)).toBe(true);
    }
  });

  it('a person or the admin default can override', () => {
    expect(effectiveEmailPref({ notificationEmailPrefs: { task_unblocked: true } }, 'task_unblocked', null)).toBe(true);
    expect(effectiveEmailPref(null, 'budget_warning', { budget_warning: false })).toBe(false);
  });

  it('every project template is a staff template with the project placeholders', () => {
    for (const key of ['staff_task_added', 'staff_task_unblocked', 'staff_budget_warning', 'staff_budget_reached']) {
      expect(CATALOG[key].audience).toBe('staff');
      expect(CATALOG[key].placeholders.map((p) => p.name)).toEqual(expect.arrayContaining(['project.name', 'project.url', 'notification.message']));
    }
  });
});
