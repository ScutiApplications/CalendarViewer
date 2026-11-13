const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Search = require('../src/shared/search');
const { markConflicts, visibleEvents, deduplicateEvents } = require('../src/shared/alert-logic');

test('search trims a case-insensitive literal query across title, location, description and attendees', () => {
  const event = { title: 'Planning [Q4]', extendedProps: { location: 'East ROOM' } };
  assert.equal(Search.matches(event, '  PLANNING  '), true);
  assert.equal(Search.matches(event, 'room'), true);
  assert.equal(Search.matches(event, '[Q4]'), true);
  assert.equal(Search.matches(event, '.*'), false);
  assert.equal(Search.matches(event, 'west'), false);
});

test('empty queries match everything and missing fields remain safe', () => {
  assert.equal(Search.matches({}, '   '), true);
  assert.equal(Search.matches({}, 'room'), false);
  assert.equal(Search.matches({ title: null, extendedProps: { location: null } }, 'null'), false);
  assert.equal(Search.matches({ extendedProps: { description: 'private notes', people: 'Sam Rivera' } }, 'private'), true);
  assert.equal(Search.matches({ extendedProps: { people: 'Sam Rivera' } }, 'rivera'), true);
});

test('browser script exposes the same search behavior', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/search.js'), 'utf8'), context);
  assert.equal(context.CalendarSearch.matches({ title: 'Standup' }, 'stand'), true);
});

test('filtering matches after conflict detection preserves hidden overlaps', () => {
  const start = new Date(2026, 9, 30, 10), end = new Date(2026, 9, 30, 11);
  const events = [{ title: 'Planning', start, end }, { title: 'Standup', start, end }];
  const shown = markConflicts(events).filter(event => Search.matches(event, 'planning'));
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].extendedProps.conflicts, ['Standup']);
});

test('real calendar event pipeline honors calendar and cancellation filters before searching', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/web/js/calendar.js'), 'utf8');
  const start = new Date(2026, 9, 30, 10), end = new Date(2026, 9, 30, 11);
  let status;
  const context = vm.createContext({
    sources: [{ enabled: true, events: [
      { title: 'Planning', start, end, extendedProps: {} }, { title: 'Standup', start, end, extendedProps: {} },
      { title: 'Cancelled planning', start, end, extendedProps: {} }
    ] }, { enabled: false, events: [{ title: 'Hidden planning', start, end, extendedProps: {} }] }],
    expandSources: list => deduplicateEvents(list.filter(s => s.enabled).flatMap(s => s.events)), markConflicts, visibleEvents,
    hideCancelled: true, searchQuery: 'planning', CalendarSearch: Search,
    updateSearchStatus: (matches, total) => { status = { matches, total }; }
  });
  const source = app.slice(app.indexOf('  events(info, ok, fail) {'), app.indexOf('  eventClick({ event })'));
  vm.runInContext('globalThis.fetchEvents = ({' + source + '}).events;', context);
  let shown;
  context.fetchEvents({ start, end }, events => { shown = events; }, error => { throw error; });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Planning');
  assert.deepEqual([...shown[0].extendedProps.conflicts], ['Standup']);
  assert.deepEqual(status, { matches: 1, total: 2 });
});
