const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const { resolveDateRange } = require('../src/shared/assistant-dates');
const { findFreeTime, proposalText } = require('../src/shared/free-time');
const { createCalendarTools, TOOLS } = require('../src/server/calendar-tools');
const logic = require('../src/shared/alert-logic');
const { createMcpHandler } = require('../src/server/mcp');
const now = new Date(2026, 10, 4, 8).getTime();

test('relative dates use calendar days, weekdays and Monday weeks', () => {
  const [thu, fri] = resolveDateRange('thursday', undefined, now);
  assert.equal(thu.getDate(), 5); assert.equal(fri.getDate(), 6);
  const [mon, end] = resolveDateRange('next week', undefined, now);
  assert.equal(mon.getDate(), 9); assert.equal(end.getDate(), 16);
  assert.equal(resolveDateRange('today', undefined, now)[0].getHours(), 0);
  for (const date of ['2026-02-30', 'garbage', '2026-13-01']) assert.throws(() => resolveDateRange(date, undefined, now));
  assert.throws(() => resolveDateRange('2026-01-01', '2027-01-01', now));
  assert.throws(() => resolveDateRange('today', 'today', now));
});

test('free time unions busy events, clips range, respects all-day and excludes the past', () => {
  const d = h => new Date(2026, 10, 4, h);
  const events = [{ start: d(9), end: d(10) }, { start: d(9), end: d(11) }, { start: d(12), end: d(13) }];
  const slots = findFreeTime(events, [d(0), new Date(2026, 10, 5)], 60, {}, d(10).getTime());
  assert.equal(slots[0].start, d(11).toISOString());
  assert.equal(slots[1].start, d(13).toISOString());
  assert.equal(findFreeTime([{ start: d(0), end: new Date(2026, 10, 5), allDay: true }], [d(0), new Date(2026, 10, 5)], 60, {}, now).length, 0);
  assert.throws(() => findFreeTime([], [d(0), d(23)], 0, {}, now));
  assert.throws(() => findFreeTime([], [d(0), d(23)], 60, { start: '29:00' }, now));
  const night = findFreeTime([], [d(0), new Date(2026, 10, 5, 6)], 60, { start: '22:00', end: '06:00' }, now);
  assert.equal(night[0].start, d(22).toISOString());
});

test('search_events matches words in descriptions and returns an excerpt', async () => {
  const ev = (uid, title, desc) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DESCRIPTION:' + desc, 'DTSTART:20261105T090000', 'DTEND:20261105T100000', 'END:VEVENT'];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...ev('a', 'Budget review', 'Discuss the vendor contract renewal'), ...ev('b', 'Lunch', 'Pizza'), 'END:VCALENDAR'].join('\r\n');
  const tools = createCalendarTools({ sources: async () => [{ alertKey: 'l:t', name: 'T', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  assert.equal((await tools.execute('search_events', { query: 'vendor contracts' })).total, 1);
  assert.equal((await tools.execute('search_events', { query: 'payroll' })).total, 0);
  const hit = await tools.execute('search_events', { query: 'Vendor contr' });
  assert.equal(hit.total, 1); assert.match(hit.events[0].description_excerpt, /vendor contract/);
});

test('shared tools validate flat arguments and expose assistant-only availability', async () => {
  const tools = createCalendarTools({ sources: async () => [], now: () => now });
  assert.equal(TOOLS.length, 5);
  assert.equal((await tools.execute('list_events', { start: 'thursday' })).events.length, 0);
  assert.ok((await tools.execute('find_free_time', { start: 'this week', minutes: 60 })).slots.length);
  for (const [name, args] of [['list_events', { query: {} }], ['up_next', { limit: '2' }], ['list_events', { unexpected: 1 }], ['toString', {}]]) {
    await assert.rejects(tools.execute(name, args));
  }
});

test('tool dispatch and argument schemas reject prototype names before accessing calendars', async () => {
  let reads = 0;
  const tools = createCalendarTools({ sources: async () => { reads++; return []; } });
  for (const name of ['constructor', '__proto__', 'valueOf', 'hasOwnProperty', '__defineSetter__']) await assert.rejects(tools.execute(name, {}), /Unknown tool/);
  for (const key of ['constructor', '__proto__', 'toString']) {
    await assert.rejects(tools.execute('list_events', JSON.parse('{"' + key + '":"x"}')), /Invalid argument/);
  }
  assert.equal(reads, 0);
});

test('shared ranges exclude touching boundaries and cancelled titles', async () => {
  const events = [
    ['before', 'Before', '20261104T230000Z', '20261105T000000Z'],
    ['during', 'During', '20261105T090000Z', '20261105T100000Z'],
    ['after', 'After', '20261106T000000Z', '20261106T010000Z'],
    ['cancel', 'Cancelled: no meeting', '20261105T110000Z', '20261105T120000Z']
  ].flatMap(([uid, title, start, end]) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DTSTART:' + start, 'DTEND:' + end, 'END:VEVENT']);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...events, 'END:VCALENDAR'].join('\r\n');
  const tools = createCalendarTools({ sources: async () => [{ alertKey: 'l:test', name: 'Test', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  const result = await tools.execute('list_events', { start: '2026-11-05T00:00:00Z', end: '2026-11-06T00:00:00Z' });
  assert.deepEqual(result.events.map(e => e.uid), ['during']);
  await assert.rejects(tools.execute('list_events', { start: '2026-02-20T00:00:00Z', end: '2026-02-30T00:00:00Z' }));
});

test('MCP retains its seven-day default for ISO date-only starts', async () => {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', 'UID:nextday', 'SUMMARY:Next day', 'DTSTART:20261106T090000Z', 'DTEND:20261106T100000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const mcp = createMcpHandler({ sources: async () => [{ alertKey: 'l:test', name: 'Test', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  const response = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_events', arguments: { start: '2026-11-05' } } });
  assert.equal(JSON.parse(response.result.content[0].text).events[0].uid, 'nextday');
});

test('free time supports overnight carry-in, touching meetings, weekends and slot cap', () => {
  const d = (day, hour) => new Date(2026, 10, day, hour);
  const slots = findFreeTime([{ start: d(4, 9), end: d(4, 10) }, { start: d(4, 10), end: d(4, 11) }], [d(4, 9), d(4, 12)], 60, {}, d(4, 0));
  assert.equal(slots.length, 1); assert.equal(slots[0].start, d(4, 11).toISOString());
  const night = findFreeTime([], [d(5, 0), d(5, 6)], 60, { start: '22:00', end: '06:00' }, d(5, 0));
  assert.equal(night[0].start, d(5, 0).toISOString());
  assert.equal(findFreeTime([], [d(7, 0), d(9, 0)], 60, {}, d(7, 0)).length, 0);
  assert.equal(findFreeTime([], [d(4, 0), new Date(2027, 0, 1)], 60, {}, now).length, 20);
});

test('get_working_hours reports the hours given, including overnight length', async () => {
  const tools = createCalendarTools({ sources: async () => [] });
  const r = await tools.execute('get_working_hours', { work_start: '22:00', work_end: '06:30' });
  assert.equal(r.overnight, true); assert.equal(r.length, '8 hours 30 minutes');
  assert.equal((await tools.execute('get_working_hours', {})).length, '8 hours 0 minutes');
});

test('insight tools compute busy time, gaps, next slot, countdowns, all-day and series in code', async () => {
  const ev = (uid, title, start, end, extra = []) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, ...start, ...end, ...extra, 'END:VEVENT'];
  const t = (day, hhmm) => ['DTSTART:202611' + day + 'T' + hhmm + '00'], e = (day, hhmm) => ['DTEND:202611' + day + 'T' + hhmm + '00'];
  const lines = [
    ...ev('a', 'Alpha', t('05', '0900'), e('05', '1000')), ...ev('b', 'Beta', t('05', '0930'), e('05', '1100')), ...ev('c', 'Gamma', t('05', '1400'), e('05', '1500')),
    ...ev('d', 'Holiday', ['DTSTART;VALUE=DATE:20261105'], ['DTEND;VALUE=DATE:20261106']),
    ...ev('s', 'Standup', t('06', '0800'), e('06', '0815'), ['RRULE:FREQ=DAILY;COUNT=3'])];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...lines, 'END:VCALENDAR'].join('\r\n');
  const tools = createCalendarTools({ sources: async () => [{ alertKey: 'l:test', name: 'Test', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  const day = await tools.execute('day_summary', { start: '2026-11-05' });
  assert.equal(day.events, 3); assert.equal(day.all_day_events, 1); assert.equal(day.busy_minutes, 180);
  assert.equal(new Date(day.longest_gap_between_events.start).getHours(), 11); assert.equal(new Date(day.longest_gap_between_events.end).getHours(), 14);
  const slot = await tools.execute('next_free_slot', { minutes: 60 });
  assert.equal(new Date(slot.slot.start).getHours(), 9); assert.equal(new Date(slot.slot.start).getDate(), 4);
  const next = await tools.execute('time_until', { query: 'alpha' });
  assert.equal(next.title, 'Alpha'); assert.equal(next.minutes_until_start, 25 * 60);
  assert.equal((await tools.execute('time_until', { query: 'nothing-matches' })).note.slice(0, 2), 'No');
  assert.equal((await tools.execute('list_all_day', { start: '2026-11-05', end: '2026-11-06' })).events[0].title, 'Holiday');
  assert.equal((await tools.execute('search_events', { query: 'gamma' })).total, 1);
  const series = (await tools.execute('recurring_summary', { query: 'standup' })).series[0];
  assert.equal(series.occurrences, 3); assert.equal(series.repeats, true);
  const busy = await tools.execute('busiest_day', { start: '2026-11-05', end: '2026-11-07' });
  assert.equal(busy.busiest.date, '2026-11-05'); assert.equal(busy.lightest.date, '2026-11-06');
  await assert.rejects(tools.execute('search_events', { query: '' }));
});

test('proposal text lists the chosen times and the second zone', () => {
  assert.equal(proposalText(30, '', []), '');
  assert.equal(proposalText(45, 'Asia/Manila', [{ when: 'Mon 9:00', alt: 'Sun 21:00 (UTC)' }, { when: 'Tue 10:00' }]),
    'I am free for 45 minutes at these times (Asia/Manila):\n- Mon 9:00  /  Sun 21:00 (UTC)\n- Tue 10:00');
  assert.match(proposalText(30, '', [{ when: 'x' }]), /\(my local time\)/);
});
