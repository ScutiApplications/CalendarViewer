// @ts-check
// Maintainer-only: prepare the files for the next release, commit and push them. Part of tools\release.bat, which runs it.
//   node tools/bump-version.js [patch|minor|major] [--no-commit] [--no-push]      (default: patch)
// It commits VERSION, CHANGELOG.md and release-notes.js as "chore: prepare release X.Y.Z" (only those files). Pass
// --no-commit to leave them uncommitted (this also skips the push), or --no-push to commit only. The push runs the
// pre-push checks. To reword the draft after a push, amend and use: git push --force-with-lease
// It raises VERSION, moves the CHANGELOG "Unreleased" entries under a new "## X.Y.Z" heading, and adds a draft
// entry to src/shared/release-notes.js from the user-facing bullets (Added, Changed, Fixed, Security). Edit the
// draft wording before releasing.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const USER_FACING = new Set(['Added', 'Changed', 'Fixed', 'Security']);

/** @param {string} version @param {string} kind */
function bumpVersion(version, kind = 'patch') {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error('VERSION must be X.Y.Z.');
  let [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'major') { major++; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor++; patch = 0; }
  else if (kind === 'patch') patch++;
  else throw new Error('Use patch, minor or major.');
  return `${major}.${minor}.${patch}`;
}

/**
 * Move the text under "## Unreleased" below a new "## version" heading. Keeps the file's line endings.
 * @param {string} changelog
 * @param {string} version
 * @returns {{ text: string, bullets: string[] }}
 */
function moveUnreleased(changelog, version) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === '## Unreleased');
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" heading.');
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  if (!body.some(line => line.trim())) throw new Error('"## Unreleased" is empty. Add entries before bumping.');
  if (lines.some(line => line.trim() === '## ' + version)) throw new Error(`CHANGELOG.md already has a "## ${version}" section.`);
  /** @type {string[]} */
  const bullets = [];
  let section = '';
  for (const line of body) {
    const heading = /^### (.+)$/.exec(line.trim());
    if (heading) section = heading[1];
    else if (USER_FACING.has(section) && /^- /.test(line)) bullets.push(line.slice(2).trim());
  }
  const next = [...lines.slice(0, start + 1), '', '## ' + version, ...body, ...lines.slice(end)];
  return { text: next.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n/g, eol), bullets };
}

/**
 * Add a draft entry for the version at the top of the releases array. Backticks are dropped because the notes render as plain text.
 * @param {string} source
 * @param {string} version
 * @param {string[]} bullets
 */
function addReleaseNote(source, version, bullets) {
  if (source.includes(`version: '${version}'`)) throw new Error(`release-notes.js already has ${version}.`);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const items = (bullets.length ? bullets : ['TODO: describe this release for users.'])
    .map(text => text.replace(/`/g, '').replace(/\\/g, '\\\\').replace(/'/g, '’'));
  const entry = [`    { version: '${version}', changes: [`, items.map(text => `      '${text}'`).join(',' + eol), '    ] },'].join(eol) + eol;
  const marker = '  const releases = [' + eol;
  if (!source.includes(marker)) throw new Error('Could not find the releases array in release-notes.js.');
  return source.replace(marker, marker + entry);
}

function main() {
  const args = process.argv.slice(2);
  const commit = !args.includes('--no-commit');
  const push = commit && !args.includes('--no-push');
  const kind = args.find(arg => !arg.startsWith('--')) || 'patch';
  const versionFile = path.join(ROOT, 'VERSION');
  const changelogFile = path.join(ROOT, 'CHANGELOG.md');
  const notesFile = path.join(ROOT, 'src', 'shared', 'release-notes.js');
  const next = bumpVersion(fs.readFileSync(versionFile, 'utf8').trim(), kind);
  const moved = moveUnreleased(fs.readFileSync(changelogFile, 'utf8'), next);
  const notes = addReleaseNote(fs.readFileSync(notesFile, 'utf8'), next, moved.bullets);
  fs.writeFileSync(versionFile, next + '\r\n');
  fs.writeFileSync(changelogFile, moved.text);
  fs.writeFileSync(notesFile, notes);
  if (!commit) return console.log(`Prepared ${next}. Review the draft in src/shared/release-notes.js, then commit, push and run tools\\release.bat.`);
  const files = ['VERSION', 'CHANGELOG.md', 'src/shared/release-notes.js'];
  execFileSync('git', ['add', '--', ...files], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', `chore: prepare release ${next}`, '--', ...files], { cwd: ROOT, stdio: 'inherit' });
  if (!push) return console.log(`Prepared and committed ${next}. Push, then run tools\\release.bat.`);
  execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' });
  console.log(`Prepared, committed and pushed ${next}. Run tools\\release.bat.`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}

module.exports = { bumpVersion, moveUnreleased, addReleaseNote };
