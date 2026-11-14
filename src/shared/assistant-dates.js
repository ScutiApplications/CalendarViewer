// @ts-check
// Deterministic calendar dates in the server's local timezone; range ends are exclusive.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const { addDays } = require('./free-time');
function resolveDate(value, now = Date.now()) {
  if (typeof value !== 'string') throw new Error('Date must be a string.');
  const word = value.trim().toLowerCase();
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  if (word === 'today') return day;
  if (word === 'tomorrow') return addDays(day, 1);
  if (word === 'this week' || word === 'next week') return addDays(day, -((day.getDay() + 6) % 7) + (word === 'next week' ? 7 : 0));
  if (WEEKDAYS.includes(word)) return addDays(day, (WEEKDAYS.indexOf(word) - day.getDay() + 7) % 7);
  const match = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new Error('Use an ISO date, today, tomorrow, weekday, this week or next week.');
  const [, year, month, date, time] = match;
  const check = new Date(Date.UTC(+year, +month - 1, +date));
  if (check.getUTCFullYear() !== +year || check.getUTCMonth() !== +month - 1 || check.getUTCDate() !== +date) throw new Error('Invalid calendar date.');
  const result = time ? new Date(value) : new Date(+year, +month - 1, +date);
  if (!Number.isFinite(+result)) throw new Error('Invalid date.');
  return result;
}
function resolveDateRange(start = 'today', end, now = Date.now()) {
  const from = resolveDate(start, now);
  const to = end === undefined ? addDays(from, /^(this|next) week$/i.test(start.trim()) ? 7 : 1) : resolveDate(end, now);
  if (to <= from || +to - +from > 93 * 86400000) throw new Error('Range must be positive and at most 93 days.');
  return [from, to];
}
module.exports = { resolveDate, resolveDateRange, addDays };
