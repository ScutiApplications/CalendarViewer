const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../src/web/js/backup-ui.js'), 'utf8');

function setup({ rollbackFails = false, storageFails = false, restoreFails = true } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {open:false, disabled:false, textContent:'', files:[], showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},click(){}});
    return elements.get(id);
  };
  const previous = {tag:'previous',feeds:[],localSources:[],alertRules:{calendars:{},events:{}}};
  const next = {...previous,tag:'next'};
  const requests=[],applied=[],failures=[],completed=[],started=[];
  const context = vm.createContext({document:{getElementById:element},CalendarBackup:{validateBackup:b=>b,parseBackup:JSON.parse,MAX_BYTES:20*1024*1024}});
  vm.runInContext(code,context);
  context.CalendarBackupUI.init({getClientState:()=>previous,applyClientState:(state,options)=>{applied.push({state,options});if(storageFails)throw Error('storage full');},onRestoreStart:()=>started.push(true),onRestored:value=>completed.push(value),onRestoreFailure:value=>failures.push(value),api:async(route,options)=>{
    const body=options?.body?JSON.parse(options.body):undefined;requests.push({route,body});
    if(route==='/api/backup/export')return previous;
    if(route==='/api/backup/restore'){
      const restores=requests.filter(r=>r.route===route);
      if(restores.length===1 && restoreFails)throw Error('response lost');
      if(restores.length===2 && rollbackFails)throw Error('offline');
      return body.backup;
    }
  }});
  element('backup-file').files=[{size:100,text:async()=>JSON.stringify(next)}];
  return {element,requests,applied,failures,completed,started,previous,next};
}

test('a lost restore response compensates before resuming background synchronization',async()=>{
 const s=setup();await s.element('backup-file').onchange();await s.element('backup-restore').onclick();
 const writes=s.requests.filter(r=>r.route==='/api/backup/restore');assert.equal(writes.length,2);assert.equal(writes[1].body.backup.tag,'previous');assert.equal(writes[1].body.preserveRecovery,true);
 assert.equal(s.applied.filter(a=>!a.options?.validateOnly).length,1);assert.equal(s.applied.at(-1).state.tag,'previous');assert.equal(s.failures[0].uncertain,false);assert.equal(s.completed.length,0);assert.match(s.element('backup-error').textContent,/previous.*restored/i);
});
test('failed compensation keeps synchronization paused and preserves recovery',async()=>{
 const s=setup({rollbackFails:true});await s.element('backup-file').onchange();await s.element('backup-restore').onclick();
 assert.equal(s.requests.filter(r=>r.route==='/api/backup/restore').length,2);assert.equal(s.applied.filter(a=>!a.options?.validateOnly).length,0);assert.equal(s.failures.length,1);assert.equal(s.failures[0].uncertain,true);assert.match(s.element('backup-error').textContent,/synchronization.*paused/i);assert.match(s.element('backup-error').textContent,/recovery/i);assert.equal(s.element('backup-restore').disabled,true);
});
test('storage preflight failure never calls the restore endpoint',async()=>{
 const s=setup({storageFails:true});await s.element('backup-file').onchange();await s.element('backup-restore').onclick();
 assert.equal(s.requests.filter(r=>r.route==='/api/backup/restore').length,0);assert.equal(s.failures[0].uncertain,false);
});
test('successful restore applies state only after server success',async()=>{
 const s=setup({restoreFails:false});await s.element('backup-file').onchange();await s.element('backup-restore').onclick();
 assert.equal(s.requests.filter(r=>r.route==='/api/backup/restore').length,1);assert.equal(s.applied.at(-1).state.tag,'next');assert.equal(s.completed.length,1);assert.equal(s.failures.length,0);
});
