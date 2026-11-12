// Last page script: every file above has loaded, so the calendar can render and the saved state can load.
const compactDateWheel = createDateWheel(document.getElementById('compact-week'), date => calendar.gotoDate(date), document.getElementById('date-wheel-preview'));
const compactDatePicker = createDatePicker(document.getElementById('date-picker'), {
  getDate: () => calendar.getDate(), onSelect: date => calendar.gotoDate(date),
  buttons: [...document.querySelectorAll('[data-date-picker-open]')], fallback: document.getElementById('event-search')
});
document.querySelectorAll('[data-wheel-step]').forEach(button => {
  button.onclick = () => compactDateWheel.step(Number(button.dataset.wheelStep));
});
calendar.render();
placeSyncStrip();
initResponsiveUI();
restoreLocalSources();
restoreFeedCache();
renderSources();
calendar.refetchEvents();
// Learn whether the server shows Windows toasts before the first check, so no alert is announced twice.
refreshServerStatus().then(() => { runAlertCheck(false); scheduleAlertSync(); });
setInterval(refreshServerStatus, 30000);
loadFeeds();
