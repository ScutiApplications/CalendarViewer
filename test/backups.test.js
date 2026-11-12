const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Backup = require('../src/shared/backup.js');
const { createBackupService } = require('../src/server/backups.js');
const client = () => ({localSources: [{ name:'Local', color:'#123456', enabled:true, alertKey:'l:one', icsText:'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nEND:VCALENDAR\r\n' }],feedPreferences:[{feedId:'one',name:'Work',color:'#123456',enabled:false}],alertRules:{global:{muted:false},calendars:{'f:one':{enabled:true,offsets:[15]}},events:{}},preferences:{theme:'system',workingHours:{start:'08:00',end:'18:00'},autoRefreshMinutes:5,hideCancelled:true,view:'timeGridWeek'}});
const feeds = () => [{id:'one',name:'Work',color:'#123456',url:'https://example.com/private.ics'}];
const withDir = fn => { const dir = fs.mkdtempSync(path.join(__dirname, '.backup-test-')); try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
const fakeAlerts = overrides => ({ getState: () => ({ rules: {}, sources: [] }), setState() {}, invalidateFeeds() {}, ...overrides });
const payload = () => ({format:'ics-calendar-viewer-backup',version:1,createdAt:new Date().toISOString(),feeds:feeds(),...client()});
test('backup validates, strips unknown fields, and preserves private URLs and preferences', () => {
 const b = payload(); b.fired = {test:1}; b.feeds[0].extra = 'drop';
 const out = Backup.validateBackup(b); assert.equal(out.feeds[0].url,b.feeds[0].url); assert.equal(out.fired,undefined); assert.equal(out.feeds[0].extra,undefined); assert.deepEqual(out.localSources,b.localSources);
});
test('rejects malformed and unsafe payloads before mutation', () => {
 const edits = [b=>b.version=2,b=>b.format='other',b=>b.feeds.push(b.feeds[0]),b=>b.localSources.push(b.localSources[0]),b=>b.feeds[0].url='javascript:alert(1)',b=>b.feeds[0].color='red',b=>b.localSources[0].icsText='invalid',b=>b.alertRules.calendars.x={enabled:true,offsets:[-1]},b=>b.preferences.workingHours.start='25:00',b=>b.feedPreferences.push(b.feedPreferences[0])];
 for(const edit of edits){const b=payload();edit(b);assert.throws(()=>Backup.validateBackup(b));}
 assert.throws(()=>Backup.validateBackup(JSON.parse(JSON.stringify(payload()).replace('"events":{}','"events":{"__proto__":{"mode":"muted"}}'))));
 assert.throws(()=>Backup.parseBackup(' '.repeat(Backup.MAX_BYTES+1)));
});
test('restore snapshots previous full state and persists new feeds and alert sources', () => withDir(dir => {
 const file=path.join(dir,'recovery.json'); let stored=feeds(), state={rules:{global:{muted:true}},sources:[]};
 const service=createBackupService({readFeeds:()=>stored,writeFeeds:value=>{stored=value;},alerts:fakeAlerts({getState:()=>state,setState:value=>{state=value;}}),recoveryFile:file});
 const next=payload();next.feeds[0].name='New';service.restoreBackup({backup:next,previous:client()}); assert.equal(stored[0].name,'New'); assert.equal(state.sources[0].alertKey,'l:one');assert.equal(state.sources[1].enabled,false); assert.equal(service.recoveryBackup().feeds[0].name,'Work'); assert.equal(service.exportBackup(client()).feeds[0].name,'New');
}));
test('invalid restore does not write and alert failure rolls back old feeds and alert state', () => withDir(dir => {
 const file=path.join(dir,'recovery.json'); let stored=feeds(), writes=0, state={rules:{global:{muted:true}},sources:[]}, fail=true; const original=structuredClone(state);
 const service=createBackupService({readFeeds:()=>stored,writeFeeds:value=>{stored=value;writes++;},alerts:fakeAlerts({getState:()=>structuredClone(state),setState:value=>{state=value;if(fail){fail=false;throw Error('disk failure');}}}),recoveryFile:file});
 assert.throws(()=>service.restoreBackup({backup:{},previous:client()}));assert.equal(writes,0);assert.equal(fs.existsSync(file),false);const next=payload();next.feeds[0].name='New';assert.throws(()=>service.restoreBackup({backup:next,previous:client()}),/disk failure/);assert.deepEqual(stored,feeds());assert.deepEqual(state,original);assert.equal(service.recoveryBackup().feeds[0].name,'Work');
}));
test('a feed persistence failure rolls back the disk store and snapshot failure prevents mutation', () => withDir(dir => {
 const feedsFile=path.join(dir,'feeds.json');fs.writeFileSync(feedsFile,JSON.stringify(feeds()));let fail=true, alertWrites=0;
 const options={readFeeds:()=>JSON.parse(fs.readFileSync(feedsFile,'utf8')),writeFeeds:value=>{fs.writeFileSync(feedsFile,JSON.stringify(value));if(fail){fail=false;throw Error('feed write failed');}},alerts:fakeAlerts({setState:()=>{alertWrites++;}}),recoveryFile:path.join(dir,'recovery.json')};
 const svc=createBackupService(options);const next=payload();next.feeds[0].name='New';assert.throws(()=>svc.restoreBackup({backup:next,previous:client()}),/feed write failed/);assert.deepEqual(options.readFeeds(),feeds());assert.equal(alertWrites,1);assert.equal(svc.recoveryBackup().feeds[0].name,'Work');const blocked=createBackupService({...options,recoveryFile:path.join(dir,'missing','recovery.json')});assert.throws(()=>blocked.restoreBackup({backup:next,previous:client()}));assert.deepEqual(options.readFeeds(),feeds());assert.equal(alertWrites,1);
}));
test('failed compensation preserves the original recovery snapshot and rolls back actual current feeds', () => withDir(dir => {
 const recoveryFile=path.join(dir,'recovery.json');let stored=feeds(),fail=false;
 const svc=createBackupService({readFeeds:()=>stored,writeFeeds:value=>{stored=value;if(fail){fail=false;throw Error('compensation failed');}},alerts:fakeAlerts(),recoveryFile});
 const next=payload();next.feeds[0].id='two';next.feeds[0].name='New';next.feedPreferences[0].feedId='two';const original=payload();svc.restoreBackup({backup:next,previous:client()});const snapshot=fs.readFileSync(recoveryFile,'utf8');fail=true;assert.throws(()=>svc.restoreBackup({backup:original,previous:next,preserveRecovery:true}),/compensation failed/);assert.equal(fs.readFileSync(recoveryFile,'utf8'),snapshot);assert.equal(stored[0].id,'two');svc.restoreBackup({backup:original,previous:next,preserveRecovery:true});assert.equal(stored[0].id,'one');assert.equal(fs.readFileSync(recoveryFile,'utf8'),snapshot);
 // A rejected first restore might never have changed the server feeds: compensation still succeeds.
 svc.restoreBackup({backup:original,previous:next,preserveRecovery:true});assert.equal(stored[0].id,'one');
}));
