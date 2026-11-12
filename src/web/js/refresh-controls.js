// The Refresh now button and the auto-refresh interval.
document.getElementById('refresh').onclick = loadFeeds;
const AUTO_REFRESH_KEY = 'ics-calendar-viewer.autoRefreshMinutes.v1';
const autoRefresh = document.getElementById('auto-refresh');
let autoRefreshTimer;
function configureAutoRefresh() {
  clearInterval(autoRefreshTimer);
  const minutes = Number(autoRefresh.value);
  if (minutes > 0) {
    autoRefreshTimer = setInterval(() => {
      if (!pendingRefreshes) loadFeeds();
    }, minutes * 60000);
  }
}
const savedRefresh = store.get(AUTO_REFRESH_KEY);
if ([...autoRefresh.options].some(option => option.value === savedRefresh)) autoRefresh.value = savedRefresh;
autoRefresh.onchange = () => {
  store.set(AUTO_REFRESH_KEY, autoRefresh.value);
  configureAutoRefresh();
  updateSourceHealth();
};
configureAutoRefresh();
