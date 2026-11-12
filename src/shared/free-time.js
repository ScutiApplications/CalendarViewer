// Availability is computed from actual event intervals, never by the language model.
const { addDays } = require('./assistant-dates');
function clock(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Working hours must use HH:MM.');
  return value.split(':').map(Number);
}
// One place validates working hours and measures them; overnight shifts wrap past midnight.
function workingShift(hours = {}) {
  const start = clock(hours.start === undefined ? '09:00' : hours.start);
  const end = clock(hours.end === undefined ? '17:00' : hours.end);
  if (String(start) === String(end)) throw new Error('Working hours must differ.');
  const minutes = ((end[0] * 60 + end[1]) - (start[0] * 60 + start[1]) + 1440) % 1440;
  return { start, end, minutes, overnight: end[0] * 60 + end[1] < start[0] * 60 + start[1] };
}
function findFreeTime(events, [from, to], minutes, hours = {}, now = Date.now()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('minutes must be an integer from 1 to 1440.');
  if (!(to > from) || to - from > 93 * 86400000) throw new Error('Invalid availability range.');
  const { start, end } = workingShift(hours);
  const busy = events.filter(e => e.end > e.start).map(e => [+e.start, +e.end]).sort((a, b) => a[0] - b[0]);
  const slots = [], duration = minutes * 60000;
  const first = new Date(from); first.setHours(0, 0, 0, 0);
  // Include the preceding shift when a requested range begins during overnight working hours.
  for (let day = addDays(first, -1); day < to && slots.length < 20; day = addDays(day, 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const a = new Date(day), b = new Date(day);
    a.setHours(...start, 0, 0); b.setHours(...end, 0, 0);
    if (b <= a) b.setDate(b.getDate() + 1);
    let cursor = Math.max(+a, +from, +now), finish = Math.min(+b, +to);
    const record = until => {
      if (until - cursor >= duration && slots.length < 20) slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + duration).toISOString() });
    };
    for (const [s, e] of busy) {
      if (e <= cursor || s >= finish) continue;
      record(Math.min(s, finish)); cursor = Math.max(cursor, e);
      if (cursor >= finish) break;
    }
    record(finish);
  }
  return slots;
}
module.exports = { findFreeTime, workingShift };
