// Alert settings sync with the background server, its status, and fired-alert memory.
// ---- Alerts: persistence, editors, scheduler, delivery ----
function saveAlertRules() {
  store.set(ALERT_RULES_KEY, JSON.stringify(alertRules), 'Could not save alert settings');
  scheduleAlertSync();
}

// The background server sends Windows toasts even when this page is closed, so it needs the rules and calendars.
let serverToasts = null; // null = unknown, true = server shows Windows toasts, false = it cannot
let alertSyncTimer;
function scheduleAlertSync() {
  clearTimeout(alertSyncTimer);
  alertSyncTimer = setTimeout(syncAlertState, 500);
}

async function syncAlertState() {
  if (restoringBackup) return;
  const body = JSON.stringify({
    rules: alertRules,
    sources: sources.filter(s => s.alertKey).map(s => ({ alertKey: s.alertKey, name: s.name, enabled: s.enabled, icsText: s.feedId ? undefined : s.icsText }))
  });
  try {
    applyServerStatus(await apiJson('/api/alerts/state', { method: 'POST', body }));
  } catch { serverUnreachable(); }
  updateNotifyPanel();
}

async function refreshServerStatus() {
  try { applyServerStatus(await apiJson('/api/alerts/status')); }
  catch { serverUnreachable(); }
  updateNotifyPanel();
}

function serverUnreachable() {
  serverToasts = false;
  backgroundReachable = false;
  updateSourceHealth();
}

function applyServerStatus(status) {
  serverToasts = !!status.serverToasts;
  backgroundReachable = true;
  backgroundFeedHealth = new Map((status.feeds || []).map(f => [f.id, f]));
  (status.snoozes?.pending || []).forEach(s => snoozedOccurrences.set(s.key + '|' + s.start, s.dueAt));
  for (const reminder of status.snoozes?.deliveries || []) {
    const id = 'snooze|' + reminder.id;
    if (!(id in firedAlerts) && !restoringBackup) {
      firedAlerts[id] = reminder.occ.start;
      snoozedOccurrences.set(reminder.occ.key + '|' + reminder.occ.start, reminder.deliveredAt);
      deliverAlert(reminder.occ, Date.now());
      saveFiredAlerts();
    }
  }
  updateSourceHealth();
}

function saveFiredAlerts() {
  store.set(ALERT_FIRED_KEY, JSON.stringify(firedAlerts));
}

// Called after any rule edit. Alerts already past due are marked fired silently so editing never pops a burst of toasts.
function alertRulesChanged(requestPermission) {
  saveAlertRules();
  runAlertCheck(true);
  renderSources();
  calendar.refetchEvents();
  if (requestPermission) askNotificationPermission();
}
