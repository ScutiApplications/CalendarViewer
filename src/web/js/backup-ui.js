(function (root) {
  'use strict';
  function init({ getClientState, applyClientState, api, onRestored = () => {}, onRestoreStart = () => {}, onRestoreFailure = () => {} }) {
    const el = id => document.getElementById(id);
    const dialog = el('backup-preview'), error = el('backup-error'), restore = el('backup-restore'), input = el('backup-file');
    let pending = null, busy = false;
    // api(path,{method,body}) must return the decoded response or throw on HTTP errors.
    const request = async (path, body) => api(path, body === undefined ? {} : {method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
    const showError = e => { error.textContent = e.message || String(e); if (!dialog.open) dialog.showModal(); };
    function preview(backup) {
      pending = root.CalendarBackup.validateBackup(backup);
      error.textContent = '';
      el('backup-summary').textContent = `${pending.feeds.length} linked calendars, ${pending.localSources.length} imported calendars, ${Object.keys(pending.alertRules.calendars).length} calendar alert rules and ${Object.keys(pending.alertRules.events).length} event rules. Restore replaces your current calendars, preferences and alert rules. A recovery backup will be saved. This local backup contains private feed links; keep it secure.`;
      restore.disabled = false;
      if (!dialog.open) dialog.showModal();
    }
    el('backup-export').onclick = async () => {
      if (busy) return; busy = true;
      try {
        const backup = root.CalendarBackup.validateBackup(await request('/api/backup/export', getClientState()));
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
        const a = document.createElement('a'); a.href=url; a.download='calendar-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      } catch(e) { showError(e); } finally { busy=false; }
    };
    el('backup-import').onclick = () => { if (!busy) input.click(); };
    input.onchange = async () => {
      const file = input.files[0]; input.value=''; if (!file || busy) return;
      pending=null; restore.disabled=true;
      try { if(file.size > root.CalendarBackup.MAX_BYTES) throw Error('Backup exceeds 20 MB.'); preview(root.CalendarBackup.parseBackup(await file.text())); } catch(e) {showError(e);}
    };
    el('backup-cancel').onclick = () => { if (!busy) {pending=null; dialog.close();} };
    dialog.addEventListener('cancel', e => { if(busy)e.preventDefault(); else pending=null; });
    el('backup-undo').onclick=async()=>{if(busy)return;try{preview(await request('/api/backup/recovery'));}catch(e){showError(e);}};
    restore.onclick = async () => {
      if (!pending || busy) return;
      busy=true;restore.disabled=true;error.textContent='';
      onRestoreStart();
      const next=pending;let previous, previousBackup, restoreAttempted=false, completed=false, uncertain=false;
      try {
        previous=getClientState();
        // Synchronous callback must stage all storage values and remove staging data without changing live state.
        applyClientState(next,{validateOnly:true});
        previousBackup=root.CalendarBackup.validateBackup(await request('/api/backup/export',previous));
        // A rejected fetch may mean the server committed but its response was lost.
        // Once sent, compensate on every failure before letting background sync resume.
        restoreAttempted=true;
        await request('/api/backup/restore',{backup:next,previous});
        applyClientState(next);
        pending=null;completed=true;dialog.close();onRestored(next);
      } catch(e) {
        if(restoreAttempted) {
          try {
            await request('/api/backup/restore',{backup:previousBackup,previous:next,preserveRecovery:true});
            applyClientState(previousBackup);
            e=new Error(e.message+' Your previous calendars and preferences were restored.');
          } catch(rollback) {
            uncertain=true;pending=null;
            e=new Error(e.message+' Recovery could not be confirmed: '+rollback.message+'. Background synchronization is paused to protect your calendars. Reconnect and use the saved recovery backup before resuming.');
          }
        }
        showError(e);
      } finally {busy=false;restore.disabled=!pending;if(!completed)onRestoreFailure({uncertain});}
    };
  }
  root.CalendarBackupUI={init};
})(globalThis);
