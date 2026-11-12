const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createAlertService } = require('../src/server/alerts.js');

const M = 60000;
const fmt = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const ics = (uid, title, start) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(start + 3600000)}\r\nSUMMARY:${title}\r\nDESCRIPTION:https://teams.microsoft.com/l/meetup-join/abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const feedRules = (...offsets) => ({ calendars: { 'f:F1': { enabled: true, offsets } } });
// Lets a test switch the feed fetch offline and back.
function withOutage(options, message) {
  const outage = { on: false };
  const fetchText = async feed => { if (outage.on) throw new Error(message); return options.fetchText(feed); };
  return { outage, flaky: { ...options, fetchText } };
}

function setup(feedStart) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
  const files = { stateFile: path.join(dir, 's.json'), firedFile: path.join(dir, 'f.json') };
  const clock = { t: Date.UTC(2030, 0, 1, 9, 0, 0) };
  const shown = [];
  const feedAt = clock.t + feedStart; // fixed, so later refetches see the same event
  const options = {
    readFeeds: () => [{ id: 'F1', name: 'Work', color: '#2563eb' }],
    fetchText: async () => ics('feed-1', 'Feed meeting', feedAt),
    notify: (occ, body, done) => { shown.push({ title: occ.title, body, join: occ.join }); done(null); },
    now: () => clock.t, log: () => {}, ...files
  };
  // setState starts a background tick; wait twice so the one we asked for has completed.
  const settle = async svc => { await svc.tick(); await svc.tick(); };
  return { svc: createAlertService(options), options, clock, shown, settle };
}

test('feed alert fires once at the offset and never twice', async () => {
  const { svc, clock, shown, settle } = setup(20 * M);
  svc.setState({ rules: feedRules(15), sources: [{ alertKey: 'f:F1', name: 'Work', enabled: true }] });
  await settle(svc);
  assert.equal(shown.length, 0, '20 minutes away, 15 minute offset');
  clock.t += 6 * M; await settle(svc);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Feed meeting');
  assert.equal(new URL(shown[0].join).hostname, 'teams.microsoft.com');
  clock.t += M; await settle(svc);
  assert.equal(shown.length, 1);
});

test('editing rules marks already-past alerts silently', async () => {
  const { svc, clock, shown, settle } = setup(60 * M);
  const local = { alertKey: 'l:x', name: 'Local', enabled: true, icsText: ics('loc-1', 'Local thing', clock.t + 5 * M) };
  svc.setState({ rules: { calendars: { 'l:x': { enabled: true, offsets: [60] } } }, sources: [local] });
  await settle(svc);
  assert.equal(shown.length, 0);
});

test('muted events and disabled calendars stay silent', async () => {
  const { svc, clock, shown, settle } = setup(600 * M);
  svc.setState({ rules: { calendars: { 'l:x': { enabled: true, offsets: [60] } }, events: { 'loc-2': { mode: 'muted' } } },
    sources: [{ alertKey: 'l:x', name: 'Local', enabled: true, icsText: ics('loc-2', 'Muted', clock.t + 40 * M) }] });
  await settle(svc);
  svc.setState({ rules: { calendars: { 'l:y': { enabled: true, offsets: [60] } } },
    sources: [{ alertKey: 'l:y', name: 'Hidden', enabled: false, icsText: ics('h-1', 'Hidden', clock.t + 30 * M) }] });
  await settle(svc);
  assert.equal(shown.length, 0);
});

test('cancelled events stay silent while active events still notify', async () => {
  const { svc, clock, shown, settle } = setup(600 * M);
  const start = clock.t + 20 * M;
  const events = [
    ics('cancel-1', 'Canceled: Sync', start),
    ics('cancel-2', '  CANCELLED: Weekly', start),
    ics('cancel-3', 'Status-only cancellation', start).replace('END:VEVENT', 'STATUS:CANCELLED\r\nEND:VEVENT'),
    ics('active-1', 'Active meeting', start)
  ].map(text => text.split('BEGIN:VEVENT')[1].split('END:VEVENT')[0]);
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\n' +
    events.map(event => 'BEGIN:VEVENT' + event + 'END:VEVENT\r\n').join('') + 'END:VCALENDAR\r\n';
  svc.setState({ rules: { calendars: { 'l:x': { enabled: true, offsets: [15] } } },
    sources: [{ alertKey: 'l:x', name: 'Local', enabled: true, icsText: text }] });
  await settle(svc);
  assert.equal(shown.length, 0);
  clock.t += 6 * M;
  await settle(svc);
  assert.deepEqual(shown.map(event => event.title), ['Active meeting']);
});

test('fired alerts and rules survive a restart', async () => {
  const { svc, options, clock, shown, settle } = setup(20 * M);
  svc.setState({ rules: feedRules(15), sources: [{ alertKey: 'f:F1', name: 'Work', enabled: true }] });
  clock.t += 6 * M; await settle(svc);
  assert.equal(shown.length, 1);
  const again = createAlertService({ ...options, notify: () => assert.fail('alert fired again after restart') });
  await settle(again);
});

test('background sync health retains the last success on failure and clears it on recovery', async () => {
  const { options, clock, settle } = setup(600 * M);
  const { outage, flaky } = withOutage(options, 'Feed unavailable');
  const svc = createAlertService(flaky);
  assert.equal(svc.status().feeds[0].state, 'inactive');
  svc.setState({ rules: feedRules(15), sources: [] });
  await settle(svc);
  const firstSuccess = clock.t;
  assert.equal(svc.status().feeds[0].fetchedAt, firstSuccess);
  assert.equal(svc.status().feeds[0].state, 'current');
  outage.on = true;
  clock.t += 11 * M;
  await settle(svc);
  assert.equal(svc.status().feeds[0].fetchedAt, firstSuccess);
  assert.equal(svc.status().feeds[0].state, 'error');
  outage.on = false;
  await settle(svc);
  assert.equal(svc.status().feeds[0].state, 'current');
  assert.equal(svc.status().feeds[0].fetchedAt, clock.t);
});

test('a snoozed reminder survives restart, suppresses ordinary offsets and fires once', async () => {
  const { svc, options, clock, shown, settle } = setup(40 * M);
  svc.setState({ rules: feedRules(30, 25), sources: [] });
  await settle(svc);
  clock.t += 11 * M;
  await settle(svc);
  assert.equal(shown.length, 1);
  await svc.snooze({ key: 'feed-1', start: clock.t + 29 * M });
  const again = createAlertService(options);
  clock.t += 5 * M;
  await settle(again);
  assert.equal(shown.length, 2, 'one snooze, no duplicate ordinary 25-minute alert');
  assert.equal(again.status().snoozes.deliveries.length, 1);
  await settle(again);
  assert.equal(shown.length, 2);
});

test('cancelled or muted events cannot be snoozed and stop pending snoozes', async () => {
  const { svc, clock, shown, settle } = setup(600 * M);
  const source = { alertKey: 'l:x', name: 'Local', enabled: true, icsText: ics('loc-1', 'Meeting', clock.t + 40 * M) };
  const rules = { calendars: { 'l:x': { enabled: true, offsets: [15] } } };
  svc.setState({ rules, sources: [source] });
  await settle(svc);
  const reference = { key: 'loc-1', start: clock.t + 40 * M };
  await svc.snooze(reference);
  source.icsText = source.icsText.replace('SUMMARY:Meeting', 'SUMMARY:Cancelled: Meeting');
  svc.setState({ rules, sources: [source] });
  await assert.rejects(svc.snooze(reference), /cancelled|inactive/i);
  clock.t += 5 * M;
  await settle(svc);
  assert.equal(shown.length, 0);
  assert.equal(svc.status().snoozes.pending.length, 0);
});

test('a partial state write leaves the previous saved calendars and rules intact', async t => {
  const { svc, options, settle } = setup(600 * M);
  svc.setState({ rules: { global: { muted: true } }, sources: [] });
  await settle(svc);
  const previous = fs.readFileSync(options.stateFile, 'utf8');
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (String(file) === options.stateFile || String(file) === options.stateFile + '.tmp') {
      write(file, '{partial');
      throw new Error('Simulated disk full');
    }
    return write(file, ...args);
  });
  assert.throws(() => svc.setState({ rules: { global: { muted: false } }, sources: [] }), /disk full/);
  assert.equal(fs.readFileSync(options.stateFile, 'utf8'), previous);
  assert.equal(svc.getState().rules.global.muted, true);
});

test('snoozed feed reminders wait for fresh data when refresh fails', async () => {
  const { options, clock, shown, settle } = setup(40 * M);
  const { outage, flaky } = withOutage(options, 'Offline');
  const svc = createAlertService(flaky);
  svc.setState({ rules: feedRules(30), sources: [] });
  await settle(svc);
  await svc.snooze({ key: 'feed-1', start: clock.t + 40 * M });
  outage.on = true;
  clock.t += 5 * M;
  await settle(svc);
  assert.equal(shown.length, 0, 'stale data must not deliver a deferred reminder');
  assert.equal(svc.status().snoozes.pending.length, 1);
  outage.on = false;
  await settle(svc);
  assert.equal(shown.length, 1);
});

test('Windows snooze actions contain a single-use local link', async () => {
  const { options, clock, settle } = setup(40 * M);
  let notification;
  const svc = createAlertService({ ...options, snoozeBaseUrl: 'http://localhost:3987', notify: (occ, _body, done) => { notification = occ; done(null); } });
  svc.setState({ rules: feedRules(30), sources: [] });
  await settle(svc);
  clock.t += 11 * M;
  await settle(svc);
  assert.match(notification.snoozeUrl, /^http:\/\/localhost:3987\/alerts\/snooze\/[a-f0-9]{48}$/);
  const token = notification.snoozeUrl.split('/').pop();
  assert.equal((await svc.snoozeTicket(token)).dueAt, clock.t + 5 * M);
  await assert.rejects(async () => svc.snoozeTicket(token), /used|expired|invalid/i);
});

test('starting without alert rules does not block later feed refreshes', async () => {
  const { svc, settle } = setup(40 * M);
  await svc.tick();
  svc.setState({ rules: feedRules(15), sources: [] });
  await settle(svc);
  assert.equal(svc.status().feeds[0].state, 'current');
});

test('a fresh cancelled duplicate cannot revive a snooze from another stale feed', async () => {
  const { options, clock, shown, settle } = setup(40 * M);
  const start = clock.t + 40 * M;
  let changed = false;
  const svc = createAlertService({ ...options,
    readFeeds: () => [{ id: 'F1', name: 'Stale' }, { id: 'F2', name: 'Fresh' }],
    fetchText: async feed => {
      if (changed && feed.id === 'F1') throw Error('Offline');
      return ics('same', changed ? 'Cancelled: Meeting' : 'Meeting', start);
    }
  });
  svc.setState({ rules: { calendars: { 'f:F1': { enabled: true, offsets: [30] }, 'f:F2': { enabled: true, offsets: [30] } } }, sources: [] });
  await settle(svc);
  await svc.snooze({ key: 'same', start });
  changed = true;
  clock.t += 5 * M;
  await settle(svc);
  assert.equal(shown.length, 0);
  assert.equal(svc.status().snoozes.pending.length, 0);
});
