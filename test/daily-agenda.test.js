const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const L = require('../src/shared/alert-logic.js');
const { createAlertService } = require('../src/server/alerts.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const at = (h, m = 0) => new Date(2026, 0, 14, h, m).getTime(); // a Wednesday
const rulesWith = daily => L.sanitizeRules({ global: { muted: false, daily } });

test('daily settings are kept only when used, so default rules are unchanged', () => {
  assert.deepEqual(L.sanitizeRules({}).global, { muted: false });
  assert.deepEqual(L.sanitizeRules({ global: { daily: { enabled: false, time: '08:30' } } }).global, { muted: false });
  assert.deepEqual(rulesWith({ enabled: true, time: '07:15' }).global.daily, { enabled: true, time: '07:15' });
  assert.deepEqual(rulesWith({ enabled: true, time: 'nonsense' }).global.daily, { enabled: true, time: '08:30' });
  assert.deepEqual(rulesWith({ enabled: false, time: '06:00' }).global.daily, { enabled: false, time: '06:00' });
});

test('the summary is due after the set time, once a day, and not much later', () => {
  const rules = rulesWith({ enabled: true, time: '08:30' }), fired = {};
  assert.equal(L.dailyAgendaDue(rules, at(8, 29), fired), null);
  const key = L.dailyAgendaDue(rules, at(8, 31), fired);
  assert.equal(key, 'daily:2026-01-14');
  fired[key] = at(8, 31);
  assert.equal(L.dailyAgendaDue(rules, at(9, 0), fired), null);
  assert.equal(L.dailyAgendaDue(rules, at(12, 0), {}), null, 'a server that starts after the window skips the day');
  assert.equal(L.dailyAgendaDue(rulesWith({ enabled: false, time: '08:30' }), at(8, 31), {}), null);
});

test('summary text lists the next events, all-day events and the remainder', () => {
  const now = at(8, 30);
  const o = (title, start, extra = {}) => ({ title, start, allDay: false, ...extra });
  const text = L.dailyAgendaText([
    o('Holiday', at(0), { allDay: true }), o('Standup', at(9)), o('Review', at(10)), o('Lunch', at(12)), o('Retro', at(15)),
    o('Cancelled: Sync', at(11)), o('Tomorrow', at(24, 30))
  ], now);
  assert.equal(text.title, 'Today: 5 events');
  const lines = text.body.split('\n');
  assert.equal(lines[0], 'All day: Holiday');
  assert.match(lines[1], /Standup$/);
  assert.equal(lines.at(-1), '+1 more');
});

test('an empty day says so', () => {
  assert.deepEqual(L.dailyAgendaText([], at(8, 30)), { title: 'Today: no events', body: 'Your calendar is clear.' });
});

test('the alert service sends the summary once, in the window', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-daily-'));
  try {
    let clock = at(8, 31);
    const sent = [];
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'BEGIN:VEVENT', 'UID:s', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Standup',
      'DTSTART:' + new Date(at(9)).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), 'DTEND:' + new Date(at(10)).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const service = createAlertService({
      readFeeds: () => [], fetchText: async () => '', notify: (occ, body) => sent.push({ title: occ.title, body }),
      stateFile: path.join(dir, 'state.json'), firedFile: path.join(dir, 'fired.json'), now: () => clock, log: () => {}
    });
    service.setState({ rules: { global: { daily: { enabled: true, time: '08:30' } } }, sources: [{ alertKey: 'l:1', name: 'Local', enabled: true, icsText: text }] });
    await service.tick();
    await service.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Today: 1 event');
    assert.match(sent[0].body, /Standup/);
    clock = at(8, 31) + 24 * 3600000;
    await service.tick();
    assert.equal(sent.length, 2, 'the next day sends again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Weekly summary ----
const weekRules = weekly => L.sanitizeRules({ global: { muted: false, weekly } });
const I = require('../src/shared/insights.js');

test('weekly settings are kept only when used and are validated', () => {
  assert.deepEqual(L.sanitizeRules({ global: { weekly: { enabled: false, day: 1, time: '08:30' } } }).global, { muted: false });
  assert.deepEqual(weekRules({ enabled: true, day: 5, time: '07:00' }).global.weekly, { enabled: true, day: 5, time: '07:00' });
  assert.deepEqual(weekRules({ enabled: true, day: 9, time: 'bad' }).global.weekly, { enabled: true, day: 1, time: '08:30' });
});

test('the weekly summary is due once, on its day and inside the window', () => {
  const rules = weekRules({ enabled: true, day: 1, time: '08:30' });
  const monday = h => new Date(2026, 0, 12, h, 31).getTime(); // 12 January 2026 is a Monday
  const fired = {};
  assert.equal(L.weeklyAgendaDue(rules, new Date(2026, 0, 12, 8, 29).getTime(), fired), null);
  const key = L.weeklyAgendaDue(rules, monday(8), fired);
  assert.equal(key, 'weekly:2026-01-12');
  fired[key] = 1;
  assert.equal(L.weeklyAgendaDue(rules, monday(9), fired), null);
  assert.equal(L.weeklyAgendaDue(rules, monday(13), {}), null, 'outside the window');
  assert.equal(L.weeklyAgendaDue(rules, new Date(2026, 0, 13, 8, 31).getTime(), {}), null, 'wrong weekday');
  assert.equal(L.weeklyAgendaDue(weekRules({ enabled: false, day: 1, time: '08:30' }), monday(8), {}), null);
});

test('weekNotification words the summary briefly', () => {
  const day = d => new Date(2026, 0, d);
  const summary = { meetings: 3, meetingMinutes: 150, overlaps: 1, allDay: 0, busiest: { date: day(13), minutes: 90 } };
  const text = I.weekNotification(summary);
  assert.equal(text.title, 'Week ahead: 3 meetings');
  assert.match(text.body, /Time in meetings: 2 h 30 min/);
  assert.match(text.body, /1 overlap$/);
  assert.deepEqual(I.weekNotification({ meetings: 0, meetingMinutes: 0, overlaps: 0, allDay: 0, busiest: null }), { title: 'Week ahead: no meetings', body: 'Your calendar is clear.' });
});

test('the alert service sends the weekly summary once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-weekly-'));
  try {
    let clock = new Date(2026, 0, 12, 8, 31).getTime();
    const sent = [];
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const start = new Date(2026, 0, 13, 9).getTime();
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'BEGIN:VEVENT', 'UID:w', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Review',
      'DTSTART:' + stamp(start), 'DTEND:' + stamp(start + 3600000), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const service = createAlertService({
      readFeeds: () => [], fetchText: async () => '', notify: (occ, body) => sent.push({ title: occ.title, body }),
      stateFile: path.join(dir, 'state.json'), firedFile: path.join(dir, 'fired.json'), now: () => clock, log: () => {}
    });
    service.setState({ rules: { global: { weekly: { enabled: true, day: 1, time: '08:30' } } }, sources: [{ alertKey: 'l:1', name: 'Local', enabled: true, icsText: text }] });
    await service.tick();
    await service.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Week ahead: 1 meeting');
    assert.match(sent[0].body, /Time in meetings: 1 h/);
    clock += 7 * 24 * 3600000;
    await service.tick();
    assert.equal(sent.length, 2, 'the next week sends again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
