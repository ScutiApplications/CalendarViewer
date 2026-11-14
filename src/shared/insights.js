// @ts-check
// Read-only views of the schedule: free blocks, overlaps, the week at a glance and the meeting to join now.
// Pure functions over event objects ({ title, start, end, allDay, extendedProps }); the page supplies the events.
// Shared by the page (script tag, global CalendarInsights) and the tests (require).
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./free-time.js') : root.CalendarFreeTime);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FreeTime) {
const cancelled = title => /^\s*cancell?ed\b/i.test(String(title));
/** Timed events that take up time: not all-day, not cancelled, with a real end. */
const busyEvents = events => events.filter(e => !e.allDay && !cancelled(e.title) && e.start && e.end && e.end > e.start);

/**
 * Whole free gaps of at least minMinutes inside working hours on weekdays, soonest first.
 * @param {any[]} events @param {[Date, Date]} range @param {number} minMinutes
 * @param {{ start?: string, end?: string }} hours @param {number} now @param {number} [limit]
 */
function freeBlocks(events, range, minMinutes, hours, now, limit = 50) {
  return FreeTime.freeGaps(events, range, minMinutes * 60000, hours, now, limit, (start, end) => ({ start: new Date(start), end: new Date(end) }));
}

/** Pairs of timed events that overlap, soonest first. Each pair has the overlapping window. */
function overlapPairs(events) {
  const timed = busyEvents(events).sort((a, b) => a.start - b.start);
  const pairs = [];
  timed.forEach((first, i) => {
    for (let j = i + 1; j < timed.length && timed[j].start < first.end; j++) {
      const second = timed[j];
      pairs.push({ first, second, start: second.start, end: new Date(Math.min(+first.end, +second.end)) });
    }
  });
  return pairs.sort((a, b) => a.start - b.start);
}

/** Minutes covered by at least one event; overlapping meetings count once. */
function busyMinutes(events) {
  const spans = busyEvents(events).map(e => [+e.start, +e.end]).sort((a, b) => a[0] - b[0]);
  let total = 0, cursor = -Infinity;
  for (const [s, e] of spans) {
    const from = Math.max(s, cursor);
    if (e > from) total += e - from;
    cursor = Math.max(cursor, e);
  }
  return Math.round(total / 60000);
}

/**
 * The week at a glance for the events inside [from, to).
 * @param {any[]} events @param {[Date, Date]} range @param {{ start?: string, end?: string }} hours @param {number} now
 */
function weekSummary(events, [from, to], hours, now) {
  const inside = events.filter(e => e.start && e.start < to && (e.end || e.start) > from);
  const timed = busyEvents(inside);
  const days = [];
  for (let day = new Date(from); day < to; day = FreeTime.addDays(day, 1)) {
    const next = FreeTime.addDays(day, 1);
    const clipped = timed.filter(e => e.start < next && e.end > day).map(e => ({ ...e, start: new Date(Math.max(+e.start, +day)), end: new Date(Math.min(+e.end, +next)) }));
    days.push({ date: new Date(day), meetings: clipped.length, minutes: busyMinutes(clipped) });
  }
  const busiest = days.reduce((best, day) => (day.minutes > (best ? best.minutes : 0) ? day : best), /** @type {any} */ (null));
  const free = freeBlocks(timed, [from, to], 1, hours, Math.min(now, +from), 500);
  const longest = free.reduce((best, block) => (!best || block.end - block.start > best.end - best.start ? block : best), /** @type {any} */ (null));
  return {
    meetings: timed.length,
    allDay: inside.filter(e => e.allDay && !cancelled(e.title)).length,
    meetingMinutes: busyMinutes(timed),
    overlaps: overlapPairs(inside).length,
    busiest: busiest && busiest.minutes ? busiest : null,
    longestFree: longest ? { start: longest.start, end: longest.end, minutes: Math.round((longest.end - longest.start) / 60000) } : null,
    days
  };
}

/**
 * The event to join now: running, or starting within leadMs. Soonest start first; cancelled and all-day are skipped.
 * @param {any[]} events @param {number} now @param {number} leadMs @param {(event: any) => any} findUrl returns a URL or null
 */
function joinableNow(events, now, leadMs, findUrl) {
  return busyEvents(events)
    .filter(e => +e.start <= now + leadMs && +e.end > now)
    .sort((a, b) => a.start - b.start)
    .map(event => ({ event, url: findUrl(event) }))
    .find(item => item.url) || null;
}

/** Toast text for the weekly summary, from a weekSummary result. Short enough for a Windows notification. */
function weekNotification(summary) {
  const lines = [];
  if (summary.meetings) lines.push('Time in meetings: ' + minutesText(summary.meetingMinutes));
  if (summary.busiest) lines.push('Busiest: ' + summary.busiest.date.toLocaleDateString(undefined, { weekday: 'long' }) + ', ' + minutesText(summary.busiest.minutes));
  if (summary.overlaps) lines.push(summary.overlaps + (summary.overlaps === 1 ? ' overlap' : ' overlaps'));
  if (summary.allDay) lines.push(summary.allDay + ' all-day');
  return {
    title: summary.meetings ? 'Week ahead: ' + summary.meetings + (summary.meetings === 1 ? ' meeting' : ' meetings') : 'Week ahead: no meetings',
    body: lines.join('\n') ||'Your calendar is clear.'
  };
}
/** "2 h 30 min" for a minute count. */
function minutesText(minutes) {
  const m = Math.max(0, Math.round(minutes)), h = Math.floor(m / 60), rest = m % 60;
  return h ? h + ' h' + (rest ? ' ' + rest + ' min' : '') : rest + ' min';
}
return { freeBlocks, overlapPairs, busyMinutes, weekSummary, joinableNow, minutesText, weekNotification };
});
