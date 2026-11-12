const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Execute the real page refresh functions with controlled HTTP and rendering boundaries.
const app = fs.readFileSync(path.join(__dirname, '../src/web/js/feeds.js'), 'utf8');
const functionCode = (start, end) => app.slice(app.indexOf(start), end === undefined ? undefined : app.indexOf(end, app.indexOf(start)));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('a completed feed updates immediately even while another feed is still loading', async () => {
  const slow = deferred();
  let time = 1000000;
  const context = vm.createContext({
    sources: [], nextId: 1, feedPreference: () => ({}), Date: class extends Date { static now() { return time; } },
    apiJson: async () => [{ id: 'fast', name: 'Fast' }, { id: 'slow', name: 'Slow' }],
    api: async url => ({ text: async () => url.endsWith('/slow') ? slow.promise : 'fast ICS' }),
    parseIcs: text => [text],
    updateSourceHealth() {},
    renderSources() {}, calendar: { refetchEvents() {} }, runAlertCheck() {}, scheduleAlertSync() {},
    cacheFeedSnapshot() {}, readFeedCache: () => [], writeFeedCache() {}, setSyncState() {}, setStatus() {}, CLOCK: {}
  });
  vm.runInContext(functionCode('async function fetchFeeds()'), context);
  const done = context.fetchFeeds();
  // Drain the finite chain of immediately resolved HTTP and parse promises.
  await new Promise(resolve => setImmediate(resolve));
  const fast = context.sources.find(s => s.feedId === 'fast');
  assert.equal(fast.fetching, false);
  assert.equal(fast.fetchedAt, 1000000);
  assert.equal(fast.events[0], 'fast ICS');
  time += 20 * 60000;
  slow.resolve('slow ICS');
  await done;
  assert.equal(fast.fetchedAt, 1000000, 'a slower feed must not redate another feed snapshot');
});

test('refresh requests during a batch coalesce into one follow-up for newly added feeds', async () => {
  const pending = deferred();
  let calls = 0;
  const context = vm.createContext({
    pendingRefreshes: 0, restoringBackup: false, refreshQueued: false, skeleton: {}, syncStrip: { dataset: { state: 'ok' } },
    document: { querySelector: () => ({ classList: { add() {}, remove() {} } }) }, calBox: { setAttribute() {} },
    setStatus() {}, setSyncState() {}, fetchFeeds: async () => { calls++; await pending.promise; }
  });
  vm.runInContext(functionCode('async function loadFeeds()', '\nasync function fetchFeeds()'), context);
  const first = context.loadFeeds();
  const second = context.loadFeeds();
  const third = context.loadFeeds();
  assert.equal(calls, 1);
  pending.resolve();
  await Promise.all([first, second, third]);
  assert.equal(calls, 2, 'the queued batch reloads the feed list after the current batch');
  assert.equal(context.pendingRefreshes, 0);
});
