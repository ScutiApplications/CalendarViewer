const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/shared/insights.js');

const at = (day, hm) => new Date(2026, 10, day, ...hm.split(':').map(Number)); // November 2026; the 9th is a Monday
const ev = (title, day, from, to, extra = {}) => ({ title, start: at(day, from), end: at(day, to), allDay: false, extendedProps: {}, ...extra });
const hours = { start: '09:00', end: '17:00' };
const day = n => [at(n, '00:00'), at(n + 1, '00:00')];

test('freeBlocks returns whole gaps of at least the length, inside working hours', () => {
  const events = [ev('A', 9, '10:00', '11:00'), ev('B', 9, '15:00', '16:00')];
  const blocks = I.freeBlocks(events, day(9), 120, hours, +at(9, '00:00'));
  assert.deepEqual(blocks.map(b => [b.start.getHours(), b.end.getHours()]), [[11, 15]]);
  assert.equal(I.freeBlocks(events, day(9), 60, hours, +at(9, '00:00')).length, 3);
});

test('freeBlocks skips weekends and the past', () => {
  assert.equal(I.freeBlocks([], [at(14, '00:00'), at(16, '00:00')], 30, hours, +at(14, '00:00')).length, 0);
  const blocks = I.freeBlocks([], day(9), 30, hours, +at(9, '13:00'));
  assert.equal(blocks[0].start.getHours(), 13);
  assert.equal(blocks[0].end.getHours(), 17);
});

test('overlapPairs lists clashes and ignores cancelled and all-day events', () => {
  const events = [ev('A', 9, '10:00', '11:00'), ev('B', 9, '10:30', '11:30'), ev('Cancelled: C', 9, '10:00', '12:00'),
    ev('Leave', 9, '00:00', '23:00', { allDay: true }), ev('D', 9, '12:00', '13:00')];
  const pairs = I.overlapPairs(events);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].first.title, pairs[0].second.title], ['A', 'B']);
  assert.equal(pairs[0].start.getMinutes(), 30);
  assert.equal(pairs[0].end.getHours(), 11);
});

test('busyMinutes counts overlapping meetings once', () => {
  assert.equal(I.busyMinutes([ev('A', 9, '10:00', '11:00'), ev('B', 9, '10:30', '11:30')]), 90);
  assert.equal(I.busyMinutes([]), 0);
});

test('weekSummary reports meetings, busiest day, longest free block and overlaps', () => {
  const events = [ev('A', 9, '10:00', '12:00'), ev('B', 9, '11:00', '13:00'), ev('C', 10, '09:00', '10:00'), ev('Off', 11, '00:00', '23:00', { allDay: true })];
  const s = I.weekSummary(events, [at(9, '00:00'), at(16, '00:00')], hours, +at(9, '00:00'));
  assert.equal(s.meetings, 3);
  assert.equal(s.allDay, 1);
  assert.equal(s.meetingMinutes, 180 + 60);
  assert.equal(s.overlaps, 1);
  assert.equal(s.busiest.date.getDate(), 9);
  assert.equal(s.busiest.minutes, 180);
  assert.equal(s.days.length, 7);
  assert.equal(s.longestFree.minutes, 480);
});

test('weekSummary with no events has no busiest day', () => {
  const s = I.weekSummary([], [at(9, '00:00'), at(16, '00:00')], hours, 0);
  assert.equal(s.meetings, 0);
  assert.equal(s.busiest, null);
});

test('joinableNow finds a running or imminent meeting that has a link', () => {
  const url = event => (event.title === 'Standup' ? { href: 'https://teams.microsoft.com/l/meetup-join/x' } : null);
  const events = [ev('Lunch', 9, '12:00', '13:00'), ev('Standup', 9, '10:05', '10:30')];
  assert.equal(I.joinableNow(events, +at(9, '10:00'), 10 * 60000, url).event.title, 'Standup');
  assert.equal(I.joinableNow(events, +at(9, '09:00'), 10 * 60000, url), null);
  assert.equal(I.joinableNow(events, +at(9, '10:31'), 10 * 60000, url), null);
  assert.equal(I.joinableNow([ev('Cancelled: Standup', 9, '10:00', '10:30')], +at(9, '10:00'), 0, () => ({})), null);
});

test('minutesText formats hours and minutes', () => {
  assert.equal(I.minutesText(0), '0 min');
  assert.equal(I.minutesText(45), '45 min');
  assert.equal(I.minutesText(120), '2 h');
  assert.equal(I.minutesText(150), '2 h 30 min');
});
