const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker } = require('../src/server/updates');
const release = tag => new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, html_url: 'javascript:untrusted' }));

test('update checks compare numeric versions and use fixed repository release links', async () => {
  for (const [current, latest, status] of [['1.1.0', 'v1.2.0', 'available'], ['1.9.0', 'v1.10.0', 'available'], ['1.1.0', 'v1.1.0', 'up-to-date'], ['2.0.0', 'v1.10.0', 'up-to-date'], ['1.2.0-beta.1', 'v1.2.0', 'available']]) {
    const checker = createUpdateChecker({ version: current, fetch: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/ScutiApplications/CalendarViewer/releases/latest');
      assert.equal(options.redirect, 'error'); assert.ok(options.signal); assert.equal(options.headers.Authorization, undefined);
      return release(latest);
    } });
    const result = await checker.check();
    assert.equal(result.status, status); assert.equal(result.currentVersion, current);
    assert.equal(result.releaseUrl, 'https://github.com/ScutiApplications/CalendarViewer/releases/tag/' + latest);
  }
});

test('unpublished and preview releases are not offered as stable updates', async () => {
  for (const fetch of [async () => new Response('', { status: 404 }), async () => new Response(JSON.stringify({ tag_name: 'v2.0.0', draft: true })), async () => release('v2.0.0-beta.1'), async () => new Response(JSON.stringify({ tag_name: 'v2.0.0', prerelease: true }))]) {
    assert.equal((await createUpdateChecker({ version: '1.1.0', fetch }).check()).status, 'no-release');
  }
});

test('concurrent checks share a request, successful checks cache briefly, and failures remain retryable', async () => {
  let calls = 0, time = 1000;
  const checker = createUpdateChecker({ version: '1.1.0', now: () => time, cacheMs: 100, fetch: async () => { calls++; return release('v1.2.0'); } });
  await Promise.all([checker.check(), checker.check()]); assert.equal(calls, 1);
  await checker.check(); assert.equal(calls, 1);
  time += 101; await checker.check(); assert.equal(calls, 2);
  const retry = createUpdateChecker({ version: '1.1.0', fetch: async () => { if (calls++ === 2) throw new Error('offline'); return release('v1.2.0'); } });
  await assert.rejects(retry.check(), /connection|GitHub/i); assert.equal((await retry.check()).status, 'available');
});

test('rate limits, invalid metadata and oversized replies fail clearly', async () => {
  for (const [response, message] of [[new Response('', { status: 429 }), /rate limit/i], [new Response('not JSON'), /release/i], [release('release-new'), /version|tag/i], [new Response('x'.repeat(1024 * 1024 + 1)), /large/i]]) {
    await assert.rejects(createUpdateChecker({ version: '1.1.0', fetch: async () => response }).check(), message);
  }
});

test('malformed version identifiers do not silently report an update or up-to-date status', async () => {
  for (const tag of ['v1.2.3-..', 'v1.2.3+..', 'v01.2.3', 'v1.2.3-01']) {
    await assert.rejects(createUpdateChecker({ version: '1.1.0', fetch: async () => release(tag) }).check(), /tag|version/i);
  }
  let calls = 0;
  await assert.rejects(createUpdateChecker({ version: 'unknown', fetch: async () => { calls++; return release('v1.2.0'); } }).check(), /current.*version/i);
  assert.equal(calls, 0);
});

test('only exact versioned ZIP assets with a published checksum can be installed', async () => {
  const asset = { name: 'CalendarViewer-1.2.0.zip', state: 'uploaded', size: 123, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/ScutiApplications/CalendarViewer/releases/download/v1.2.0/CalendarViewer-1.2.0.zip' };
  for (const [change, allowed] of [[{}, true], [{ digest: null }, false], [{ name: 'source.zip' }, false], [{ browser_download_url: 'https://evil.example/update.zip' }, false], [{ size: 200 * 1024 * 1024 }, false], [{ state: 'new' }, false]]) {
    const checker = createUpdateChecker({ version: '1.1.0', fetch: async () => new Response(JSON.stringify({ tag_name: 'v1.2.0', assets: [{ ...asset, ...change }] })) });
    const result = await checker.check();
    assert.equal(!!result.download, allowed);
    if (allowed) assert.equal(result.download.sha256, 'a'.repeat(64));
  }
});

test('installation can refresh cached release metadata without duplicating in-flight checks', async () => {
  let calls = 0;
  const checker = createUpdateChecker({ version: '1.1.0', fetch: async () => { calls++; return release('v1.2.0'); } });
  await checker.check(); await checker.check(); assert.equal(calls, 1);
  await Promise.all([checker.check({ force: true }), checker.check({ force: true })]); assert.equal(calls, 2);
});
