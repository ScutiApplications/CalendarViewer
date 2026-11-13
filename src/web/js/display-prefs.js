// Display preferences: first day of the week and 12 or 24 hour clock. Saved per browser.
const WEEK_START_KEY = 'ics-calendar-viewer.weekStart.v1';
const CLOCK_KEY = 'ics-calendar-viewer.clock.v1';
const weekStartSelect = document.getElementById('week-start');
const clockSelect = document.getElementById('clock-format');

function applyClockPreference(choice) {
  // CLOCK is shared by every time label; an undefined hour12 follows the browser locale.
  if (choice === '12') CLOCK.hour12 = true;
  else if (choice === '24') CLOCK.hour12 = false;
  else delete CLOCK.hour12;
  const format = { hour: 'numeric', minute: '2-digit', ...(choice === 'auto' ? {} : { hour12: choice === '12' }) };
  calendar.setOption('slotLabelFormat', format);
  calendar.setOption('eventTimeFormat', format);
  calendar.refetchEvents();
  updateSourceHealth();
}

(function initDisplayPreferences() {
  const week = store.get(WEEK_START_KEY);
  if (week === '0' || week === '1') { weekStartSelect.value = week; calendar.setOption('firstDay', Number(week)); }
  const clock = store.get(CLOCK_KEY);
  if (clock === '12' || clock === '24') { clockSelect.value = clock; applyClockPreference(clock); }
  weekStartSelect.onchange = () => {
    store.set(WEEK_START_KEY, weekStartSelect.value);
    calendar.setOption('firstDay', Number(weekStartSelect.value));
  };
  clockSelect.onchange = () => {
    store.set(CLOCK_KEY, clockSelect.value);
    applyClockPreference(clockSelect.value);
  };
})();
