'use strict';

// Each company has its own SLA (CS part 2): its targets, support hours, time
// zone and holidays, on its page. No shared list of policies.
//
// SlaPolicies becomes one row per company (companyId) plus one row with no
// company: the starting values, copied when a company is created (it keeps
// isDefault, and is what a ticket uses if its company has no row).
//   + SlaPolicies.companyId (unique; null = the starting values)
//   + SlaPolicies.timezone, is24x7, schedule (were the BusinessHours row's)
//   + Holidays.slaPolicyId (a company's days off; were a holiday list's)
//   - SlaPolicies.businessHoursId, the unique policy name
//   - Companies.slaPolicyId
//   - BusinessHours, HolidayLists, Holidays.holidayListId
//   - workflow actions "Set SLA policy"
// Each company's row is a copy of the policy it was on (the default if
// none), with that policy's hours and holidays, so open tickets keep their
// clocks: they are pointed at their company's copy. Staff workload used the
// holiday lists for every department; those days become your own company's.
// PRISM is treated as new (owner, 2026-11-14): down rebuilds one shared
// default from the starting values; per-company rows are not kept.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function tablesOf(qi) {
  return (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
}

async function columnsOf(qi, Sequelize, table) {
  const rows = await qi.sequelize.query(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
    { type: Sequelize.QueryTypes.SELECT, replacements: { table } }
  );
  return rows.map((r) => r.c);
}

async function dropForeignKeys(qi, Sequelize, table, column) {
  const fks = await qi.sequelize.query(
    `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { type: Sequelize.QueryTypes.SELECT, replacements: { table, column } }
  );
  for (const fk of fks) await qi.removeConstraint(table, fk.name); // eslint-disable-line no-await-in-loop
}

async function dropUniqueOn(qi, Sequelize, table, column) {
  const rows = await qi.sequelize.query(
    `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'`,
    { type: Sequelize.QueryTypes.SELECT, replacements: { table, column } }
  );
  for (const r of rows) await qi.removeIndex(table, r.name); // eslint-disable-line no-await-in-loop
}

const parse = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const T = Sequelize.QueryTypes;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: T.SELECT, replacements });
    const run = (sql, replacements) => qi.sequelize.query(sql, { replacements });
    const policyCols = await columnsOf(qi, Sequelize, 'SlaPolicies');
    if (policyCols.includes('companyId')) return; // already applied

    await qi.addColumn('SlaPolicies', 'companyId', {
      type: Sequelize.INTEGER, allowNull: true, unique: true, references: { model: 'Companies', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
    });
    await qi.addColumn('SlaPolicies', 'timezone', { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'UTC' });
    await qi.addColumn('SlaPolicies', 'is24x7', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await qi.addColumn('SlaPolicies', 'schedule', { type: Sequelize.JSON, allowNull: true });
    await dropUniqueOn(qi, Sequelize, 'SlaPolicies', 'name');
    await qi.addColumn('Holidays', 'slaPolicyId', {
      type: Sequelize.INTEGER, allowNull: true, references: { model: 'SlaPolicies', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
    });

    const tables = await tablesOf(qi);
    const [org] = await select("SELECT value FROM SystemSettings WHERE `key` = 'company.timezone'").catch(() => []);
    const orgZone = (org && org.value) || 'UTC';
    const hours = tables.includes('BusinessHours') ? await select('SELECT * FROM BusinessHours') : [];
    const hoursById = new Map(hours.map((h) => [h.id, h]));
    const holidays = tables.includes('Holidays') ? await select('SELECT holidayListId, name, date FROM Holidays WHERE holidayListId IS NOT NULL') : [];
    const holidaysByList = new Map();
    holidays.forEach((h) => holidaysByList.set(h.holidayListId, [...(holidaysByList.get(h.holidayListId) || []), h]));
    const dateOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

    // A policy's schedule, zone and holidays, from its business-hours row.
    const calendarOf = (policy) => {
      const bh = policy.businessHoursId ? hoursById.get(policy.businessHoursId) : null;
      if (!bh) return { timezone: orgZone, is24x7: true, schedule: null, holidays: [] };
      return {
        timezone: bh.timezone || orgZone,
        is24x7: !!bh.is24x7,
        schedule: parse(bh.schedule),
        holidays: bh.holidayListId ? (holidaysByList.get(bh.holidayListId) || []) : [],
      };
    };

    const policies = await select('SELECT * FROM SlaPolicies');
    let def = policies.find((p) => p.isDefault) || policies[0];
    if (!def) {
      await run("INSERT INTO SlaPolicies (name, isDefault, warnAtPercent, timezone, is24x7, createdAt, updatedAt) VALUES ('Starting values', 1, 75, :tz, 1, NOW(), NOW())", { tz: orgZone });
      [def] = await select('SELECT * FROM SlaPolicies WHERE isDefault = 1');
    }
    const policyById = new Map(policies.map((p) => [p.id, p]));
    const targetsOf = async (policyId) => select('SELECT * FROM SlaTargets WHERE slaPolicyId = :policyId', { policyId });
    const now = new Date();

    const writeCalendar = async (id, cal) => {
      await run('UPDATE SlaPolicies SET timezone = :tz, is24x7 = :is24, schedule = :schedule WHERE id = :id', {
        id, tz: cal.timezone, is24: cal.is24x7 ? 1 : 0, schedule: cal.schedule ? JSON.stringify(cal.schedule) : null,
      });
    };
    const addHolidays = async (policyId, list) => {
      const seen = new Set();
      for (const h of list) {
        const date = dateOf(h.date);
        if (seen.has(date)) continue; // eslint-disable-line no-continue
        seen.add(date);
        // eslint-disable-next-line no-await-in-loop
        await run('INSERT INTO Holidays (slaPolicyId, holidayListId, name, date) VALUES (:policyId, NULL, :name, :date)', { policyId, name: h.name, date });
      }
    };

    // Each company: a copy of the policy it is on, with its hours and holidays.
    // (Companies.slaPolicyId is missing when 048 was rolled back and re-run.)
    const chosen = (await columnsOf(qi, Sequelize, 'Companies')).includes('slaPolicyId') ? 'slaPolicyId' : 'NULL AS slaPolicyId';
    const companies = await select(`SELECT id, name, ${chosen}, isInternal FROM Companies`);
    const copyFor = new Map();
    for (const c of companies) {
      const source = policyById.get(c.slaPolicyId) || def;
      const cal = calendarOf(source);
      // eslint-disable-next-line no-await-in-loop
      await run(
        `INSERT INTO SlaPolicies (name, isDefault, warnAtPercent, companyId, timezone, is24x7, schedule, createdAt, updatedAt)
         VALUES (:name, 0, :warn, :companyId, :tz, :is24, :schedule, :now, :now)`,
        {
          name: String(c.name).slice(0, 100), warn: source.warnAtPercent, companyId: c.id, tz: cal.timezone,
          is24: cal.is24x7 ? 1 : 0, schedule: cal.schedule ? JSON.stringify(cal.schedule) : null, now,
        }
      );
      // eslint-disable-next-line no-await-in-loop
      const [row] = await select('SELECT id FROM SlaPolicies WHERE companyId = :companyId', { companyId: c.id });
      copyFor.set(c.id, row.id);
      // eslint-disable-next-line no-await-in-loop
      for (const t of await targetsOf(source.id)) {
        const { id, slaPolicyId, ...rest } = t; // eslint-disable-line no-unused-vars
        // eslint-disable-next-line no-await-in-loop
        await qi.bulkInsert('SlaTargets', [{ ...rest, slaPolicyId: row.id, createdAt: now, updatedAt: now }]);
      }
      // eslint-disable-next-line no-await-in-loop
      await addHolidays(row.id, cal.holidays);
    }

    // Staff workload's days off (lists for everyone, or a department's) are
    // your own company's now.
    const internal = companies.find((c) => c.isInternal);
    if (internal && tables.includes('HolidayLists')) {
      const lists = await select('SELECT id FROM HolidayLists');
      const own = await select('SELECT date FROM Holidays WHERE slaPolicyId = :id', { id: copyFor.get(internal.id) });
      const have = new Set(own.map((h) => dateOf(h.date)));
      await addHolidays(copyFor.get(internal.id), lists.flatMap((l) => holidaysByList.get(l.id) || []).filter((h) => !have.has(dateOf(h.date))));
    }

    // The default becomes the starting values: its own hours, no company.
    await writeCalendar(def.id, calendarOf(def));
    await run("UPDATE SlaPolicies SET name = 'Starting values', isDefault = 1 WHERE id = :id", { id: def.id });
    await addHolidays(def.id, calendarOf(def).holidays);

    // Open (and closed) tickets follow their company's copy.
    for (const [companyId, policyId] of copyFor) {
      // eslint-disable-next-line no-await-in-loop
      await run('UPDATE TicketSlas ts JOIN Tickets t ON t.id = ts.ticketId SET ts.slaPolicyId = :policyId WHERE t.companyId = :companyId', { policyId, companyId });
    }
    await run('UPDATE TicketSlas SET slaPolicyId = :id WHERE slaPolicyId NOT IN (SELECT id FROM (SELECT id FROM SlaPolicies) AS p)', { id: def.id });

    // No shared policies, no "Set SLA policy" rule action.
    await run('UPDATE TicketSlas SET slaPolicyId = :id WHERE slaPolicyId IN (SELECT id FROM (SELECT id FROM SlaPolicies WHERE companyId IS NULL AND id <> :id) AS p)', { id: def.id });
    await run('DELETE FROM SlaPolicies WHERE companyId IS NULL AND id <> :id', { id: def.id });
    if (tables.includes('WorkflowActions')) await run("DELETE FROM WorkflowActions WHERE actionType = 'set_sla_policy'");

    if ((await columnsOf(qi, Sequelize, 'Companies')).includes('slaPolicyId')) {
      await dropForeignKeys(qi, Sequelize, 'Companies', 'slaPolicyId');
      await qi.removeColumn('Companies', 'slaPolicyId');
    }
    await dropForeignKeys(qi, Sequelize, 'SlaPolicies', 'businessHoursId');
    await qi.removeColumn('SlaPolicies', 'businessHoursId');
    await run('DELETE FROM Holidays WHERE slaPolicyId IS NULL');
    await dropForeignKeys(qi, Sequelize, 'Holidays', 'holidayListId');
    await qi.removeColumn('Holidays', 'holidayListId');
    await qi.changeColumn('Holidays', 'slaPolicyId', {
      type: Sequelize.INTEGER, allowNull: false, references: { model: 'SlaPolicies', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
    });
    if (tables.includes('BusinessHours')) await qi.dropTable('BusinessHours');
    if (tables.includes('HolidayLists')) await qi.dropTable('HolidayLists');
  },

  down: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const T = Sequelize.QueryTypes;
    const select = (sql, replacements) => qi.sequelize.query(sql, { type: T.SELECT, replacements });
    const run = (sql, replacements) => qi.sequelize.query(sql, { replacements });
    if (!(await columnsOf(qi, Sequelize, 'SlaPolicies')).includes('companyId')) return;
    const { INTEGER, STRING, BOOLEAN } = Sequelize;
    const now = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
    const tables = await tablesOf(qi);

    if (!tables.includes('BusinessHours')) {
      await qi.createTable('BusinessHours', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        departmentId: { type: INTEGER, allowNull: true, references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        timezone: { type: STRING(64), allowNull: false, defaultValue: 'UTC' },
        schedule: { type: Sequelize.JSON, allowNull: true },
        is24x7: { type: BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: now,
      });
    }
    if (!tables.includes('HolidayLists')) {
      await qi.createTable('HolidayLists', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: STRING(255), allowNull: false },
        departmentId: { type: INTEGER, allowNull: true, references: { model: 'Departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        createdAt: now,
      });
    }
    await qi.addColumn('BusinessHours', 'holidayListId', { type: INTEGER, allowNull: true, references: { model: 'HolidayLists', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }).catch(() => {});

    const [def] = await select('SELECT * FROM SlaPolicies WHERE companyId IS NULL ORDER BY isDefault DESC, id LIMIT 1');
    // The starting values become the one shared default again, with a
    // schedule and a holiday list of their own when they had any.
    let bhId = null;
    if (def && !def.is24x7) {
      await run('INSERT INTO BusinessHours (name, timezone, schedule, is24x7, createdAt) VALUES (\'Support hours\', :tz, :schedule, 0, NOW())', {
        tz: def.timezone, schedule: typeof def.schedule === 'string' ? def.schedule : JSON.stringify(def.schedule || Object.fromEntries(DAYS.map((d) => [d, { enabled: false }]))),
      });
      [{ id: bhId }] = await select('SELECT MAX(id) AS id FROM BusinessHours');
    }
    await qi.addColumn('Holidays', 'holidayListId', { type: INTEGER, allowNull: true, references: { model: 'HolidayLists', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' });
    if (def) {
      const days = await select('SELECT id FROM Holidays WHERE slaPolicyId = :id', { id: def.id });
      if (days.length) {
        await run("INSERT INTO HolidayLists (name, createdAt) VALUES ('Holidays', NOW())");
        const [{ id: listId }] = await select('SELECT MAX(id) AS id FROM HolidayLists');
        await run('UPDATE Holidays SET holidayListId = :listId WHERE slaPolicyId = :id', { listId, id: def.id });
        if (bhId) await run('UPDATE BusinessHours SET holidayListId = :listId WHERE id = :bhId', { listId, bhId });
      }
      await run('UPDATE TicketSlas SET slaPolicyId = :id WHERE slaPolicyId <> :id', { id: def.id });
    }
    await run('DELETE FROM Holidays WHERE holidayListId IS NULL');
    await dropForeignKeys(qi, Sequelize, 'Holidays', 'slaPolicyId');
    await qi.removeColumn('Holidays', 'slaPolicyId');
    await qi.changeColumn('Holidays', 'holidayListId', { type: INTEGER, allowNull: false, references: { model: 'HolidayLists', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' });

    await run('DELETE FROM SlaPolicies WHERE companyId IS NOT NULL');
    await qi.addColumn('SlaPolicies', 'businessHoursId', { type: INTEGER, allowNull: true, references: { model: 'BusinessHours', key: 'id' }, onDelete: 'SET NULL' });
    if (def) await run("UPDATE SlaPolicies SET businessHoursId = :bhId, name = 'Standard', isDefault = 1 WHERE id = :id", { bhId, id: def.id });
    await dropForeignKeys(qi, Sequelize, 'SlaPolicies', 'companyId');
    await qi.removeColumn('SlaPolicies', 'companyId');
    await qi.removeColumn('SlaPolicies', 'timezone');
    await qi.removeColumn('SlaPolicies', 'is24x7');
    await qi.removeColumn('SlaPolicies', 'schedule');
    await qi.addIndex('SlaPolicies', ['name'], { unique: true, name: 'name' }).catch(() => {});
    if (!(await columnsOf(qi, Sequelize, 'Companies')).includes('slaPolicyId')) {
      await qi.addColumn('Companies', 'slaPolicyId', { type: INTEGER, allowNull: true, references: { model: 'SlaPolicies', key: 'id' }, onDelete: 'SET NULL' });
    }
  },
};
