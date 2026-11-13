const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('MCP tokens persist only hashes, reload, rotate and revoke with timing-safe authentication', t => {
  const { createMcpTokenStore } = require('../src/server/mcp-token-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-token-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'mcp-token.json');
  let store = createMcpTokenStore({ file });
  assert.deepEqual(store.status(), { configured: false, createdAt: null }); assert.equal(store.authorize('Bearer anything'), false);
  const first = store.generate(); assert.match(first.token, /^cvmcp_[A-Za-z0-9_-]{43}$/);
  const disk = JSON.parse(fs.readFileSync(file)); assert.deepEqual(Object.keys(disk).sort(), ['createdAt', 'sha256', 'version']);
  assert.equal(disk.sha256, crypto.createHash('sha256').update(first.token).digest('hex')); assert.equal(disk.version, 1);
  assert.equal(fs.readFileSync(file, 'utf8').includes(first.token), false);
  store = createMcpTokenStore({ file }); assert.equal(store.authorize('Bearer ' + first.token), true);
  for (const header of [undefined, '', 'Basic ' + first.token, 'Bearer wrong', 'Bearer  ' + first.token, 'Bearer ' + first.token + ' extra']) assert.equal(store.authorize(header), false);
  assert.deepEqual(store.status(), { configured: true, createdAt: disk.createdAt });
  const next = store.generate(); assert.notEqual(next.token, first.token); assert.equal(store.authorize('Bearer ' + first.token), false);
  assert.equal(store.authorize('Bearer ' + next.token), true); store.revoke(); assert.equal(store.authorize('Bearer ' + next.token), false);
  assert.equal(fs.existsSync(file), false); assert.equal(createMcpTokenStore({ file }).status().configured, false);
  fs.writeFileSync(file, '{"version":1,"sha256":"bad"}'); assert.equal(createMcpTokenStore({ file }).status().configured, false);
});
