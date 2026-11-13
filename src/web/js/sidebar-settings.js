// Sidebar switches: hide cancelled, mute all, notification status, and Start with Windows.
// -- Sidebar panel: global mute and system notification permission --
const muteAll = document.getElementById('mute-all');
const hideCancelledToggle = document.getElementById('hide-cancelled');
hideCancelledToggle.checked = hideCancelled;
hideCancelledToggle.onchange = () => {
  hideCancelled = hideCancelledToggle.checked;
  store.set(HIDE_CANCELLED_KEY, String(hideCancelled));
  calendar.refetchEvents();
};
muteAll.checked = alertRules.global.muted;
// Daily agenda: one summary toast a day from the background server, at a chosen time.
const dailyEnabled = document.getElementById('daily-enabled');
const dailyTime = document.getElementById('daily-time');
(function initDailyAgenda() {
  const daily = alertRules.global.daily || { enabled: false, time: DAILY_DEFAULT_TIME };
  dailyEnabled.checked = daily.enabled;
  dailyTime.value = daily.time;
  dailyTime.disabled = !daily.enabled;
  const save = () => {
    alertRules.global.daily = { enabled: dailyEnabled.checked, time: dailyTime.value || DAILY_DEFAULT_TIME };
    dailyTime.disabled = !dailyEnabled.checked;
    saveAlertRules();
  };
  dailyEnabled.onchange = save;
  dailyTime.onchange = save;
})();
// Weekly summary: one toast a week from the background server, on a chosen day and time.
const weeklyEnabled = document.getElementById('weekly-enabled');
const weeklyDay = document.getElementById('weekly-day');
const weeklyTime = document.getElementById('weekly-time');
(function initWeeklySummary() {
  const weekly = alertRules.global.weekly || { enabled: false, day: 1, time: DAILY_DEFAULT_TIME };
  weeklyEnabled.checked = weekly.enabled;
  weeklyDay.value = String(weekly.day);
  weeklyTime.value = weekly.time;
  weeklyDay.disabled = weeklyTime.disabled = !weekly.enabled;
  const save = () => {
    alertRules.global.weekly = { enabled: weeklyEnabled.checked, day: Number(weeklyDay.value), time: weeklyTime.value || DAILY_DEFAULT_TIME };
    weeklyDay.disabled = weeklyTime.disabled = !weeklyEnabled.checked;
    saveAlertRules();
  };
  weeklyEnabled.onchange = save;
  weeklyDay.onchange = save;
  weeklyTime.onchange = save;
})();
muteAll.onchange = () => { alertRules.global.muted = muteAll.checked; alertRulesChanged(false); if (alertEventCtx) renderEventAlerts(); };

function updateNotifyPanel() {
  const status = document.getElementById('notify-status');
  const enable = document.getElementById('notify-enable');
  const show = (text, detail, on) => { status.textContent = text; status.title = detail; status.parentElement.classList.toggle('on', on); };
  enable.hidden = true;
  if (serverToasts) show('Windows notifications on', 'Windows notifications are sent by the background server, even when this page is closed.', true);
  else if (!('Notification' in window)) show('Notifications not supported', 'System notifications are not supported here. In-app alerts only.', false);
  else if (Notification.permission === 'granted') show('Browser notifications on', 'System notifications on. They fire only while this page is open.', true);
  else if (Notification.permission === 'denied') show('Notifications blocked', 'System notifications are blocked in browser settings. In-app alerts only.', false);
  else { show('Notifications off', 'System notifications are off.', false); enable.hidden = false; }
}

function askNotificationPermission() {
  if (serverToasts || !('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().then(updateNotifyPanel, updateNotifyPanel);
}
document.getElementById('notify-enable').onclick = askNotificationPermission;
updateNotifyPanel();

// -- Start with Windows --
const startupToggle = document.getElementById('startup-toggle');
function showStartup(status) {
  document.getElementById('startup-row').hidden = !status.supported;
  startupToggle.checked = !!status.enabled;
}

async function loadStartup() {
  try { showStartup(await apiJson('/api/startup')); } catch { /* No server: the toggle stays hidden. */ }
}

// Shows progress next to the checkbox: a spinner while working, then a check (fades away) or an error that stays.
const startupState = document.getElementById('startup-state');
let startupStateTimer;
function setStartupState(kind, text) {
  clearTimeout(startupStateTimer);
  startupState.className = 'startup-state' + (kind ? ' ' + kind : '');
  startupState.hidden = !kind;
  document.getElementById('startup-state-text').textContent = text || '';
  if (kind === 'ok') {
    startupStateTimer = setTimeout(() => {
      startupState.classList.add('fading');
      startupStateTimer = setTimeout(() => setStartupState(null), 400);
    }, 3000);
  }
}

startupToggle.onchange = async () => {
  const wanted = startupToggle.checked;
  startupToggle.disabled = true;
  setStartupState('busy', wanted ? 'Turning on…' : 'Turning off…');
  try {
    showStartup(await apiAction('/api/startup', { method: 'POST', body: JSON.stringify({ enabled: wanted }) }));
    setStartupState('ok', wanted ? 'Turned on' : 'Turned off');
    setStatus(wanted ? 'Server will start with Windows.' : 'Automatic startup turned off.');
  } catch (e) {
    startupToggle.checked = !wanted;
    setStartupState('error', 'Failed: ' + e.message);
    setStatus('Startup change failed: ' + e.message);
  }
  startupToggle.disabled = false;
};

loadStartup();
