const test = require('node:test');
const assert = require('node:assert/strict');
const { changelogSection, isMandatory, unshippedMentions, nextMinimumVersion, bumpKind } = require('../tools/release.js');

const log = ['# Changelog', '', '## Unreleased', '', '## 0.0.6', '', '### Added', '- One', '', '### Fixed', '- Two', '', '## 0.0.5', '- Old', ''].join('\r\n');

test('the changelog section of a version is returned without its heading', () => {
  assert.equal(changelogSection(log, '0.0.6'), '### Added\n- One\n\n### Fixed\n- Two\n');
  assert.equal(changelogSection(log, '0.0.5'), '- Old\n');
});

test('a missing or empty section is reported as null', () => {
  assert.equal(changelogSection(log, '0.0.7'), null);
  assert.equal(changelogSection(log, '0.0.60'), null);
  assert.equal(changelogSection(log, 'Unreleased'), null);
});

test('a changelog section marks a release mandatory with a Security heading or a Mandatory line', () => {
  assert.equal(isMandatory('### Security\n- Fixed a leak\n'), true);
  assert.equal(isMandatory('Mandatory: signing key rotated.\n\n### Fixed\n- x\n'), true);
  assert.equal(isMandatory('- **Mandatory update.** Old installs break.\n'), true);
  assert.equal(isMandatory('### Fixed\n- A mandatory panel bug\n'), false);
  assert.equal(isMandatory('### Added\n- Security hints in the footer\n'), false);
});

test('release notes must not name files that are outside the installation ZIP', () => {
  assert.deepEqual(unshippedMentions('Run tools/release.bat now'), ['tools/release.bat']);
  assert.deepEqual(unshippedMentions('See docs/update-integrity.md and e2e/smoke.spec.js'), ['docs/update-integrity.md', 'e2e/smoke.spec.js']);
  assert.deepEqual(unshippedMentions('Edit src/web/index.html or run.bat'), []);
  assert.deepEqual(unshippedMentions('Updates are checked every six hours'), []);
});

test('every in-app release note is free of maintainer file names', () => {
  const { RELEASE_NOTES, releases } = require('../src/shared/release-notes.js');
  const list = RELEASE_NOTES || releases || [];
  for (const entry of list) assert.deepEqual(unshippedMentions((entry.changes || []).join('\n')), [], 'version ' + entry.version);
});

test('a later optional release keeps the requirement of an earlier mandatory one', () => {
  const old = JSON.stringify({ version: '0.0.13', minimumVersion: '0.0.13' });
  assert.equal(nextMinimumVersion(old, '0.0.14', false), '0.0.13');
  assert.equal(nextMinimumVersion(old, '0.0.15', false), '0.0.13');
  assert.equal(nextMinimumVersion(old, '0.0.15', true), '0.0.15');
  assert.equal(nextMinimumVersion(JSON.stringify({ version: '0.0.13' }), '0.0.14', false), undefined);
  assert.equal(nextMinimumVersion('not json', '0.0.14', false), undefined);
  assert.equal(nextMinimumVersion('', '0.0.14', false), undefined);
});

test('the bump kind is the first plain word, not an option or the key path', () => {
  assert.equal(bumpKind([]), 'patch');
  assert.equal(bumpKind(['--key', 'k.pem', '--mandatory']), 'patch');
  assert.equal(bumpKind(['--key', 'k.pem', 'minor']), 'minor');
  assert.equal(bumpKind(['major', '--key', 'k.pem']), 'major');
});
