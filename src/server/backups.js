const fs = require('fs');
const Backup = require('../shared/backup.js');
const { writeJsonAtomic } = require('./json-store');

function createBackupService({ readFeeds, writeFeeds, alerts, recoveryFile }) {
  function exportBackup(client) {
    return Backup.validateBackup({ ...client, format:'ics-calendar-viewer-backup', version:1, createdAt:new Date().toISOString(), feeds:readFeeds() });
  }
  function restoreBackup({ backup, previous, preserveRecovery = false }) {
    const next = Backup.validateBackup(backup);
    // Compensation carries the full attempted backup. Its client flags may reference feeds
    // the server never committed, so validate it independently from the actual rollback feeds.
    const old = preserveRecovery === true ? Backup.validateBackup(previous) : exportBackup(previous);
    const oldFeeds = readFeeds();
    const oldAlerts = alerts.getState();
    // Keep a recoverable full snapshot even when applying a later store fails.
    if (preserveRecovery !== true) {
      writeJsonAtomic(recoveryFile, old, { mode: 0o600 });
    }
    try {
      writeFeeds(next.feeds);
      alerts.invalidateFeeds();
      const flags = new Map(next.feedPreferences.map(p => [p.feedId,p]));
      alerts.setState({rules:next.alertRules,sources:[...next.localSources,...next.feeds.map(f => ({alertKey:'f:'+f.id,name:flags.get(f.id)?.name || f.name,enabled:flags.get(f.id)?.enabled !== false}))]});
    } catch (error) {
      const rollbackErrors = [];
      try { writeFeeds(oldFeeds); } catch (e) { rollbackErrors.push(e.message); }
      alerts.invalidateFeeds();
      try { alerts.setState(oldAlerts); } catch (e) { rollbackErrors.push(e.message); }
      if (rollbackErrors.length) throw new Error(error.message + '; rollback failed: ' + rollbackErrors.join('; ') + '. Previous backup is available in recovery.');
      throw error;
    }
    return next;
  }
  function recoveryBackup() { return Backup.parseBackup(fs.readFileSync(recoveryFile, 'utf8')); }
  return { exportBackup, restoreBackup, recoveryBackup };
}
module.exports = { createBackupService };
