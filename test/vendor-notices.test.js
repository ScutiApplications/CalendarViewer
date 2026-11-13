const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Vendored files do not update on their own, so a swap without a notices update fails here.
test('vendored FullCalendar version matches THIRD-PARTY-NOTICES.md', () => {
  const header = /FullCalendar Standard Bundle v(\d+\.\d+\.\d+)/.exec(read('vendor/fullcalendar.min.js').slice(0, 300));
  assert.ok(header, 'FullCalendar header not found');
  const row = read('THIRD-PARTY-NOTICES.md').split('\n').find(line => line.startsWith('| FullCalendar Standard Bundle'));
  assert.ok(row, 'FullCalendar row not found in notices');
  assert.equal(row.split('|')[2].trim(), header[1]);
});

test('every vendored library has a licence file and a notices row', () => {
  const notices = read('THIRD-PARTY-NOTICES.md');
  for (const name of ['fullcalendar', 'ical', 'preact']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'vendor', name + '.LICENSE.txt')), name + ' licence file');
    assert.ok(notices.includes('vendor/' + name + '.LICENSE.txt'), name + ' licence linked in notices');
  }
});
