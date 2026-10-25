# Project management, full feature (sub-project 6) — design

> Status: **draft for approval** (2026-10-25). Plan:
> `docs/superpowers/plans/2026-10-25-project-management.md`.
> Mockups (look A, all project screens): https://claude.ai/artifact/NXd5ZYb4P98kk8VjxHwx3H

## Why

The user's words: "The one reason why projects don't get logged or tracked is
the software is too cumbersome and hard to navigate. I want this to be easy
to use, captures all the information needed."

So the bar is: **logging a task, a date or an hour has to take one click or
one line of typing**, and the project page has to answer "where are we?" at
a glance. Every feature below is judged against that. A feature that works
but adds a form, a modal or a page to the everyday path is a failure.

This sub-project also starts PRISM's new look ("look A, Clear desk"). 6
builds the look's foundation and every project and workload screen in it.
The rest of PRISM gets the new colours and font automatically, and is
restyled properly in a new sub-project **6b** before `v0.4.0`.

## Goals

- Phases and milestones, so a project reads as stages with dates.
- Finish-to-start dependencies, with "waiting on" shown and dates that can
  follow when a task moves.
- A timeline (Gantt) tab where bars can be dragged and resized.
- Project templates, including saving any project as one and copying a project.
- Hour budgets per project, optionally per phase, with alerts to the lead.
- A Workload screen over tickets and project tasks, people × days, where
  unassigned work is dispatched by dragging. This is the dispatch board
  moved from 5.
- The look A foundation, and the project screens rebuilt in it, on desktop
  and phone.

## Non-goals

Critical path, baselines, recurring projects, a cross-project timeline,
automatic resource levelling, money budgets, lag days, dependency types other
than finish-to-start, dependencies across projects, hour-level scheduling
(the workload is day-level only), and phases, milestones or dependencies on
ticket tasks (ticket tasks are unchanged).

## Anti-goals

- Hard blocking: a waiting task can still be started, logged and closed.
- Time logging is never refused because of a budget.
- No new mandatory fields when creating a task or a project.
- Workload must not show a ticket or task to someone who can't open it.

## Decisions (agreed 2026-10-25, all recommended defaults)

1. **Phases** are named, ordered groups of a project's top-level tasks.
   - Subtasks follow their parent's phase.
   - Tasks with no phase show under "No phase".
   - A phase's dates are not stored: they run from the earliest start to the
     latest due date of its tasks.
2. **A milestone** is a task with the milestone flag and a single date
   (start = due).
   - It has no estimate and no subtasks.
   - It is shown as a diamond.
3. **Start dates:** `startDate` is added to tasks/subtasks and to projects.
   It is optional everywhere.
4. **Dependencies:**
   - Finish-to-start only, between top-level tasks and milestones of the
     same project.
   - Loops are refused.
   - No lag days.
5. **Soft enforcement:**
   - A task with an unfinished predecessor shows "Waiting on T21". This is
     shown, not a status.
   - When a task's due date moves later, PRISM offers to move the tasks that
     wait on it by the same number of days ("Move 3 tasks" / "Leave them").
   - When a task is finished, the assignee of each task it was holding up is
     notified, once all of that task's predecessors are done.
6. **Timeline tab:**
   - Hand-built, no chart library.
   - Week, Month and Quarter zoom.
   - Drag a bar to move it, drag its ends to resize, snapping to days.
   - Dependency arrows, a today line and shaded weekends.
7. **Templates:**
   - Built in Settings → Project templates, or with Save as template on a
     project.
   - Phases, tasks, subtasks, milestones, estimates, priorities, dependencies,
     hour budget and tags are kept. Assignees, time, files and costs are not.
   - Task dates are stored as day offsets from the project start.
   - The new permission `projects.manage_templates` is needed to create,
     edit or delete templates. Anyone with `projects.create` can use them.
8. **Hour budget:**
   - Set per project, with optional per-phase budgets.
   - The lead is notified at 80% and at 100%, each switchable per project.
   - Logging is never blocked.
   - No money budgets.
9. **Workload screen:**
   - Techs × days, 1 or 2 weeks.
   - A task's remaining estimate is spread evenly over the assignee's working
     days between its start and due dates.
   - A ticket counts as the remaining estimates of its tasks. With none, it
     counts as the default ticket size setting (1 h).
10. **Dispatch:**
    - Drag from the "Not assigned yet" lane, or between cells, to a person
      and a day.
    - For a project task this sets the assignee and the dates.
    - For a ticket it sets the assignee and a new optional **planned date**.
      The SLA due date never moves.
    - Day-level only. Edit access on the record is enough to reassign
      (existing rule).
11. **Capacity:**
    - Each person has hours per weekday. The default is 8 h Mon–Fri, set
      system-wide and overridable per person.
    - Holidays are taken off. They come from the existing holiday lists:
      lists with no department apply to everyone, and a department's lists
      apply to its people.
12. **Permission `workload.view`** opens the screen. What it shows is limited
    to the viewer's existing ticket and project view scope.
13. **Ticket tasks** are unchanged.
14. **Out of scope** as listed under Non-goals.

## Added after review (2026-10-25)

15. **Helpers on a task.** A project task (or subtask) keeps one main
    assignee and can also have **helpers**. The user's example: someone
    asks you to help on their task and adds you to it. If you both spend
    an hour on it, that is two working hours.
    - **Who can add a helper:** anyone with edit access on the project, and
      also the task's main assignee. A helper can remove themselves.
    - **The person added** must be able to work for the project's company
      (the existing assignee check).
      - If they aren't a project member yet, adding them makes them a
        member, so they can open the project and log time.
      - The change is audited.
      - They are notified ("Priya added you to T17 on Riverside Clinic
        network refresh").
    - **Hours are person-hours.** Each person logs their own time. The
      task's logged hours, the phase's hours and the budget are the total
      of everyone's time, so 1 h each by two people is 2 h. The row shows
      "3 h logged by 2 people".
    - **On Workload,** a task's remaining estimate is shared evenly between
      the main assignee and the helpers. For example, an estimate of 4 h
      with two people puts 2 h on each person's days. The estimate means
      the total work, not the length of time it takes.
    - **Who counts as "mine":** helpers count for the "Mine" filter, for the
      phone's Mine list, and for "Waiting on you" notifications when the
      task can start.
    - Ticket tasks don't get helpers (decision 13 stands).
16. **Dark mode is the default.**
    - Anyone who hasn't picked a theme gets dark. Light (and "match my
      system") stays one click away in Preferences.
    - People who already chose a theme keep their choice.
    - Dark is therefore the primary design of look A, not an afterthought:
      every screen is built and checked in dark first, then light.

## Decided on the mockups (2026-10-25)

- **Look A, "Clear desk":** a light grey ground, white surfaces, one blue
  accent and amber for "waiting".
  - Font: Instrument Sans, self-hosted (no runtime Google Fonts call).
  - Numbers use tabular figures.
  - Soft 8–12 px radii.
  - It replaces the operations-console look (mono data face, squared chips).
  - It must stay themeable: **dark first** (the default, decision 16)
    with light fully designed too, and Settings → Appearance custom
    colours still layered on the `--color-*` variables. The mockups are
    drawn in light; the dark values follow the same roles.
- **Project page:**
  - Header: name, code, status, client and lead, with Start timer, Add task
    and a menu (Edit, Save as template, Report, Delete).
  - Summary row: tasks done of total, hours used of budget, next milestone
    with "in N days", and the number of waiting tasks.
  - Tabs: **Tasks, Timeline, Time, Costs, Files, People, Activity**. Costs
    merges the Expenses and Materials tabs, with the same permissions.
- **Tasks tab:**
  - Tasks grouped by phase, each phase collapsible and showing its progress
    and hours.
  - Rows show checkbox, code, title with chips (waiting, milestone,
    overdue), assignee, dates, logged/estimate and a timer button.
  - Subtasks are indented. Each phase ends with a quick-add row: type a
    title and press Enter.
  - Filter pills: All, Mine, Waiting, Overdue, Unassigned, Done.
- **Task panel:**
  - Clicking a task opens a docked panel on the right; the list stays usable.
  - It holds editable title; status, assignee, phase, dates, estimate,
    priority and the milestone switch; "Waiting on" / "Holding up";
    subtasks; **quick time buttons** (15 min, 30 min, 1 h, 2 h, Other);
    notes; and activity.
  - Quick time logs to today with the default work type. It needs `time.log`
    plus view access (existing rule).
  - **Keys:** J/K move between tasks, Esc closes the panel.
- **Shift-dependents banner** at the top of the task list after a move:
  "You moved T21 2 days later. 3 tasks wait on it. Move them 2 days later
  too?"
- **Projects list:**
  - Three attention tiles: over budget, milestones in the next 7 days and
    unassigned tasks. Each one filters the list.
  - Filter pills: Open, I'm on, I lead, Closed, All, plus company, tags and
    search.
  - Columns: project, lead, where it's at (current phase + progress), hours
    against budget (red when over), next milestone, due date and status.
- **New project:**
  - Start from Blank, a template, or **Copy an existing project**.
  - Fields: name, client, lead, start date, finish date (filled from the
    template; changing it stretches every date), hour budget (from the
    template) and tags.
  - A preview shows the phases with the dates they will get.
- **Template editor** (Settings): a grid of phase or task, "Starts on
  Day N", "Takes N days", estimate and "Waits on", with drag to reorder.
  Day 1 is the project's start date.
- **Settings menu:**
  - New groups **Projects** (Project templates) and **Workload** (Hours
    people work, Holidays).
  - Holidays moves out of "Hours & SLAs" into Workload. It is the same page
    and the SLA clock still uses it.
- **Budget:**
  - An over-budget notice on the project, and a "Where the time went" view
    by phase and by person, with a billable split.
  - The budget editor sits in the Time tab.
  - Budget alerts go out **in PRISM and by email**, through the email
    notifications built in 5a. Each person can switch them off like any
    other.
- **Workload:**
  - Range navigation, 1 or 2 weeks, team filter, and a choice of tickets
    and tasks, tickets only or tasks only.
  - Today is highlighted, holidays are hatched, and over-capacity cells are
    red.
  - Clicking a cell lists what fills it.
- **Phone** (under 768 px):
  - The project page becomes task cards with large checkboxes and a 44 px
    timer button.
  - Filters: Mine, All, Waiting.
  - A bottom dock with Log time and Add task.
  - The timeline is view-only on a phone, with horizontal scroll and no
    drag.
- The top bar gains **Workload**, shown only with `workload.view`.

## Builder's calls (made while writing this; check them)

- **Workload counts only what the viewer can see.** Hours from tickets and
  tasks outside the viewer's scope are left out, not shown as an anonymous
  total, so the screen never reveals that hidden work exists. The screen
  says "Counts work you can see."
- **Dates on the workload:**
  - An item with no dates sits in a "No date" column per person.
  - An open item that is past its date counts on today and is marked
    overdue.
  - A ticket with no planned date uses its SLA due date.
- **Phase budgets** are shown but don't send alerts. Only the project budget
  alerts.
- **Dragging a task that already has dates** on the workload keeps its
  length and moves its start to the drop day. Dropping a dateless task sets
  start = due = that day.
- **Finish-date stretch** in New project: every offset and length is scaled
  by new span ÷ template span and rounded, keeping at least 1 day. If a
  dependency would then be broken, the waiting task is pushed later.
- **Shift dependents** moves the whole downstream chain, transitively, by the
  same number of days. Finished tasks are skipped.
- **Budget alert levels** are remembered on the project, so each alert fires
  once. Raising the budget, or deleting time so that hours fall back under a
  level, re-arms that level.
- **The new notification types** are `task_unblocked`, `task_added`,
  `budget_warning` and `budget_reached`. All four show in PRISM.
  - Budget emails and `task_added` email are on by default.
  - `task_unblocked` email is off by default; each person can turn it on.
- **A task's main assignee can add helpers** without project edit access
  (decision 15), which also makes the helper a project member. That is
  the scenario the user described, but it does let an assignee widen who
  sees the project, within the company check.
- **Dark default and other pages:** the dark default also covers the login
  page, the public knowledge base and survey pages, which use the same
  theme.
- **The Instrument Sans font** is bundled from `@fontsource/instrument-sans`
  (OFL). This is a new frontend dependency; it gives a working font on
  installs with no internet.
- **Who gets `workload.view`:** the migration grants it to every role that
  already holds `tickets.view_all` or `projects.view_all`.
  `projects.manage_templates` goes to System Administrator.

## Constraints (from the roadmap design)

- Companies are the spine. Templates hold no company. A project made from
  one gets the company picked on the form, and the usual lead/member
  company checks apply.
- One time ledger. Budgets read `TimeEntries`; nothing new stores hours.
- Every new mutating endpoint is permission-checked and audit-logged. Every
  fetch-by-id re-checks scope, including template ids, dependency ids and
  phase ids, which must belong to the project in the URL.
- Every migration has a working `down()` and a round-trip test.
- No file past about 800 lines. `ProjectDetail.jsx` (542 lines) is split
  rather than grown.
- Release notes go under `## Unreleased` in `UPGRADING.md`.

## Left to the builder

Exact spacing and type scale within look A, exact dark-mode colour values,
animation (only on direct actions), endpoint names beyond those the plan
fixes, and how the timeline is drawn (DOM bars with SVG arrows is the
expected approach).
