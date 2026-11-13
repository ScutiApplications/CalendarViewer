const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { downloadVerified } = require('../src/server/model-download');
const { createUpdateInstaller } = require('../src/server/update-install');
const { applyUpdate, managedPath } = require('../src/server/update-worker');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-update-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'app'), stage = path.join(base, 'stage');
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.mkdir(path.join(stage, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'VERSION'), '1.0.0');
  await fs.writeFile(path.join(root, 'data', 'feeds.json'), 'private calendars');
  await fs.writeFile(path.join(stage, 'VERSION'), '1.1.0');
  await fs.writeFile(path.join(stage, 'src', 'new.js'), 'new code');
  return { root, stage, backup: path.join(base, 'backup'), statusFile: path.join(root, 'data', 'update-result.json'), version: '1.1.0', files: ['VERSION', 'src/new.js'], obsolete: [] };
}

test('update paths protect data, Git, secrets, Windows alternate streams and traversal', () => {
  for (const name of ['data/feeds.json', '.git/config', '.env', 'secrets/token', '../VERSION', '/VERSION', 'src/code.js:evil', 'src/../VERSION', 'src/con.js', 'src/code.js.', 'C:/VERSION']) assert.equal(managedPath(name), false, name);
  for (const name of ['VERSION', 'src/server/server.js', '.github/workflows/test.yml', 'run.bat']) assert.equal(managedPath(name), true, name);
});

test('update applies managed files, removes known stale files and preserves data', async t => {
  const job = await fixture(t);
  await fs.writeFile(path.join(job.root, 'old.js'), 'obsolete'); job.obsolete = ['old.js'];
  let started = 0;
  await applyUpdate(job, { waitForParent: async () => {}, startServer: async () => { started++; return {}; }, health: async () => {} });
  assert.equal(started, 1);
  assert.equal(await fs.readFile(path.join(job.root, 'VERSION'), 'utf8'), '1.1.0');
  assert.equal(await fs.readFile(path.join(job.backup, 'VERSION'), 'utf8'), '1.0.0');
  await assert.rejects(fs.stat(path.join(job.root, 'old.js')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(job.root, 'data', 'feeds.json'), 'utf8'), 'private calendars');
  assert.equal(JSON.parse(await fs.readFile(job.statusFile, 'utf8')).phase, 'complete');
});

test('failed startup rolls back overwritten, new and obsolete files before restarting old server', async t => {
  const job = await fixture(t);
  await fs.writeFile(path.join(job.root, 'old.js'), 'old code'); job.obsolete = ['old.js'];
  let started = 0, stopped = 0;
  await assert.rejects(applyUpdate(job, { waitForParent: async () => {}, startServer: async () => { started++; return { kill() { stopped++; } }; }, health: async (_child, version) => { if (version) throw new Error('startup failed'); } }), /startup failed/);
  assert.equal(started, 2); assert.equal(stopped, 1);
  assert.equal(await fs.readFile(path.join(job.root, 'VERSION'), 'utf8'), '1.0.0');
  assert.equal(await fs.readFile(path.join(job.root, 'old.js'), 'utf8'), 'old code');
  await assert.rejects(fs.stat(path.join(job.root, 'src', 'new.js')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(job.root, 'data', 'feeds.json'), 'utf8'), 'private calendars');
  assert.equal(JSON.parse(await fs.readFile(job.statusFile, 'utf8')).phase, 'failed');
});

test('installer refuses Git checkouts and unsupported systems without downloading', async t => {
  const job = await fixture(t);
  let checks = 0;
  const options = { root: job.root, dataDir: path.join(job.root, 'data'), checker: { check: async () => { checks++; } }, version: '1.0.0' };
  await fs.mkdir(path.join(job.root, '.git'));
  const installer = createUpdateInstaller({ ...options, platform: 'win32' });
  assert.match((await installer.state()).unavailableReason, /Git/i);
  await assert.rejects(installer.start('1.1.0'), /Git/i); assert.equal(checks, 0);
  const other = createUpdateInstaller({ ...options, platform: 'linux' });
  await assert.rejects(other.start('1.1.0'), /Windows/i);
});

const settle = async installer => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await installer.state();
    if (['failed', 'restarting'].includes(state.phase)) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Installer did not settle.');
};

test('explicit install stages a verified package, keeps old server alive until ready, and prevents duplicate installs', { timeout: 10000 }, async t => {
  const job = await fixture(t), dataDir = path.join(job.root, 'data');
  const bytes = Buffer.from('synthetic archive'), digest = crypto.createHash('sha256').update(bytes).digest('hex');
  let downloaded = 0, launched = 0, restarted = 0;
  let confirmRestart;
  const restartCalled = new Promise(resolve => { confirmRestart = resolve; });
  const release = { status: 'available', latestVersion: '1.1.0', download: { url: 'https://github.com/api/v3/repos/ScutiApplications/CalendarViewer/releases/assets/1', sha256: digest, size: bytes.length } };
  const installer = createUpdateInstaller({ root: job.root, dataDir, version: '1.0.0', platform: 'win32', port: 29945,
    checker: { async check(options) { assert.equal(options.force, true); return release; }, async downloadOptions() { return { allowedHost: 'github.com', headers: { Accept: 'application/octet-stream' } }; } },
    download: options => downloadVerified({ ...options, fetch: async (_url, request) => { downloaded++; assert.equal(request.headers.Authorization, undefined); return new Response(bytes); } }),
    extract: async (_zip, target) => {
      const stage = path.join(target, 'CalendarViewer');
      await fs.cp(job.stage, stage, { recursive: true });
      await fs.mkdir(path.join(stage, 'src', 'server'), { recursive: true });
      await fs.mkdir(path.join(stage, 'scripts'), { recursive: true });
      for (const file of ['run.bat', 'src/server/server.js', 'scripts/calendar.ps1']) await fs.writeFile(path.join(stage, file), 'fixture');
    },
    launch: async staged => { launched++; assert.equal(restarted, 0); assert.equal(await fs.readFile(path.join(job.root, 'VERSION'), 'utf8'), '1.0.0'); assert.ok(staged.files.includes('update-manifest.json')); },
    restart() { restarted++; confirmRestart(); }
  });
  await installer.state(); assert.equal(downloaded, 0);
  const starting = installer.start('1.1.0');
  await assert.rejects(installer.start('1.1.0'), /already in progress/);
  assert.equal((await starting).phase, 'downloading');
  assert.equal((await settle(installer)).phase, 'restarting');
  await restartCalled;
  assert.equal(downloaded, 1); assert.equal(launched, 1); assert.equal(restarted, 1);
  assert.equal(await fs.readFile(path.join(dataDir, 'feeds.json'), 'utf8'), 'private calendars');
});

test('checksum failure never extracts, restarts or changes installed files, and can be retried', async t => {
  const job = await fixture(t);
  let calls = 0;
  const installer = createUpdateInstaller({ root: job.root, dataDir: path.join(job.root, 'data'), version: '1.0.0', platform: 'win32',
    checker: { check: async () => ({ status: 'available', latestVersion: '1.1.0', download: { url: 'https://github.com/test.zip', sha256: 'a'.repeat(64) } }) },
    download: options => downloadVerified({ ...options, fetch: async () => { calls++; return new Response('corrupt'); } }),
    extract: async () => assert.fail('must not extract'), restart: () => assert.fail('must not restart')
  });
  await installer.start('1.1.0'); assert.match((await settle(installer)).message, /checksum/);
  assert.equal(await fs.readFile(path.join(job.root, 'VERSION'), 'utf8'), '1.0.0');
  await installer.start('1.1.0'); assert.equal((await settle(installer)).phase, 'failed'); assert.equal(calls, 2);
});

test('worker rejects links and custom data locations before touching installed files', async t => {
  const job = await fixture(t);
  await fs.mkdir(path.join(job.root, 'external'), { recursive: true });
  await fs.symlink(path.join(job.root, 'external'), path.join(job.root, 'src'), 'junction');
  await assert.rejects(applyUpdate(job, { waitForParent: async () => assert.fail('must not shut down') }), /links/);
  await fs.unlink(path.join(job.root, 'src'));
  job.dataDir = path.join(job.root, 'src');
  await assert.rejects(applyUpdate(job, { waitForParent: async () => assert.fail('must not shut down') }), /data/);
  assert.equal(await fs.readFile(path.join(job.root, 'VERSION'), 'utf8'), '1.0.0');
});
