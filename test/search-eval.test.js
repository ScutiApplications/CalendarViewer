// Retrieval eval: real questions, fixed calendar, expected top event. Add a row whenever the assistant misses.
const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const logic = require('../src/shared/alert-logic');
const { createCalendarTools } = require('../src/server/calendar-tools');
const now = new Date(2026, 10, 4, 8).getTime();

const EVENTS = [
  ['budget', 'Budget review', 'Discuss the vendor contract renewal', 'Room 4', 'Dana Cole'],
  ['lunch', 'Team lunch', 'Pizza at the vendor cafe', '', ''],
  ['dentist', 'Dentist', 'Teeth cleaning', 'Smile Clinic', ''],
  ['onboard', 'Onboarding session', 'New hire welcome', 'Room 2', 'Sam Rivera'],
  ['retro', 'Sprint retrospective', 'What went well', '', 'Sam Rivera']
];
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...EVENTS.flatMap(([uid, title, desc, loc, who], i) => [
  'BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DESCRIPTION:' + desc, ...(loc ? ['LOCATION:' + loc] : []),
  ...(who ? [`ATTENDEE;CN=${who}:mailto:x@example.com`] : []), `DTSTART:2026110${5 + i}T090000`, `DTEND:2026110${5 + i}T100000`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const tools = createCalendarTools({ sources: async () => [{ alertKey: 'l:t', name: 'T', enabled: true, events: logic.parseIcs(ics) }], now: () => now });

const CASES = [
  ['budget review', 'budget'], ['vendor contracts', 'budget'], ['dentst', 'dentist'], ['when is the budget review', 'budget'], ['what is the dentist appointment', 'dentist'], ['vendor payroll', 'budget'], ['meetings with Sam', 'onboard'], ['Sam Rivera', 'onboard'], ['Dana', 'budget'], ['room 2', 'onboard']
];
for (const [query, top] of CASES) {
  test(`retrieval: "${query}"`, async () => {
    const out = await tools.execute('search_events', { query });
    if (top === null) return assert.equal(out.total, 0);
    assert.equal(out.events[0].uid, top);
  });
}
test('title hit outranks description hit', async () => {
  const out = await tools.execute('search_events', { query: 'lunch vendor' });
  assert.equal(out.events[0].uid, 'lunch');
  const ranked = await tools.execute('search_events', { query: 'retrospective' });
  assert.equal(ranked.events[0].uid, 'retro');
});
test('typo fallback only runs when strict search finds nothing', async () => {
  assert.equal((await tools.execute('search_events', { query: 'budgt' })).events[0].uid, 'budget');
  assert.equal((await tools.execute('search_events', { query: 'zebra' })).total, 0);
  assert.equal((await tools.execute('search_events', { query: 'vendor' })).total, 2);
});
