// @ts-check
// Maintainer-only release helper. Run it through tools\release.bat.
// It prepares the version (bump-version: raises VERSION, moves the Unreleased changelog entries, drafts the in-app
// notes, commits and pushes), checks the repository, then waits for the GitHub Actions "release" workflow (started by
// the VERSION push) to build the ZIP, tag and publish the release. It replaces the generated release notes with the
// changelog, then signs and publishes latest.json and latest.json.sig to gh-pages. The signing key stays on this PC.
// It asks before every push or upload.
//   node tools/release.js [patch|minor|major] --key <private-key-file> [--skip-checks] [--mandatory]
// The bump runs when CHANGELOG.md has entries under "## Unreleased" (default patch). When Unreleased is empty, the
// version already in VERSION is released, for example after an earlier bump.
// --mandatory makes this version required: older installs show a panel that cannot be closed until they update.
// It is also detected: a "### Security" heading or a line starting with "Mandatory" in the version's CHANGELOG section.
// Without it, a requirement from an earlier release is kept, so a later optional release does not lift it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');
const { bumpVersion } = require('./bump-version');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'github.com';
const REPO = 'ScutiApplications/CalendarViewer';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Text of one "## <version>" section of CHANGELOG.md, without the heading, or null when missing or empty.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | null}
 */
function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === '## ' + version);
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body ? body + '\n' : null;
}

/**
 * Names of repository paths that are not part of the installation ZIP, found in release note text.
 * Release notes are shown to people who only have the ZIP, so they must not point at maintainer files.
 * @param {string} text
 * @returns {string[]}
 */
function unshippedMentions(text) {
  const found = text.match(/(?:^|[^\w.])(?:tools|test|e2e|docs|\.github|\.githooks)[/\\][\w.-]+/gi) || [];
  return found.map(item => item.replace(/^[^\w.]/, ""));
}

/**
 * True when a changelog section asks for a mandatory update: a "### Security" heading or a line that starts with "Mandatory".
 * @param {string} section
 */
function isMandatory(section) {
  return section.split('\n').some(line => /^###\s+security\s*$/i.test(line.trim()) || /^(?:[-*]\s+)?(?:\*\*)?mandatory\b/i.test(line.trim()));
}

/**
 * Minimum version for the new manifest. A mandatory release sets it to itself. Otherwise the requirement of the
 * previous manifest is kept, so an install that skipped a mandatory release is still required to update.
 * @param {string} oldManifestText
 * @param {string} version
 * @param {boolean} mandatory
 * @returns {string | undefined}
 */
function nextMinimumVersion(oldManifestText, version, mandatory) {
  if (mandatory) return version;
  try {
    const old = JSON.parse(oldManifestText).minimumVersion;
    return typeof old === 'string' && SEMVER.test(old) ? old : undefined;
  } catch { return undefined; }
}

/** @param {string} command @param {string[]} args @param {{cwd?: string, shell?: boolean, quiet?: boolean}} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd || ROOT, encoding: 'utf8', shell: options.shell, stdio: options.quiet ? 'pipe' : ['inherit', 'pipe', 'inherit'] });
  if (result.error) throw result.error;
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed${options.quiet && result.stderr ? ': ' + result.stderr.trim() : ''}.`);
  return String(result.stdout || '').trim();
}

/** @param {string[]} args */
function gh(args) { return run('gh', args, { quiet: true }); }

/** @param {readline.Interface} rl @param {string} question */
async function confirm(rl, question) {
  const answer = (await rl.question(question + ' [y/N] ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') throw new Error('Stopped. Nothing further was changed.');
}

/**
 * The bump kind in the command line: the first word that is not an option or the value of --key.
 * @param {string[]} argv
 * @returns {string}
 */
function bumpKind(argv) {
  const keyIndex = argv.indexOf('--key');
  return argv.find((arg, i) => !arg.startsWith('--') && i !== keyIndex + 1) || 'patch';
}

async function main() {
  const argv = process.argv.slice(2);
  const keyIndex = argv.indexOf('--key');
  const keyFile = keyIndex >= 0 ? argv[keyIndex + 1] : process.env.CV_SIGNING_KEY || '';
  const skipChecks = argv.includes('--skip-checks');
  process.env.PATH += path.delimiter + 'C:\\Program Files\\GitHub CLI';
  if (!keyFile) throw new Error('Releases are signed. Pass --key <private-key-file> or set CV_SIGNING_KEY. Run tools\\release.bat to use the default key location.');

  const kind = bumpKind(argv);
  bumpVersion('0.0.0', kind);
  if (run('git', ['status', '--porcelain'], { quiet: true })) throw new Error('The working tree has uncommitted changes. Commit them first.');
  if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }) !== 'main') throw new Error('Release from the main branch.');
  if (changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), 'Unreleased')) {
    const next = bumpVersion(fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(), kind);
    const question = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { await confirm(question, 'CHANGELOG.md has Unreleased entries. Raise VERSION to ' + next + ' (' + kind + '), commit and push it?'); } finally { question.close(); }
    run('node', [path.join(ROOT, 'tools', 'bump-version.js'), kind]);
  } else console.log('Unreleased is empty: releasing the version already in VERSION.');

  const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  if (!SEMVER.test(version)) throw new Error('VERSION must be X.Y.Z.');
  const tag = 'v' + version;
  const zipName = `CalendarViewer-${version}.zip`;
  const repoFlag = `${HOST}/${REPO}`;

  console.log(`Releasing ${tag}`);
  run('git', ['fetch', '--quiet', 'origin'], { quiet: true });
  if (run('git', ['rev-parse', 'HEAD'], { quiet: true }) !== run('git', ['rev-parse', 'origin/main'], { quiet: true })) throw new Error('main and origin/main differ. Push (or pull) first so the workflow builds what you checked.');
  const notes = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  const userNotes = notes.split(/^### Maintainer\s*$/m)[0];
  const noteEntry = (fs.readFileSync(path.join(ROOT, 'src', 'shared', 'release-notes.js'), 'utf8').split(`version: '${version}'`)[1] || '').split('version:')[0];
  const stray = unshippedMentions(userNotes + '\n' + noteEntry);
  if (stray.length) throw new Error('Release notes mention files that are not in the release ZIP: ' + stray.join(', ') + '. Describe what the user sees, and put maintainer steps under a "### Maintainer" heading in CHANGELOG.md.');
  const mandatory = argv.includes('--mandatory') || isMandatory(notes);
  if (mandatory) console.log('This release is MANDATORY: older installs will be blocked until they update.');
  if (!fs.readFileSync(path.join(ROOT, 'src', 'shared', 'release-notes.js'), 'utf8').includes(`version: '${version}'`)) throw new Error(`src/shared/release-notes.js has no ${version} entry.`);
  if (fs.readFileSync(path.join(ROOT, 'src', 'shared', 'release-notes.js'), 'utf8').includes('TODO:')) throw new Error('src/shared/release-notes.js still has a TODO draft. Write the notes first.');
  if (!fs.existsSync(keyFile)) throw new Error('Signing key file not found: ' + keyFile);
  gh(['auth', 'status', '--hostname', HOST]);

  if (!skipChecks) { console.log('Running checks...'); run('pnpm', ['run', 'check'], { shell: true }); }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  /** @type {string | undefined} */
  let worktree;
  try {
    console.log(`GitHub Actions builds ${zipName} and publishes ${tag} after the VERSION push. Waiting for the release...`);
    /** @type {any} */
    let release;
    for (let attempt = 0; attempt < 90 && !release; attempt++) {
      try {
        const found = JSON.parse(gh(['api', `repos/${REPO}/releases/tags/${tag}`, '--hostname', HOST]));
        if (!found.draft && (found.assets || []).some((/** @type {{name: string, digest?: string}} */ item) => item.name === zipName && item.digest)) release = found;
      } catch { /* not published yet */ }
      if (!release) await new Promise(resolve => setTimeout(resolve, 10000));
    }
    if (!release) throw new Error(`Release ${tag} was not published within 15 minutes. Check Actions > release on GitHub, then run tools\\release.bat again (it continues with the version in VERSION).`);
    console.log(`Release published by Actions: https://${HOST}/${REPO}/releases/tag/${tag}`);
    const notesFile = path.join(os.tmpdir(), `calendarviewer-notes-${process.pid}.md`);
    fs.writeFileSync(notesFile, userNotes);
    gh(['release', 'edit', tag, '--repo', repoFlag, '--notes-file', notesFile]);
    fs.rmSync(notesFile, { force: true });
    console.log('Release notes replaced with the changelog entries.');

    const { createReleaseSite } = require('./make_release_site');
    worktree = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calendarviewer-pages-')), 'pages');
    run('git', ['worktree', 'add', '--quiet', '--detach', worktree, 'origin/gh-pages'], { quiet: true });
    const manifestFile = path.join(worktree, 'latest.json');
    // A re-run after an interrupted release resumes here; stop only when this version is already in the manifest.
    try { if (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).version === version) throw new Error(`The manifest on gh-pages already lists ${version}. Increase VERSION for a new release.`); }
    catch (error) { if (/already lists/.test(String(error.message))) throw error; /* no manifest yet */ }
    const minimumVersion = nextMinimumVersion(fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8') : '', version, mandatory);
    const site = createReleaseSite(release, '', { minimumVersion });
    fs.writeFileSync(manifestFile, JSON.stringify(site.manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(worktree, 'index.html'), site.html);
    fs.writeFileSync(path.join(worktree, '.nojekyll'), '');
    const files = ['latest.json', 'index.html', '.nojekyll'];
    run('node', [path.join(ROOT, 'tools', 'sign-manifest.js'), 'sign', manifestFile, keyFile], { quiet: true });
    files.push('latest.json.sig');
    console.log(fs.readFileSync(manifestFile, 'utf8'));
    await confirm(rl, 'Publish this manifest to gh-pages? Installed copies will then offer this version.');
    run('git', ['add', ...files], { cwd: worktree, quiet: true });
    run('git', ['-c', 'user.name=CalendarViewer release', '-c', 'user.email=calendarviewer-release@users.noreply.github.com', 'commit', '--quiet', '-m', `release: publish metadata for ${version}`], { cwd: worktree, quiet: true });
    run('git', ['push', 'origin', 'HEAD:gh-pages'], { cwd: worktree, quiet: true });
    console.log('Manifest published. Pages can take a minute to rebuild.');
  } finally {
    rl.close();
    if (worktree) { try { run('git', ['worktree', 'remove', '--force', worktree], { quiet: true }); } catch { /* left behind in the temp folder */ } }
  }
}

if (require.main === module) main().catch(error => { console.error('\n' + error.message); process.exit(1); });

module.exports = { changelogSection, isMandatory, unshippedMentions, nextMinimumVersion, bumpKind };
