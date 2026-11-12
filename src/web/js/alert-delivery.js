// Checking for due alerts and showing them: in-app toasts and browser notifications.
// -- Scheduler --
function runAlertCheck(silent) {
  if (restoringBackup) return;
  const now = Date.now();
  const horizon = maxConfiguredOffset(alertRules) * 60000;
  if (!horizon) return;
  let due;
  try { due = findDueAlerts(alertRules, collectOccurrences(sources, now, horizon), firedAlerts, now); }
  catch { return; }
  due.forEach(a => {
    firedAlerts[a.id] = a.occ.start;
    const deferredUntil = snoozedOccurrences.get(a.occ.key + '|' + a.occ.start);
    if (!silent && !a.superseded && !(deferredUntil && now <= deferredUntil + 30000)) deliverAlert(a.occ, now);
  });
  pruneFired(firedAlerts, now);
  if (due.length) saveFiredAlerts();
}

function deliverAlert(occ, now) {
  const body = alertBody(occ, now);
  showToast(occ, body);
  if (serverToasts) return; // The server already shows the Windows toast.
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(occ.title, { body, tag: occ.key + '|' + occ.start });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* Some contexts block the constructor; the in-app toast already fired. */ }
  }
}

function showToast(occ, body) {
  const toast = create('div', 'toast');
  toast.setAttribute('role', 'alert');
  const title = create('div', 'toast-title', occ.title);
  const text = create('div', 'toast-body', body);
  const actions = create('div', 'toast-actions');
  if (occ.join) actions.append(externalLink(occ.join, 'Join', 'primary'));
  if (Date.now() + SNOOZE_MS < occ.start) {
    const snooze = create('button', '', 'Snooze 5 min');
    snooze.type = 'button';
    snooze.onclick = async () => {
      snooze.disabled = true;
      try {
        const deferred = await apiAction('/api/alerts/snooze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: occ.key, start: occ.start })
        });
        snoozedOccurrences.set(occ.key + '|' + occ.start, deferred.dueAt);
        toast.remove();
        setStatus('Reminder snoozed for 5 minutes.');
      } catch (e) {
        snooze.disabled = false;
        text.textContent = 'Could not snooze. The background server must be running. ' + e.message;
      }
    };
    actions.append(snooze);
  }
  const dismiss = create('button', '', 'Dismiss');
  dismiss.type = 'button';
  dismiss.onclick = () => toast.remove();
  actions.append(dismiss);
  toast.append(title, text, actions);
  document.getElementById('toasts').append(toast);
}

// One 30-second tick: finished-event styling, the Up next rail and the alert check.
setInterval(() => { updateEventStatus(); renderUpNext(); runAlertCheck(false); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) runAlertCheck(false); });
