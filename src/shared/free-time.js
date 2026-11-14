// @ts-check
// Availability is computed from actual event intervals, never by the language model.
// Shared by the server (require) and the page (script tag, global CalendarFreeTime).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarFreeTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
function clock(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Working hours must use HH:MM.');
  return /** @type {[number, number]} */ (value.split(':').map(Number));
}
// One place validates working hours and measures them; overnight shifts wrap past midnight.
function workingShift(hours = {}) {
  const start = clock(hours.start === undefined ? '09:00' : hours.start);
  const end = clock(hours.end === undefined ? '17:00' : hours.end);
  if (String(start) === String(end)) throw new Error('Working hours must differ.');
  const minutes = ((end[0] * 60 + end[1]) - (start[0] * 60 + start[1]) + 1440) % 1440;
  return { start, end, minutes, overnight: end[0] * 60 + end[1] < start[0] * 60 + start[1] };
}
/**
 * Whole gaps inside working hours on weekdays, soonest first. `build(start, end)` makes each result from epoch ms.
 * @template T
 * @param {{ start: Date, end: Date }[]} events @param {[Date, Date]} range @param {number} duration milliseconds
 * @param {{ start?: string, end?: string }} hours @param {number} now @param {number} limit @param {(start: number, end: number) => T} build
 * @returns {T[]}
 */
function freeGaps(events, [from, to], duration, hours, now, limit, build) {
  if (!(to > from) || +to - +from > 93 * 86400000) throw new Error('Invalid availability range.');
  const { start, end } = workingShift(hours);
  const busy = events.filter(e => e.end > e.start).map(e => [+e.start, +e.end]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  const first = new Date(from); first.setHours(0, 0, 0, 0);
  // Include the preceding shift when a requested range begins during overnight working hours.
  for (let day = addDays(first, -1); day < to && gaps.length < limit; day = addDays(day, 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const a = new Date(day), b = new Date(day);
    a.setHours(...start, 0, 0); b.setHours(...end, 0, 0);
    if (b <= a) b.setDate(b.getDate() + 1);
    let cursor = Math.max(+a, +from, +now);
    const finish = Math.min(+b, +to);
    const record = until => { if (until - cursor >= duration && gaps.length < limit) gaps.push(build(cursor, until)); };
    for (const [s, e] of busy) {
      if (e <= cursor || s >= finish) continue;
      record(Math.min(s, finish)); cursor = Math.max(cursor, e);
      if (cursor >= finish) break;
    }
    record(finish);
  }
  return gaps;
}
function findFreeTime(events, range, minutes, hours = {}, now = Date.now()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('minutes must be an integer from 1 to 1440.');
  const duration = minutes * 60000;
  return freeGaps(events, range, duration, hours, now, 20, start => ({ start: new Date(start).toISOString(), end: new Date(start + duration).toISOString() }));
}
/**
 * Plain text to paste into an email or chat. Rows are { when, alt } where alt is the same time in a second zone, or ''.
 * @param {number} minutes @param {string} zone @param {{ when: string, alt?: string }[]} rows
 */
function proposalText(minutes, zone, rows) {
  if (!rows.length) return '';
  const lines = rows.map(row => '- ' + row.when + (row.alt ? '  /  ' + row.alt : ''));
  return ['I am free for ' + minutes + ' minutes at these times (' + (zone || 'my local time') + '):', ...lines].join('\n');
}
return { findFreeTime, freeGaps, workingShift, proposalText, addDays };
});
