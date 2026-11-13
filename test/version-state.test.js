const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { trackVersion } = require('../src/server/version-state');

const fresh = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-state-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'version-state.json'); };

test('first run announces nothing and records the version', t => {
  const file = fresh(t);
  assert.equal(trackVersion({ file, version: '0.0.5' }).announceFrom(), null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastRun, '0.0.5');
});

test('an update is announced from the previous version until acknowledged, across restarts', t => {
  const file = fresh(t);
  trackVersion({ file, version: '0.0.5' });
  assert.equal(trackVersion({ file, version: '0.0.6' }).announceFrom(), '0.0.5');
  assert.equal(trackVersion({ file, version: '0.0.6' }).announceFrom(), '0.0.5', 'still pending after another restart');
  assert.equal(trackVersion({ file, version: '0.0.7' }).announceFrom(), '0.0.5', 'skipped versions keep the earliest one');
  const state = trackVersion({ file, version: '0.0.7' });
  state.acknowledge();
  assert.equal(state.announceFrom(), null);
  assert.equal(trackVersion({ file, version: '0.0.7' }).announceFrom(), null);
});

test('a downgrade or a bad state file announces nothing', t => {
  const file = fresh(t);
  trackVersion({ file, version: '0.0.9' });
  assert.equal(trackVersion({ file, version: '0.0.8' }).announceFrom(), null);
  fs.writeFileSync(file, '{not json');
  assert.equal(trackVersion({ file, version: '0.0.8' }).announceFrom(), null);
});
