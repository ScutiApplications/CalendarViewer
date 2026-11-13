// End-to-end handoff uses disposable application files and processes; never updates the checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

for (const fail of [false, true]) test('real detached update worker ' + (fail ? 'recovers after failed startup' : 'restarts into the new version'), { timeout: 30000 }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-restart-'));
  const root = path.join(base, 'app'), stage = path.join(base, 'release'), port = fail ? 29972 : 29971;
  const data = path.join(root, 'data'), resultFile = path.join(data, 'updates', 'result.json');
  const script = path.join(root, 'src', 'server', 'server.js');
  const marker = crypto.randomUUID();
  const newServer = `const fs=require('node:fs');require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:fs.readFileSync(require('node:path').join(__dirname,'../../VERSION'),'utf8').trim(),pid:process.pid,marker:${JSON.stringify(marker)}}));}).listen(Number(process.env.PORT),'127.0.0.1');`;
  const digest = crypto.createHash('sha256').update('archive fixture').digest('hex');
  const installerModule = require.resolve('../src/server/update-install'), downloadModule = require.resolve('../src/server/model-download');
  let old, activePid;
  try {
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.mkdir(path.join(stage, 'src', 'server'), { recursive: true });
    await fs.mkdir(path.join(stage, 'scripts'), { recursive: true });
    await fs.mkdir(data, { recursive: true });
    await fs.writeFile(path.join(data, 'feeds.json'), 'preserved calendars');
    await fs.writeFile(path.join(root, 'VERSION'), '1.0.0');
    await fs.writeFile(path.join(stage, 'VERSION'), '1.1.0');
    await fs.writeFile(path.join(stage, 'run.bat'), 'fixture');
    await fs.writeFile(path.join(stage, 'scripts', 'calendar.ps1'), '# fixture');
    await fs.writeFile(path.join(stage, 'src', 'server', 'server.js'), fail ? 'process.exit(1);' : newServer);
    const oldServer = `
      const fs=require('node:fs/promises'),path=require('node:path');
      const root=${JSON.stringify(root)},dataDir=${JSON.stringify(data)},stage=${JSON.stringify(stage)};
      const {createUpdateInstaller}=require(${JSON.stringify(installerModule)});
      const {downloadVerified}=require(${JSON.stringify(downloadModule)});
      const installer=createUpdateInstaller({root,dataDir,version:'1.0.0',port:${port},platform:'win32',
        checker:{check:async()=>({status:'available',latestVersion:'1.1.0',download:{url:'https://github.com/fixture.zip',sha256:${JSON.stringify(digest)}}})},
        download:options=>downloadVerified({...options,fetch:async()=>new Response('archive fixture')}),
        extract:async(_zip,target)=>fs.cp(stage,path.join(target,'CalendarViewer'),{recursive:true}),
        restart:()=>setTimeout(()=>server.close(()=>process.exit(0)),100)});
      const server=require('node:http').createServer(async(req,res)=>{
        res.setHeader('Content-Type','application/json');
        if(req.method==='POST'){res.end(JSON.stringify(await installer.start('1.1.0')));return;}
        res.end(JSON.stringify({version:'1.0.0',pid:process.pid,marker:${JSON.stringify(marker)}}));
      }).listen(${port},'127.0.0.1',()=>console.log('ready'));
    `;
    await fs.writeFile(script, oldServer);
    old = spawn(process.execPath, [script], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((resolve, reject) => {
      old.stdout.on('data', chunk => { if (String(chunk).includes('ready')) resolve(); });
      old.once('error', reject); old.once('exit', code => reject(new Error('Fixture exited: ' + code)));
    });
    const response = await fetch(`http://127.0.0.1:${port}/install`, { method: 'POST' });
    assert.equal((await response.json()).phase, 'downloading');
    let result;
    for (let attempt = 0; attempt < 200; attempt++) {
      result = await fs.readFile(resultFile, 'utf8').then(JSON.parse).catch(() => null);
      if (result && ['complete', 'failed'].includes(result.phase)) break;
      await delay(100);
    }
    assert.equal(result?.phase, fail ? 'failed' : 'complete', JSON.stringify(result));
    const info = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json();
    assert.equal(info.marker, marker); activePid = info.pid;
    assert.equal(info.version, fail ? '1.0.0' : '1.1.0');
    assert.notEqual(activePid, old.pid);
    assert.equal(await fs.readFile(path.join(data, 'feeds.json'), 'utf8'), 'preserved calendars');
    if (fail) assert.match(result.message, /restored/);
  } finally {
    old?.kill();
    // A marker checked above establishes ownership before stopping the detached fixture server.
    // eslint-disable-next-line no-unsafe-finally -- cleanup must fail loudly unless the fixture already exited
    if (activePid) { try { process.kill(activePid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await delay(300);
    await fs.rm(base, { recursive: true, force: true });
  }
});
