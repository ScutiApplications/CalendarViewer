const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createReminderStore } = require('../src/server/reminders');
const logic = require('../src/shared/alert-logic');
const M = 60000;

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reminders-')), 'reminders.json');
  const clock = { t: Date.UTC(2030, 0, 1, 9) };
  const options = { file, now: () => clock.t };
  const occ = { key: 'meeting', start: clock.t + 30 * M, title: 'Original', sourceKeys: ['work'] };
  const rules = logic.sanitizeRules({ calendars: { work: { enabled: true, offsets: [15] } } });
  return { options, clock, occ, rules, store: createReminderStore(options) };
}

test('snoozes persist across restart and deliver fresh event details exactly once', () => {
  const { options, store, clock, occ, rules } = setup();
  const snooze = store.schedule(occ);
  assert.equal(snooze.dueAt, clock.t + 5 * M);
  const again = createReminderStore(options);
  clock.t += 4 * M;
  assert.deepEqual(again.takeDue([occ], rules), []);
  clock.t += M;
  const due = again.takeDue([{ ...occ, title: 'Updated title' }], rules);
  assert.equal(due.length, 1);
  assert.equal(due[0].occ.title, 'Updated title');
  assert.deepEqual(again.takeDue([occ], rules), []);
  assert.equal(again.status().deliveries.length, 1);
});

test('cancelled, muted, missing and started events do not send snoozed reminders', () => {
  for (const kind of ['cancelled', 'muted', 'missing', 'started']) {
    const { store, clock, occ, rules } = setup();
    store.schedule(occ);
    if (kind === 'muted') rules.global.muted = true;
    clock.t += (kind === 'started' ? 31 : 5) * M;
    const events = kind === 'missing' ? [] : [{ ...occ, title: kind === 'cancelled' ? 'Cancelled: Meeting' : occ.title }];
    assert.deepEqual(store.takeDue(events, rules), [], kind);
  }
});

test('a missing event during startup keeps its snooze until refreshed data arrives', () => {
  const { store, clock, occ, rules } = setup();
  store.schedule(occ);
  clock.t += 5 * M;
  store.takeDue([], rules);
  assert.equal(store.status().pending.length, 1);
  assert.equal(store.takeDue([occ], rules).length, 1);
});

test('snooze rejects times at or after event start and accepts tickets only once', () => {
  const { store, clock, occ } = setup();
  assert.throws(() => store.schedule({ ...occ, start: clock.t + 5 * M }), /start/i);
  const token = store.issueTicket(occ);
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal(store.consumeTicket(token).key, 'meeting');
  assert.throws(() => store.consumeTicket(token), /expired|used|invalid/i);
  const expired = store.issueTicket(occ);
  clock.t = occ.start;
  assert.throws(() => store.consumeTicket(expired), /expired|used|invalid/i);
});
