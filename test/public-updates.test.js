const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUpdateChecker } = require('../src/server/updates');

test('public release checks and downloads do not load or send saved credentials', async () => {
  const checker = createUpdateChecker({ publicKey: null, version: '0.0.1', getToken: async () => assert.fail('Public updates must not load credentials'), fetch: async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ version: '0.0.1', releaseUrl: 'https://github.com/ScutiApplications/CalendarViewer/releases/tag/v0.0.1' }));
  } });
  assert.equal((await checker.check()).status, 'up-to-date');
  assert.equal((await checker.downloadOptions()).headers.Authorization, undefined);
});

test('update settings provide a release link without token controls; MCP keeps its separate token', () => {
  const html = fs.readFileSync('src/web/index.html', 'utf8');
  assert.doesNotMatch(html, /id="update-token(?:"|-)|\/js\/update-token-ui\.js/);
  assert.match(html, /href="https:\/\/github\.com\/ScutiApplications\/CalendarViewer\/releases"[^>]*>View releases<\/a>/);
  assert.match(html, /id="mcp-token-generate"/);
});
