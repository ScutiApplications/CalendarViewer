const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const L = require('../src/shared/alert-logic.js');

const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const source = (text, extra = {}) => ({ id: 1, name: 'Work', alertKey: 'f:1', color: '#5B5FC7', enabled: true, events: L.parseIcs(text), ...extra });
const expand = (text, from, to) => L.expandSources([source(text)], new Date(from), new Date(to));
const iso = e => e.start.toISOString();

const NEW_YORK = [
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE'
].join('\r\n');

test('weekly event skips an EXDATE', () => {
  const text = ics(vevent('UID:a', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Standup', 'DTSTART:20260105T140000Z', 'DTEND:20260105T143000Z',
    'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20260112T140000Z'));
  const got = expand(text, '2026-01-01T00:00:00Z', '2026-02-28T00:00:00Z').map(iso);
  assert.deepEqual(got, ['2026-01-05T14:00:00.000Z', '2026-01-19T14:00:00.000Z', '2026-01-26T14:00:00.000Z']);
});

test('RECURRENCE-ID override moves one occurrence and keeps the others', () => {
  const text = ics(
    vevent('UID:b', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Review', 'DTSTART:20260105T150000Z', 'DTEND:20260105T160000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    vevent('UID:b', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Review (moved)', 'RECURRENCE-ID:20260112T150000Z', 'DTSTART:20260112T170000Z', 'DTEND:20260112T180000Z'));
  const got = expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z').map(e => [e.title, iso(e)]);
  assert.deepEqual(got, [
    ['Review', '2026-01-05T15:00:00.000Z'],
    ['Review (moved)', '2026-01-12T17:00:00.000Z'],
    ['Review', '2026-01-19T15:00:00.000Z']
  ]);
});

test('a cancelled override removes only that occurrence', () => {
  const text = ics(
    vevent('UID:c', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Sync', 'DTSTART:20260105T150000Z', 'DTEND:20260105T160000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    vevent('UID:c', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Sync', 'RECURRENCE-ID:20260112T150000Z', 'DTSTART:20260112T150000Z', 'DTEND:20260112T160000Z', 'STATUS:CANCELLED'));
  assert.deepEqual(expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z').map(iso), ['2026-01-05T15:00:00.000Z', '2026-01-19T15:00:00.000Z']);
});

test('a TZID event keeps its wall-clock time across the US daylight-saving change', () => {
  const text = ics(NEW_YORK, vevent('UID:d', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Daily', 'DTSTART;TZID=America/New_York:20260307T090000',
    'DTEND;TZID=America/New_York:20260307T093000', 'RRULE:FREQ=DAILY;COUNT=3'));
  const got = expand(text, '2026-03-01T00:00:00Z', '2026-03-20T00:00:00Z').map(iso);
  // 09:00 EST is 14:00Z; after 8 March 2026 it is 09:00 EDT, 13:00Z.
  assert.deepEqual(got, ['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z']);
});

test('an all-day event is flagged and spans its dates', () => {
  const text = ics(vevent('UID:e', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260120', 'DTEND;VALUE=DATE:20260122'));
  const [event] = expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
  assert.equal(event.allDay, true);
  assert.equal(event.title, 'Holiday');
  assert.ok(event.end > event.start);
});

test('an event without DTEND still appears', () => {
  const text = ics(vevent('UID:f', 'DTSTAMP:20260101T000000Z', 'SUMMARY:No end', 'DTSTART:20260120T100000Z'));
  assert.equal(expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z').length, 1);
});

test('an event with a DURATION instead of DTEND has the right end', () => {
  const text = ics(vevent('UID:g', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Duration', 'DTSTART:20260120T100000Z', 'DURATION:PT45M'));
  const [event] = expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
  assert.equal(event.end - event.start, 45 * 60000);
});

test('the same UID from two calendars shows once with both sources', () => {
  const text = ics(vevent('UID:h', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Shared', 'DTSTART:20260120T100000Z', 'DTEND:20260120T110000Z'));
  const a = source(text, { id: 1, name: 'Work', alertKey: 'f:1' });
  const b = source(text, { id: 2, name: 'Client', alertKey: 'f:2' });
  const events = L.expandSources([a, b], new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].extendedProps.sourceDetails.map(s => s.name), ['Work', 'Client']);
});

test('a disabled source contributes nothing', () => {
  const text = ics(vevent('UID:i', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Hidden', 'DTSTART:20260120T100000Z', 'DTEND:20260120T110000Z'));
  assert.equal(L.expandSources([source(text, { enabled: false })], new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z')).length, 0);
});

test('an endless daily rule is bounded by the occurrence cap and finishes quickly', () => {
  const text = ics(vevent('UID:j', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Forever', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'RRULE:FREQ=DAILY'));
  const started = Date.now();
  expand(text, '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
  assert.ok(Date.now() - started < 3000);
});

test('a Teams-style event with an Outlook X-MICROSOFT-CDO-BUSYSTATUS line parses', () => {
  const text = ics(vevent('UID:k', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Teams call', 'DTSTART:20260120T100000Z', 'DTEND:20260120T110000Z',
    'X-MICROSOFT-CDO-BUSYSTATUS:BUSY', 'LOCATION:Microsoft Teams Meeting',
    'DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/abc'));
  const [event] = expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
  assert.equal(L.findMeetingUrl(event.extendedProps).hostname, 'teams.microsoft.com');
});

test('a Google-style floating time event parses without a zone', () => {
  const text = ics(vevent('UID:l', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Floating', 'DTSTART:20260120T100000', 'DTEND:20260120T110000'));
  assert.equal(expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z').length, 1);
});

test('overlapping timed events are flagged and back-to-back events are not', () => {
  const text = ics(
    vevent('UID:m1', 'DTSTAMP:20260101T000000Z', 'SUMMARY:A', 'DTSTART:20260120T100000Z', 'DTEND:20260120T110000Z'),
    vevent('UID:m2', 'DTSTAMP:20260101T000000Z', 'SUMMARY:B', 'DTSTART:20260120T103000Z', 'DTEND:20260120T113000Z'),
    vevent('UID:m3', 'DTSTAMP:20260101T000000Z', 'SUMMARY:C', 'DTSTART:20260120T113000Z', 'DTEND:20260120T120000Z'));
  const marked = L.markConflicts(expand(text, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'));
  const conflicts = Object.fromEntries(marked.map(e => [e.title, e.extendedProps.conflicts]));
  assert.deepEqual(conflicts, { A: ['B'], B: ['A'], C: [] });
});

test('feed HTTP failures get plain-language messages', () => {
  const { feedStatusMessage } = require('../src/server/feed-fetch.js');
  assert.match(feedStatusMessage(403), /Link rejected.*new ICS link/);
  assert.match(feedStatusMessage(404), /Link not found/);
  assert.match(feedStatusMessage(429), /rate limiting/);
  assert.match(feedStatusMessage(503), /Calendar service error/);
  assert.equal(feedStatusMessage(418), 'Upstream returned HTTP 418');
});

test('a sign-in web page is detected, a calendar is not', () => {
  const { looksLikeWebPage } = require('../src/server/feed-fetch.js');
  assert.equal(looksLikeWebPage('<!DOCTYPE html><html><body>Sign in</body></html>'), true);
  assert.equal(looksLikeWebPage('﻿  <html lang="en">'), true);
  assert.equal(looksLikeWebPage('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'), false);
  assert.equal(looksLikeWebPage(''), false);
});

test('fetching a feed that answers 200 with HTML reports a sign-in page', async () => {
  const http = require('node:http');
  const { createFeedFetcher } = require('../src/server/feed-fetch.js');
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Sign in</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(createFeedFetcher()({ url: `http://127.0.0.1:${server.address().port}/` }), /web page, not a calendar/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
