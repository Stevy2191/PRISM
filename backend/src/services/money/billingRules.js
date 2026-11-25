// The owner's billing rules (Phase 3, step 1; spec decisions 2026-11-25),
// as a pure function over time entries. Time entries keep their real
// minutes; rounding happens here, when charges are worked out.
//
// - A call is one ticket's on-site entries on one day.
// - Event-basis customer: a call = one trip charge + labor of at least the
//   minimum (60 min), then whole steps (30 min); remote work per ticket per
//   day in whole steps, no minimum.
// - Recurring customer: a call = the trip charge only, labor in hours
//   covered; remote work in hours covered.
// - After hours: billed at the after-hours rate in whole steps. An event
//   customer's call keeps its minimum after hours too.
const { D, cents } = require('./money');

const minutesOf = (seconds) => seconds / 60;
const roundUpToStep = (minutes, step) => (minutes <= 0 ? 0 : Math.ceil(minutes / step - 1e-9) * step);
const amountFor = (minutes, rate) => cents(D(rate).times(minutes).div(60));

function groupBy(entries, keyOf) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.values()];
}

// → { lines: [{ kind, ticketId, date, minutes, billedMinutes, rate, amount, entryIds }],
//     covered: [{ ticketId, date, minutes, entryIds }] }
function chargesFor(entries, {
  recurring, rates, minimumMinutes, stepMinutes,
}) {
  const lines = [];
  const covered = [];
  const billable = entries.filter((x) => x.billable && x.durationSeconds > 0);
  const groups = groupBy(billable, (x) => `${x.ticketId}|${x.entryDate}|${x.onSite ? 'site' : 'remote'}`);

  for (const group of groups) {
    const { ticketId, entryDate: date, onSite } = group[0];
    const inHours = group.filter((x) => !x.afterHours);
    const afterHours = group.filter((x) => x.afterHours);
    const inMinutes = minutesOf(inHours.reduce((s, x) => s + x.durationSeconds, 0));
    const ahMinutes = minutesOf(afterHours.reduce((s, x) => s + x.durationSeconds, 0));
    const ids = (list) => list.map((x) => x.id);
    const line = (kind, list, minutes, billedMinutes, rate) => ({
      kind, ticketId, date, minutes: Math.round(minutes), billedMinutes, rate: cents(rate), amount: amountFor(billedMinutes, rate), entryIds: ids(list),
    });

    if (onSite) {
      lines.push({
        kind: 'trip', ticketId, date, minutes: 0, billedMinutes: 0, rate: cents(rates.tripCharge), amount: cents(rates.tripCharge), entryIds: ids(group),
      });
    }

    if (recurring) {
      if (inHours.length) covered.push({ ticketId, date, minutes: Math.round(inMinutes), entryIds: ids(inHours) });
      if (afterHours.length) lines.push(line('after_hours', afterHours, ahMinutes, roundUpToStep(ahMinutes, stepMinutes), rates.afterHoursRate));
    } else {
      let inBilled = roundUpToStep(inMinutes, stepMinutes);
      let ahBilled = roundUpToStep(ahMinutes, stepMinutes);
      // An on-site call bills at least the minimum: the shortfall goes on the
      // in-hours labor, or on the after-hours labor when there's none.
      const short = onSite ? minimumMinutes - (inBilled + ahBilled) : 0;
      if (short > 0) {
        if (inHours.length) inBilled += short;
        else ahBilled += short;
      }
      if (inHours.length) lines.push(line('labor', inHours, inMinutes, inBilled, rates.hourlyRate));
      if (afterHours.length) lines.push(line('after_hours', afterHours, ahMinutes, ahBilled, rates.afterHoursRate));
    }
  }
  return { lines, covered };
}

module.exports = { chargesFor, roundUpToStep };
