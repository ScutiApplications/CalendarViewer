// Connects backup-ui.js to the page: what to export and how to apply a restore.
// The backup service owns feed URLs; the page supplies its imported files and preferences.
function getBackupClientState() {
  if (pendingRefreshes) throw new Error('Wait for the current calendar refresh to finish, then try again.');
  return {
    localSources: localSourceSnapshots(),
    feedPreferences: feedPreferenceSnapshots(),
    alertRules,
    notes: eventNotes,
    preferences: {
      theme: store.get(THEME_KEY) || 'system', workingHours,
      autoRefreshMinutes: Number(autoRefresh.value), hideCancelled, view: calendar.view.type
    }
  };
}

function applyBackupClientState(backup, { validateOnly = false } = {}) {
  const next = CalendarBackup.validateBackup(backup), p = next.preferences;
  CalendarStorage.write(localStorage, {
    [LOCAL_SOURCES_KEY]: JSON.stringify(next.localSources),
    [FEED_PREFERENCES_KEY]: JSON.stringify(next.feedPreferences),
    [FEED_CACHE_KEY]: '[]',
    [ALERT_RULES_KEY]: JSON.stringify(next.alertRules),
    ...(next.notes ? { [NOTES_KEY]: JSON.stringify(next.notes) } : {}),
    [THEME_KEY]: p.theme,
    [HOURS_KEY]: JSON.stringify(p.workingHours),
    [AUTO_REFRESH_KEY]: String(p.autoRefreshMinutes),
    [HIDE_CANCELLED_KEY]: String(p.hideCancelled),
    [VIEW_KEY]: CalendarLayout.view('desktop', p.view),
    [CalendarLayout.viewKey('portrait', VIEW_KEY)]: CalendarLayout.view('portrait', p.view),
    [CalendarLayout.viewKey('mobile', VIEW_KEY)]: CalendarLayout.view('mobile', p.view)
  }, validateOnly);
}

CalendarBackupUI.init({
  getClientState: getBackupClientState,
  applyClientState: applyBackupClientState,
  api: apiAction,
  onRestoreStart: () => { restoringBackup = true; clearTimeout(alertSyncTimer); },
  onRestoreFailure: ({ uncertain = false } = {}) => {
    restoringBackup = uncertain;
    if (uncertain) setStatus('Restore outcome is uncertain. Reconnect and use the recovery backup before resuming.');
    else scheduleAlertSync();
  },
  onRestored: () => window.location.reload()
});
