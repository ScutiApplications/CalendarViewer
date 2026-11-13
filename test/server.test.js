const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const { createStartupService } = require('../src/server/startup.js');

test('startup service reports and toggles the shortcut', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-'));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = dir;
  t.after(() => {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const lnk = path.join(dir, 'x.lnk');
  const calls = [];
  const install = async args => { calls.push(args); if (args[0] === 'startup-off') fs.rmSync(lnk, { force: true }); else fs.writeFileSync(lnk, ''); };
  const svc = createStartupService({ platform: 'win32', shortcutPath: lnk, install });
  assert.deepEqual(svc.status(), { supported: true, enabled: false });
  assert.deepEqual(await svc.set(true), { supported: true, enabled: true });
  assert.deepEqual(await svc.set(false), { supported: true, enabled: false });
  assert.deepEqual(calls, [['startup-on'], ['startup-off']]);
  const other = createStartupService({ platform: 'linux', shortcutPath: lnk, install });
  assert.equal(other.status().supported, false);
  await assert.rejects(other.set(true), /only available on Windows/);
});

const script = path.join(__dirname, '..', 'src', 'server', 'server.js');
const tempData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-data-'));

// Spawns the real server and resolves once it prints its banner.
async function startServer(t, env) {
  const server = spawn(process.execPath, [script], { env: { ...process.env, CALENDARVIEWER_UPDATE_TOKEN: '', CALENDAR_DATA_DIR: tempData(), ...env }, stdio: 'pipe' });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => String(d).includes('ICS viewer') && resolve());
    server.on('exit', code => reject(new Error('server exited with ' + code)));
  });
}

const requester = port => (method, url, headers = {}, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], headers: res.headers, data }));
  });
  req.on('error', reject);
  req.end(body);
});

// Runs the real server on a spare port to check static files and the startup endpoint guards.
test('server serves the web files safely and guards the startup endpoint', async t => {
  const port = 3987;
  await startServer(t, { PORT: String(port) });
  const request = requester(port);

  for (const [url, type] of [['/', 'text/html'], ['/css/styles.css', 'text/css'], ['/js/main.js', 'text/javascript'], ['/js/backup-ui.js', 'text/javascript'], ['/shared/alert-logic.js', 'text/javascript'], ['/shared/search.js', 'text/javascript'], ['/shared/backup.js', 'text/javascript'], ['/shared/storage.js', 'text/javascript'], ['/vendor/ical.min.js', 'text/javascript']]) {
    const r = await request('GET', url);
    assert.equal(r.status, 200, url);
    assert.ok(r.type.startsWith(type), url);
  }
  const page = await request('GET', '/');
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.headers['content-security-policy'], /font-src 'self' data:/, 'FullCalendar embeds its icon font as a data: URL');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  const scriptTags = [...page.data.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0);
  for (const [, attributes] of scriptTags) assert.match(attributes, /(?:^|\s)src\s*=\s*["'][^"']+["']/i, 'every script must use an external source allowed by CSP');
  assert.equal((await request('GET', '/js/theme-init.js')).status, 200);
  assert.equal((await request('GET', '/css/styles.css')).status, 200);
  const vendor = await request('GET', '/vendor/ical.min.js');
  assert.ok(vendor.headers.etag && vendor.headers['cache-control'] === 'no-cache');
  const again = await request('GET', '/vendor/ical.min.js', { 'If-None-Match': vendor.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.data, '');
  for (const url of ['/shared/..%2f..%2fserver%2Fserver.js', '/..%2f..%2fREADME.md', '/missing.js', '/data/feeds.json', '/src/server/server.js']) {
    assert.equal((await request('GET', url)).status, 404, url);
  }

  const version = await request('GET', '/api/version');
  assert.equal(version.status, 200);
  assert.equal(JSON.parse(version.data).version, fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim());
  assert.equal((await request('POST', '/api/updates/check')).status, 403);
  assert.equal((await request('POST', '/api/updates/check', { 'X-Calendar-Action': '1', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('GET', '/api/updates/check', { 'X-Calendar-Action': '1' })).status, 405);
  for (const route of ['/api/updates/status', '/api/updates/install']) {
    assert.equal((await request('POST', route)).status, 403);
    assert.equal((await request('POST', route, { 'X-Calendar-Action': '1', Origin: 'https://evil.example' })).status, 403);
  }
  const updateState = await request('GET', '/api/updates/status', { 'X-Calendar-Action': '1' });
  assert.equal(updateState.status, 200);
  assert.equal(JSON.parse(updateState.data).supported, false); // Tests run a Git checkout, never a portable install.
  const tokenHeaders = { 'X-Calendar-Action': '1', 'Content-Type': 'application/json' };
  for (const route of ['/api/updates/token', '/api/updates/token/status']) assert.equal((await request('GET', route, tokenHeaders)).status, 404);

  const body = JSON.stringify({ enabled: false });
  const post = headers => request('POST', '/api/startup', { 'Content-Type': 'application/json', ...headers }, body).then(r => r.status);
  assert.equal(await post({}), 403, 'missing header');
  assert.equal(await post({ 'X-Calendar-Action': '1', Origin: 'https://evil.example' }), 403, 'foreign origin');
  assert.equal(await post({ 'X-Calendar-Action': '1', Host: 'evil.example:' + port }), 403, 'foreign host');

  const client = { localSources: [], feedPreferences: [], alertRules: { global: { muted: false }, calendars: {}, events: {} },
    preferences: { theme: 'system', workingHours: { start: '08:00', end: '18:00' }, autoRefreshMinutes: 0, hideCancelled: false, view: 'listWeek' } };
  assert.equal((await request('POST', '/api/backup/export', {}, JSON.stringify(client))).status, 403);
  const headers = { 'X-Calendar-Action': '1', 'Content-Type': 'application/json' };
  const exported = await request('POST', '/api/backup/export', headers, JSON.stringify(client));
  assert.equal(exported.status, 200);
  const backup = JSON.parse(exported.data);
  assert.equal(backup.format, 'ics-calendar-viewer-backup');
  const restored = await request('POST', '/api/backup/restore', headers, JSON.stringify({ backup, previous: client }));
  assert.equal(restored.status, 200);
  assert.equal((await request('GET', '/api/backup/recovery')).status, 403);
  assert.equal((await request('GET', '/api/backup/recovery', headers)).status, 200);
  assert.equal((await request('POST', '/api/alerts/snooze', {}, '{}')).status, 403);
  assert.equal((await request('POST', '/api/alerts/snooze', headers, '{}')).status, 400);
  assert.equal((await request('GET', '/alerts/snooze/' + 'a'.repeat(48))).status, 400);

  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await request('POST', '/mcp', { ...json, Host: 'evil.example:' + port }, rpc)).status, 403, 'mcp foreign host');
  assert.equal((await request('POST', '/mcp', { ...json, Origin: 'http://localhost:' + port }, rpc)).status, 403, 'mcp browser origin');
  assert.equal((await request('GET', '/mcp')).status, 405);
  const unauthorized = await request('POST', '/mcp', json, '{');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers['www-authenticate'], 'Bearer realm="CalendarViewer"');
  assert.deepEqual(JSON.parse(unauthorized.data), { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
  for (const route of ['/api/mcp/token', '/api/mcp/token/status']) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      assert.equal((await request(method, route)).status, 403);
      assert.equal((await request(method, route, { ...tokenHeaders, Origin: 'https://evil.example' })).status, 403);
      assert.equal((await request(method, route, { ...tokenHeaders, Host: 'evil.example' })).status, 403);
    }
  }
  assert.deepEqual(JSON.parse((await request('GET', '/api/mcp/token/status', tokenHeaders)).data), { configured: false, createdAt: null });
  const generated = await request('POST', '/api/mcp/token', tokenHeaders);
  assert.equal(generated.status, 200);
  const { token } = JSON.parse(generated.data); assert.match(token, /^cvmcp_/);
  const tokenState = JSON.parse((await request('GET', '/api/mcp/token/status', tokenHeaders)).data);
  assert.deepEqual(Object.keys(tokenState).sort(), ['configured', 'createdAt']); assert.equal(tokenState.configured, true);
  const auth = { ...json, Authorization: 'Bearer ' + token };
  for (const Authorization of ['Bearer wrong', 'Basic ' + token, 'Bearer ' + token + ' extra']) assert.equal((await request('POST', '/mcp', { ...json, Authorization }, rpc)).status, 401);
  assert.equal((await request('POST', '/mcp?token=' + encodeURIComponent(token), json, rpc)).status, 401);
  assert.equal((await request('POST', '/mcp', { ...auth, Host: 'evil.example' }, rpc)).status, 403);
  assert.equal((await request('POST', '/mcp', { ...auth, Origin: 'http://localhost:' + port }, rpc)).status, 403);
  assert.equal((await request('POST', '/mcp', auth, '{')).status, 400);
  const listed = await request('POST', '/mcp', auth, rpc);
  assert.equal(listed.status, 200);
  assert.equal(JSON.parse(listed.data).result.tools.length, 5);
  assert.equal((await request('POST', '/mcp', auth, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  const replacement = JSON.parse((await request('POST', '/api/mcp/token', tokenHeaders)).data).token;
  assert.equal((await request('POST', '/mcp', auth, rpc)).status, 401);
  const newAuth = { ...json, Authorization: 'Bearer ' + replacement };
  assert.equal((await request('POST', '/mcp', newAuth, rpc)).status, 200);
  assert.equal((await request('DELETE', '/api/mcp/token', tokenHeaders)).status, 200);
  assert.equal((await request('POST', '/mcp', newAuth, rpc)).status, 401);
});

test('oversized request bodies get 413 and bad feeds fail fast', async t => {
  const feeds = http.createServer((req, res) => {
    if (req.url === '/hang') return res.writeHead(200).write('BEGIN:VCALENDAR\r\n'); // never ends
    res.writeHead(200);
    res.end(Buffer.alloc(11e6, 'a'));
  });
  await new Promise(resolve => feeds.listen(0, '127.0.0.1', resolve));
  t.after(() => { feeds.closeAllConnections(); feeds.close(); });
  const feedPort = feeds.address().port;

  const port = 3989;
  await startServer(t, { PORT: String(port), CALENDAR_FEED_TIMEOUT_MS: '300' });
  const request = requester(port);
  const json = { 'Content-Type': 'application/json' };

  assert.equal((await request('POST', '/api/feeds', json, JSON.stringify({ name: 'x'.repeat(2e5), url: 'https://example.com/a.ics' }))).status, 413);

  for (const [path, expected] of [['/hang', /timed out/], ['/big', /larger than 10 MB/]]) {
    const added = await request('POST', '/api/feeds', json, JSON.stringify({ name: path, url: `http://127.0.0.1:${feedPort}${path}` }));
    const { id } = JSON.parse(added.data);
    const r = await request('GET', '/api/ics/' + id);
    assert.equal(r.status, 502, path);
    assert.match(r.data, expected, path);
  }
});

// Windows cannot deliver SIGTERM to a handler (kill() ends the process at once); CI runs this on Linux.
test('server exits cleanly on SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const server = spawn(process.execPath, [script], { env: { ...process.env, CALENDAR_DATA_DIR: tempData(), PORT: '3990' }, stdio: 'pipe' });
  await new Promise(resolve => server.stdout.on('data', d => String(d).includes('ICS viewer') && resolve()));
  server.kill('SIGTERM');
  assert.equal(await new Promise(resolve => server.on('exit', resolve)), 0);
});

test('feed fetches follow redirects and stop after too many', async t => {
  const feeds = http.createServer((req, res) => {
    if (req.url === '/old') return res.writeHead(302, { Location: '/new' }).end();
    if (req.url === '/loop') return res.writeHead(302, { Location: '/loop' }).end();
    res.writeHead(200).end('BEGIN:VCALENDAR END:VCALENDAR');
  });
  await new Promise(resolve => feeds.listen(0, '127.0.0.1', resolve));
  t.after(() => feeds.close());
  const feedUrl = p => `http://127.0.0.1:${feeds.address().port}${p}`;
  const json = { 'Content-Type': 'application/json' };
  const fetchVia = async (request, p) => {
    const added = await request('POST', '/api/feeds', json, JSON.stringify({ name: p, url: feedUrl(p) }));
    return request('GET', '/api/ics/' + JSON.parse(added.data).id);
  };

  await startServer(t, { PORT: '3985' });
  const local = requester(3985);
  assert.equal((await fetchVia(local, '/old')).status, 200, 'redirect followed');
  const looped = await fetchVia(local, '/loop');
  assert.equal(looped.status, 502);
  assert.match(looped.data, /too many times/);
});

test('adding a calendar link that is already saved is refused with 409', async t => {
  const port = 3988;
  await startServer(t, { PORT: String(port) });
  const request = requester(port);
  const json = { 'Content-Type': 'application/json' };
  const add = (name, url) => request('POST', '/api/feeds', json, JSON.stringify({ name, url }));
  assert.equal((await add('Work', 'https://example.com/cal/work.ics')).status, 201);
  const again = await add('Copy', 'webcal://EXAMPLE.com/cal/work.ics#x');
  assert.equal(again.status, 409); assert.match(again.data, /already added as "Work"/);
  assert.equal((await add('Home', 'https://example.com/cal/home.ics')).status, 201);
  assert.equal(JSON.parse((await request('GET', '/api/feeds')).data).length, 2);
});

test('the version route reports the previous version after an update until it is acknowledged', async t => {
  const dir = tempData();
  fs.writeFileSync(path.join(dir, 'version-state.json'), JSON.stringify({ lastRun: '0.0.1' }));
  const port = 3987;
  await startServer(t, { PORT: String(port), CALENDAR_DATA_DIR: dir });
  const request = requester(port);
  assert.equal(JSON.parse((await request('GET', '/api/version')).data).announceFrom, '0.0.1');
  assert.equal((await request('POST', '/api/version/seen')).status, 403, 'needs the local action header');
  assert.equal((await request('POST', '/api/version/seen', { 'X-Calendar-Action': '1' })).status, 204);
  assert.equal(JSON.parse((await request('GET', '/api/version')).data).announceFrom, null);
});
