// @ts-check
// Shared read-only definitions and handlers for MCP and the local assistant.
const logic = require('../shared/alert-logic.js');
const Search = require('../shared/search.js');

const { resolveDate, resolveDateRange } = require('../shared/assistant-dates');
const { findFreeTime, workingShift } = require('../shared/free-time');
const { DAY_MS, WEEK_MS } = logic;
const MAX_SPAN_MS = 93 * DAY_MS;
const MAX_EVENTS = 200;
const READ_ONLY = { readOnlyHint: true };
const fail = message => { throw Object.assign(new Error(message), { tool: true }); };

const RANGE = {
  start: { type: 'string', description: 'ISO date or today, tomorrow, thursday, this week, next week. A date or weekday selects one day; a week selects seven days. Default: now.' },
  end: { type: 'string', description: 'Exclusive ISO end, optional. Omit for a relative day/week. Timestamp ranges default to seven days, at most 93 days.' }
};
const TOOLS = [
  { name: 'list_calendars', description: 'List the linked and imported calendars with their visibility and event counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_events', description: 'List events in a date range, merged across calendars and with overlaps marked. Cancelled events are left out.',
    inputSchema: { type: 'object', properties: { ...RANGE, query: { type: 'string', description: 'Only events with these words in the title, location, description or attendees.' } } } },
  { name: 'get_event', description: 'Get full details of one event by uid (description, location, meeting link, occurrences in the range). Default range: 30 days back to 60 days ahead.',
    inputSchema: { type: 'object', properties: { uid: { type: 'string' }, ...RANGE }, required: ['uid'] } },
  { name: 'up_next', description: 'The next upcoming events within 7 days, soonest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Default 3.' } } } },
  { name: 'conflicts', description: 'Timed events that overlap another event in a date range.', inputSchema: { type: 'object', properties: RANGE } }
].map(tool => ({ ...tool, annotations: READ_ONLY }));

// Merged busy intervals inside [from, to), so overlapping events are not counted twice.
function busyIntervals(events, from, to) {
  const out = [];
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    const s = Math.max(+e.start, +from), f = Math.min(+e.end, +to);
    if (f <= s) continue;
    if (out.length && s <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], f); else out.push([s, f]);
  }
  return out;
}
const busyMinutes = intervals => Math.round(intervals.reduce((n, [s, e]) => n + e - s, 0) / 60000);
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nextMidnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

function createCalendarTools({ sources, now = Date.now }) {
  function range(args, defaultFrom = now(), defaultSpan = WEEK_MS) {
    if (args.start !== undefined && !/^\d{4}-\d{2}-\d{2}T/.test(args.start)) return resolveDateRange(args.start, args.end, now());
    const start = args.start === undefined ? defaultFrom : +resolveDate(args.start, now());
    const end = args.end === undefined ? start + defaultSpan : +resolveDate(args.end, now());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('start and end must be ISO 8601 dates with end after start.');
    if (end - start > MAX_SPAN_MS) fail('The range may be at most 93 days.');
    return [new Date(start), new Date(end)];
  }
  const merged = (list, from, to) => logic.markConflicts(logic.expandSources(list, from, to)
    .filter(e => !logic.isCancelledTitle(e.title) && e.start < to && (e.end > e.start ? e.end > from : e.start >= from)))
    .sort((a, b) => a.start - b.start);
  const summary = e => {
    const p = e.extendedProps;
    return { uid: p.uid, title: e.title, start: e.start.toISOString(), end: e.end && e.end.toISOString(), allDay: e.allDay,
      location: p.location || '', calendars: p.sources, overlapsWith: p.conflicts };
  };

  // Short description excerpt around the first query word, so the model can answer without a get_event call.
  function snippet(e, query) {
    const text = String(e.extendedProps.description || '').replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    const lower = text.toLowerCase();
    const at = Math.max(0, ...Search.wordsOf(query).map(w => lower.indexOf(Search.stem(w))).filter(i => i >= 0).slice(0, 1));
    return (at > 40 ? '…' : '') + text.slice(Math.max(0, at - 40), at + 120);
  }
  // Best matches first; equal scores keep calendar order.
  const rank = (events, query, options) => events.map((e, i) => ({ e, i, s: Search.score(e, query, options) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.e);
  const listed = (events, limit = MAX_EVENTS) => ({ total: events.length, events: events.slice(0, limit).map(summary) });

  const handlers = new Map(Object.entries({
    async list_calendars() {
      return (await sources()).map(s => ({ name: s.name, kind: s.alertKey.startsWith('f:') ? 'link' : 'imported', enabled: s.enabled, events: s.events.length }));
    },
    async list_events(args) {
      const [from, to] = range(args);
      const events = merged(await sources(), from, to).filter(e => Search.matchesWords(e, args.query));
      return listed(events);
    },
    async get_event(args) {
      if (typeof args.uid !== 'string' || !args.uid) fail('uid is required.');
      const [from, to] = range(args, now() - 30 * DAY_MS, 90 * DAY_MS);
      const found = merged(await sources(), from, to).filter(e => e.extendedProps.uid === args.uid);
      if (!found.length) fail('No event with that uid in the range.');
      const p = found[0].extendedProps, meeting = logic.findMeetingUrl(p);
      return { ...summary(found[0]), description: p.description || '', meetingUrl: meeting ? meeting.href : null,
        occurrences: found.slice(0, 20).map(e => ({ start: e.start.toISOString(), end: e.end && e.end.toISOString() })) };
    },
    async up_next(args) {
      const limit = args.limit === undefined ? 3 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail('limit must be an integer from 1 to 20.');
      const t = now();
      return logic.upNext(await sources(), t, limit).map(o => ({
        title: o.title, start: new Date(o.start).toISOString(), allDay: !!o.allDay, location: o.location || '',
        calendars: o.sourceDetails.map(s => s.name), meetingUrl: o.join || null
      }));
    },
    async day_summary(args) {
      const [from, to] = range({ start: args.start || 'today' });
      const events = merged(await sources(), from, to), timed = events.filter(e => !e.allDay && e.end > e.start);
      const busy = busyIntervals(timed, from, to);
      let gap = null;
      for (let i = 1; i < busy.length; i++) if (!gap || busy[i][0] - busy[i - 1][1] > gap.end - gap.start) gap = { start: busy[i - 1][1], end: busy[i][0] };
      return { date: dayKey(from), events: timed.length, all_day_events: events.length - timed.length, busy_minutes: busyMinutes(busy),
        first_start: busy.length ? new Date(busy[0][0]).toISOString() : null, last_end: busy.length ? new Date(busy.at(-1)[1]).toISOString() : null,
        longest_gap_between_events: gap && { start: new Date(gap.start).toISOString(), end: new Date(gap.end).toISOString() } };
    },
    async next_free_slot(args) {
      const from = new Date(now()), to = new Date(now() + 14 * DAY_MS);
      const slots = findFreeTime(merged(await sources(), from, to), [from, to], args.minutes, { start: args.work_start, end: args.work_end }, now());
      return { slot: slots[0] || null, ...(slots.length ? {} : { note: `No free time of ${args.minutes} minutes in the next 14 days within those working hours.` }) };
    },
    async time_until(args) {
      const t = now();
      const found = merged(await sources(), new Date(t - DAY_MS), new Date(t + 30 * DAY_MS))
        .filter(e => !e.allDay && (e.end > e.start ? +e.end : +e.start) > t && Search.matchesWords(e, args.query));
      const next = found[0];
      if (!next) return { note: 'No upcoming event in the next 30 days.' };
      const started = +next.start <= t;
      return { ...summary(next), status: started ? 'in progress' : 'upcoming', minutes_until_start: started ? 0 : Math.ceil((+next.start - t) / 60000),
        minutes_until_end: next.end > next.start ? Math.ceil((+next.end - t) / 60000) : null };
    },
    async busiest_day(args) {
      const [from, to] = range(args);
      const events = merged(await sources(), from, to).filter(e => !e.allDay && e.end > e.start), days = [];
      for (let d = new Date(from); d < to && days.length < 93; d = nextMidnight(d)) {
        const end = nextMidnight(d), inDay = events.filter(e => e.start < end && e.end > d);
        days.push({ date: dayKey(d), events: inDay.length, busy_minutes: busyMinutes(busyIntervals(inDay, d, end)) });
      }
      const ranked = [...days].sort((a, b) => b.busy_minutes - a.busy_minutes);
      return { busiest: ranked[0] || null, lightest: ranked.at(-1) || null, days: days.slice(0, 31) };
    },
    async search_events(args) {
      if (typeof args.query !== 'string' || !args.query.trim()) fail('query is required.');
      const [from, to] = range(args, now() - 30 * DAY_MS, 90 * DAY_MS);
      const all = merged(await sources(), from, to);
      // Widen only when the stricter pass finds nothing: all words, then one typo per word, then any word.
      let ranked = [];
      for (const options of [{}, { fuzzy: true }, { fuzzy: true, any: true }]) if (!(ranked = rank(all, args.query, options)).length) continue; else break;
      const out = listed(ranked, 20);
      out.events = out.events.map((e, i) => ({ ...e, description_excerpt: snippet(ranked[i], args.query) }));
      return out;
    },
    async list_all_day(args) {
      const [from, to] = range(args);
      const events = merged(await sources(), from, to).filter(e => e.allDay);
      return listed(events);
    },
    async recurring_summary(args) {
      if (typeof args.query !== 'string' || !args.query.trim()) fail('query is required.');
      const groups = new Map();
      for (const e of merged(await sources(), new Date(now()), new Date(now() + MAX_SPAN_MS)).filter(e => Search.matchesWords(e, args.query))) {
        const g = groups.get(e.extendedProps.uid) || { title: e.title, uid: e.extendedProps.uid, starts: [] };
        g.starts.push(e.start.toISOString()); groups.set(e.extendedProps.uid, g);
      }
      return { range_days: 93, series: [...groups.values()].slice(0, 10).map(g => ({ title: g.title, uid: g.uid, occurrences: g.starts.length, repeats: g.starts.length > 1, next: g.starts.slice(0, 5) })) };
    },
    async conflicts(args) {
      const [from, to] = range(args);
      return merged(await sources(), from, to).filter(e => e.extendedProps.conflicts.length).slice(0, MAX_EVENTS).map(summary);
    }
  }));


  async function execute(name, args = {}) {
    const definition = ASSISTANT_TOOLS.find(t => t.name === name);
    if (!definition) fail('Unknown tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('arguments must be an object.');
    for (const [key, value] of Object.entries(args)) {
      if (!Object.hasOwn(definition.inputSchema.properties, key)) fail('Invalid argument: ' + key);
      const schema = definition.inputSchema.properties[key];
      if (!schema || (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type)) fail('Invalid argument: ' + key);
      if (typeof value === 'string' && value.length > 2000) fail('Argument too long.');
    }
    for (const key of definition.inputSchema.required || []) if (args[key] === undefined) fail(key + ' is required.');
    if (name === 'get_working_hours') {
      const shift = workingShift({ start: args.work_start, end: args.work_end });
      return { work_start: args.work_start || '09:00', work_end: args.work_end || '17:00', overnight: shift.overnight,
        length: `${Math.floor(shift.minutes / 60)} hours ${shift.minutes % 60} minutes`, days: 'weekdays' };
    }
    if (name === 'find_free_time') {
      const dates = resolveDateRange(args.start || 'this week', args.end, now());
      const events = merged(await sources(), ...dates);
      const hours = { start: args.work_start, end: args.work_end };
      const slots = findFreeTime(events, /** @type {[Date, Date]} */ (dates), args.minutes, hours, now());
      // Empty lists are dropped before the model reads a result, so say in words what was searched and that nothing is free.
      return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, working_hours: `${hours.start || '09:00'}-${hours.end || '17:00'} on weekdays`, slots,
        ...(slots.length ? {} : { note: `No free time of ${args.minutes} minutes in this range, within those working hours and after the current time.` }) };
    }
    const handler = handlers.get(name);
    if (typeof handler !== 'function') fail('Unknown tool.');
    return handler(args);
  }
  return { execute, definitions: ASSISTANT_TOOLS };
}
const DAY = { start: { type: 'string', description: 'ISO date or today, tomorrow, thursday. Default today.' } };
const ASSISTANT_TOOLS = [...TOOLS,
  { name: 'get_working_hours', description: 'The working hours (shift) of the user: start, end and length per day. Use for questions about shift, work hours or how long they work.', inputSchema: { type: 'object', properties: { work_start: { type: 'string' }, work_end: { type: 'string' } } }, annotations: READ_ONLY },
  { name: 'day_summary', description: 'One day at a glance: event count, total busy minutes, first start, last end (when the day ends) and longest gap.', inputSchema: { type: 'object', properties: DAY }, annotations: READ_ONLY },
  { name: 'next_free_slot', description: 'The first free time of a given length from now, within working hours.', inputSchema: { type: 'object', properties: { minutes: { type: 'integer' }, work_start: { type: 'string' }, work_end: { type: 'string' } }, required: ['minutes'] }, annotations: READ_ONLY },
  { name: 'time_until', description: 'Minutes until the next event starts (or until a matching event, with query), or how long until the current one ends.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Only events with these words in the title, location, description or attendees.' } } }, annotations: READ_ONLY },
  { name: 'busiest_day', description: 'Per-day busy minutes in a range, with the busiest and lightest day.', inputSchema: { type: 'object', properties: RANGE }, annotations: READ_ONLY },
  { name: 'search_events', description: 'Find events by words in title, location, description or attendees over a wide range (default 30 days back to 60 ahead).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, ...RANGE }, required: ['query'] }, annotations: READ_ONLY },
  { name: 'list_all_day', description: 'All-day events only (holidays, leave, day-long blocks) in a range.', inputSchema: { type: 'object', properties: RANGE }, annotations: READ_ONLY },
  { name: 'recurring_summary', description: 'Upcoming occurrences of events matching a title, grouped per series, to tell how often they repeat.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: READ_ONLY },
  { name: 'find_free_time', description: 'Find available time, computed by code. Default weekdays 09:00–17:00; range may be today, thursday, this week, next week or ISO dates. Ends are exclusive.', inputSchema: { type: 'object', properties: { ...RANGE, minutes: { type: 'integer' }, work_start: { type: 'string' }, work_end: { type: 'string' } }, required: ['minutes'] }, annotations: READ_ONLY }];
module.exports = { createCalendarTools, TOOLS };
