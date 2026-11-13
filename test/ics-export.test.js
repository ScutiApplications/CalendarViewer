const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const L = require('../src/shared/alert-logic.js');
const { buildIcs, escapeText } = require('../src/shared/ics-export.js');

const timed = { title: 'Plan, review; ship', start: new Date('2026-01-20T10:00:00Z'), end: new Date('2026-01-20T11:00:00Z'), allDay: false,
  extendedProps: { uid: 'u1', location: 'Room 1', description: 'Line one\nLine two' } };

test('escapeText escapes backslash, semicolon, comma and newline', () => {
  assert.equal(escapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
});

test('exported events read back with the same title, times and location', () => {
  const text = buildIcs([timed], new Date('2026-01-01T00:00:00Z'));
  const [event] = L.parseIcs(text);
  assert.equal(event.summary, 'Plan, review; ship');
  assert.equal(event.startDate.toJSDate().toISOString(), '2026-01-20T10:00:00.000Z');
  assert.equal(event.endDate.toJSDate().toISOString(), '2026-01-20T11:00:00.000Z');
  assert.equal(event.location, 'Room 1');
  assert.equal(event.description, 'Line one\nLine two');
});

test('all-day events keep date values', () => {
  const allDay = { title: 'Holiday', start: new Date(2026, 0, 20), end: new Date(2026, 0, 21), allDay: true, extendedProps: { uid: 'u2' } };
  const text = buildIcs([allDay]);
  assert.match(text, /DTSTART;VALUE=DATE:20260120/);
  assert.match(text, /DTEND;VALUE=DATE:20260121/);
  assert.equal(L.parseIcs(text)[0].startDate.isDate, true);
});

test('occurrences of one series get distinct UIDs', () => {
  const second = { ...timed, start: new Date('2026-01-27T10:00:00Z'), end: new Date('2026-01-27T11:00:00Z') };
  assert.equal(L.parseIcs(buildIcs([timed, second])).length, 2);
});

test('long lines are folded to 75 octets and still parse', () => {
  const long = { ...timed, title: 'é'.repeat(120) };
  const text = buildIcs([long]);
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(L.parseIcs(text)[0].summary, 'é'.repeat(120));
});

test('an empty list still gives a valid calendar', () => {
  assert.equal(L.parseIcs(buildIcs([])).length, 0);
});
