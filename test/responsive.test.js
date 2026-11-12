const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const layout = require('../src/shared/calendar-layout.js');

test('phones use agenda, tablets and portrait monitors use three days, wide landscape uses desktop', () => {
  for (const [width, height, want] of [[320, 640, 'mobile'], [600, 400, 'mobile'], [601, 400, 'portrait'], [1100, 700, 'portrait'], [1101, 700, 'desktop'], [1200, 1600, 'portrait']]) {
    assert.equal(layout.mode(width, height), want);
  }
  assert.equal(layout.view('mobile', null), 'listDay');
  assert.equal(layout.view('portrait', null), 'timeGridThreeDay');
  assert.equal(layout.view('desktop', null), 'timeGridWorkWeek');
});

test('saved view choices cannot force a desktop grid onto a phone or overwrite desktop preferences', () => {
  assert.equal(layout.view('mobile', 'timeGridWeek'), 'listDay');
  assert.equal(layout.view('mobile', 'timeGridDay'), 'timeGridDay');
  assert.equal(layout.view('portrait', 'listWeek'), 'listWeek');
  assert.equal(layout.view('desktop', 'dayGridMonth'), 'dayGridMonth');
  assert.equal(layout.view('desktop', 'listDay'), 'timeGridWorkWeek');
  assert.equal(layout.viewKey('desktop', 'view'), 'view');
  assert.equal(layout.viewKey('mobile', 'view'), 'view.mobile');
  assert.equal(layout.viewKey('portrait', 'view'), 'view.portrait');
});

test('initial browser state restores the view for the current layout, leaving desktop preference intact', () => {
  const values = new Map([['ics-calendar-viewer.view.v1', 'dayGridMonth']]);
  const context = vm.createContext({
    CalendarLayout: layout, window: { innerWidth: 390, innerHeight: 844 },
    store: { get: key => values.get(key), json: (_, fallback) => fallback },
    document: { getElementById: () => ({}) }, sanitizeRules: x => x,
    VIEWS: ['timeGridDay', 'timeGridWorkWeek', 'timeGridWeek', 'dayGridMonth', 'listWeek', 'listDay', 'timeGridThreeDay']
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/web/js/state.js'), 'utf8'), context);
  assert.equal(vm.runInContext('initialView', context), 'listDay');
  assert.equal(values.get('ics-calendar-viewer.view.v1'), 'dayGridMonth');
});

test('backup restore replaces stale compact preferences and adapts the restored view to each screen', () => {
  const values = new Map([['view.mobile', 'listDay'], ['view.portrait', 'listWeek']]);
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = vm.createContext({
    CalendarLayout: layout, CalendarBackup: require('../src/shared/backup'), CalendarStorage: require('../src/shared/storage'),
    CalendarBackupUI: { init() {} }, localStorage, apiAction() {},
    LOCAL_SOURCES_KEY: 'local', FEED_PREFERENCES_KEY: 'feeds', FEED_CACHE_KEY: 'cache', ALERT_RULES_KEY: 'rules',
    THEME_KEY: 'theme', HOURS_KEY: 'hours', AUTO_REFRESH_KEY: 'refresh', HIDE_CANCELLED_KEY: 'cancelled', VIEW_KEY: 'view'
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/web/js/backup-glue.js'), 'utf8'), context);
  const backup = { format: 'ics-calendar-viewer-backup', version: 1, createdAt: '2026-11-04T00:00:00.000Z', feeds: [], localSources: [], feedPreferences: [],
    alertRules: { global: { muted: false }, calendars: {}, events: {} },
    preferences: { theme: 'system', workingHours: { start: '08:00', end: '18:00' }, autoRefreshMinutes: 5, hideCancelled: false, view: 'timeGridDay' } };
  context.applyBackupClientState(backup, { validateOnly: true });
  assert.equal(values.get('view.mobile'), 'listDay', 'preflight cannot change preferences');
  context.applyBackupClientState(backup);
  assert.equal(values.get('view.mobile'), 'timeGridDay');
  assert.equal(values.get('view.portrait'), 'timeGridThreeDay');
  assert.equal(values.get('view'), 'timeGridDay');
  backup.preferences.view = 'listDay';
  context.applyBackupClientState(backup);
  assert.equal(values.get('view.mobile'), 'listDay');
  assert.equal(values.get('view'), 'timeGridWorkWeek', 'phone-only views must not become desktop preferences');
});
