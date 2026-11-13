const test = require('node:test');
const assert = require('node:assert/strict');
const { bumpVersion, moveUnreleased, addReleaseNote } = require('../tools/bump-version.js');

test('versions are raised by kind', () => {
  assert.equal(bumpVersion('0.0.7'), '0.0.8');
  assert.equal(bumpVersion('0.9.9', 'minor'), '0.10.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.2'), /X\.Y\.Z/);
  assert.throws(() => bumpVersion('1.2.3', 'huge'), /patch, minor or major/);
});

const log = ['# Changelog', '', '## Unreleased', '', '### Added', '- New `thing`', '### Tooling', '- Script', '### Fixed', '- Bug', '', '## 0.0.7', '- Old', ''].join('\r\n');

test('Unreleased entries move under the new version and user-facing bullets are collected', () => {
  const { text, bullets } = moveUnreleased(log, '0.0.8');
  assert.deepEqual(bullets, ['New `thing`', 'Bug']);
  assert.ok(text.includes('\r\n'), 'line endings are kept');
  assert.match(text, /## Unreleased\r\n\r\n## 0\.0\.8\r\n\r\n### Added/);
  assert.match(text, /- Bug\r\n\r\n## 0\.0\.7/);
});

test('an empty Unreleased section or a repeated version is refused', () => {
  assert.throws(() => moveUnreleased('# C\n\n## Unreleased\n\n## 0.0.7\n- x\n', '0.0.8'), /empty/);
  assert.throws(() => moveUnreleased(log, '0.0.7'), /already has/);
  assert.throws(() => moveUnreleased('# C\n', '0.0.8'), /no "## Unreleased"/);
});

test('the release note draft escapes text and goes first', () => {
  const src = "(function () {\n  const releases = [\n    { version: '0.0.7', changes: [ 'a' ] }\n  ];\n})();\n";
  const out = addReleaseNote(src, '0.0.8', ["Don't use `x`"]);
  const expected = "const releases = [\n    { version: '0.0.8', changes: [\n      'Don’t use x'\n    ] },\n    { version: '0.0.7'";
  assert.ok(out.includes(expected));
  assert.throws(() => addReleaseNote(out, '0.0.8', []), /already has/);
  assert.match(addReleaseNote(src, '0.0.9', []), /TODO/);
});
