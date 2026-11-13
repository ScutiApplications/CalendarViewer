const test = require('node:test');
const assert = require('node:assert/strict');
const { createReleaseSite } = require('../tools/make_release_site');
const RELEASES = 'https://github.com/ScutiApplications/CalendarViewer/releases';
const asset = { name: 'CalendarViewer-0.0.2.zip', state: 'uploaded', size: 123, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: RELEASES + '/download/v0.0.2/CalendarViewer-0.0.2.zip' };
const release = { tag_name: 'v0.0.2', draft: false, prerelease: false, assets: [asset] };

test('release site publishes only a stable release with a verified fixed-origin archive', () => {
  const site = createReleaseSite(release);
  assert.equal(site.manifest.version, '0.0.2'); assert.equal(site.manifest.sha256, 'a'.repeat(64));
  assert.equal(site.manifest.downloadUrl, asset.browser_download_url); assert.equal(site.manifest.releaseUrl, RELEASES + '/tag/v0.0.2');
  assert.match(site.html, /0\.0\.2/); assert.match(site.html, /latest\.json/);
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.0.0-beta.1' }, { tag_name: 'release' }, { assets: [] }, { assets: [{ ...asset, browser_download_url: 'https://evil.example/update.zip' }] }]) assert.throws(() => createReleaseSite({ ...release, ...change }));
});

test('missing asset digest requires one exact SHA256SUMS entry; publication fails closed', () => {
  const noDigest = { ...release, assets: [{ ...asset, digest: null }] };
  for (const marker of [' ', '*']) assert.equal(createReleaseSite(noDigest, 'b'.repeat(64) + ' ' + marker + asset.name + '\n').manifest.sha256, 'b'.repeat(64));
  for (const text of ['', 'b'.repeat(64) + '  other.zip', ('b'.repeat(64) + '  ' + asset.name + '\n').repeat(2), 'x'.repeat(65537)]) assert.throws(() => createReleaseSite(noDigest, text));
});

test('release site records a minimum version only when one is given', () => {
  assert.equal('minimumVersion' in createReleaseSite(release).manifest, false);
  assert.equal(createReleaseSite(release, '', { minimumVersion: '0.0.2' }).manifest.minimumVersion, '0.0.2');
});
