// Tools: keyboard shortcuts, free-time finder, .ics export of the shown view, print, and a second time zone.
const SECOND_ZONE_KEY = 'ics-calendar-viewer.secondZone.v1';
const FALLBACK_ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Tokyo', 'Australia/Sydney'];
const toolsDialog = id => document.getElementById(id);

// ---- Second time zone ----
const zoneSelect = document.getElementById('second-zone');
let secondZone = '';
(function initSecondZone() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : FALLBACK_ZONES;
  zones.forEach(zone => { const option = create('option', '', zone.replace(/_/g, ' ')); option.value = zone; zoneSelect.append(option); });
  const saved = store.get(SECOND_ZONE_KEY);
  if (saved && zones.includes(saved)) { secondZone = saved; zoneSelect.value = saved; }
  zoneSelect.onchange = () => { secondZone = zoneSelect.value; store.set(SECOND_ZONE_KEY, secondZone); };
})();

// "Tue, Nov 10, 9:00 PM – 9:30 PM (Asia/Manila)" for a start and optional end, or '' when no second zone is chosen.
function secondZoneText(start, end) {
  if (!secondZone) return '';
  const day = { weekday: 'short', month: 'short', day: 'numeric', timeZone: secondZone };
  const time = { ...CLOCK, timeZone: secondZone };
  const first = start.toLocaleDateString(undefined, day) + ', ' + start.toLocaleTimeString(undefined, time);
  const sameDay = !end || end.toLocaleDateString(undefined, day) === start.toLocaleDateString(undefined, day);
  const last = !end ? '' : ' – ' + (sameDay ? end.toLocaleTimeString(undefined, time) : end.toLocaleDateString(undefined, day) + ', ' + end.toLocaleTimeString(undefined, time));
  return first + last + ' (' + secondZone.replace(/_/g, ' ') + ')';
}

// ---- Show a time range on the calendar ----
// Switches to a time-grid view that contains the range, scrolls to it and marks it with a gold outline for 15 seconds.
let showMark = null, showMarkTimer = 0;
function clearShowMark() {
  clearTimeout(showMarkTimer);
  if (showMark) { showMark.remove(); showMark = null; }
}
function showOnCalendar(start, end, message, allDay) {
  clearShowMark();
  start = new Date(start);
  const type = calendar.view.type, weekend = [0, 6].includes(start.getDay());
  if (allDay) { if (!type.startsWith('timeGrid') && type !== 'dayGridMonth') calendar.changeView('timeGridWeek'); }
  else if (!type.startsWith('timeGrid') || (type === 'timeGridWorkWeek' && weekend)) calendar.changeView('timeGridWeek');
  calendar.gotoDate(start);
  // After the view settles, so a refresh that finishes meanwhile cannot overwrite the message.
  if (message) requestAnimationFrame(() => requestAnimationFrame(() => setStatus(message)));
  if (allDay) return;
  end = end ? new Date(end) : new Date(+start + 3600000);
  const lead = new Date(start); lead.setHours(Math.max(0, start.getHours() - 1), 0, 0, 0);
  requestAnimationFrame(() => requestAnimationFrame(() => calendar.scrollToTime(String(lead.getHours()).padStart(2, '0') + ':00:00')));
  showMark = calendar.addEvent({ start, end, display: 'background', classNames: ['show-highlight'] });
  showMarkTimer = setTimeout(clearShowMark, 15000);
}

// ---- Export the displayed events as .ics ----
function exportCurrentView() {
  const events = calendar.getEvents().filter(e => e.display !== 'background').sort((a, b) => a.start - b.start);
  if (!events.length) return setStatus('Nothing to export in this date range.');
  const blob = new Blob([CalendarIcsExport.buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const link = create('a');
  link.href = URL.createObjectURL(blob);
  const stamp = calendar.getDate().toISOString().slice(0, 10);
  link.download = 'calendar-view-' + stamp + '.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus('Exported ' + events.length + ' events from the displayed range.');
}
document.getElementById('export-view').onclick = exportCurrentView;
document.getElementById('print-view').onclick = () => { closeSidebarForTool(); window.print(); };

function closeSidebarForTool() {
  if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebar-close').click();
}

// ---- Free-time finder ----
const freeDialog = toolsDialog('free-time-dialog');
const freeResults = toolsDialog('free-time-results');
function findFreeSlots() {
  const minutes = Number(toolsDialog('free-minutes').value);
  const days = Number(toolsDialog('free-range').value);
  freeResults.replaceChildren();
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return freeResults.append(create('p', 'free-note', 'Enter a length from 5 to 480 minutes.'));
  const from = new Date(), to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const busy = markBusy(expandSources(sources, from, to), toolsDialog('free-allday').checked);
  let slots;
  try { slots = CalendarFreeTime.findFreeTime(busy, [from, to], minutes, workingHours, Date.now()); }
  catch (error) { return freeResults.append(create('p', 'free-note', error.message)); }
  const hoursText = workingHours.start + '–' + workingHours.end + ' on weekdays';
  if (!slots.length) return freeResults.append(create('p', 'free-note', 'No free ' + minutes + ' minute slot in the next ' + days + ' days within ' + hoursText + '.'));
  freeResults.append(create('p', 'free-note', 'First ' + slots.length + ' slots, within ' + hoursText + ', across ' + sources.filter(s => s.enabled).length + ' enabled calendars.'));
  const list = create('ul', 'free-list');
  const rows = [];
  slots.forEach((slot, index) => {
    const start = new Date(slot.start), end = new Date(slot.end);
    const item = create('li');
    const whenText = eventWhenText({ start, end, allDay: false });
    const when = create('span', 'free-when', whenText);
    const alt = secondZoneText(start, end);
    const pick = create('input', 'free-pick');
    pick.type = 'checkbox'; pick.checked = index < 3; pick.setAttribute('aria-label', 'Include ' + whenText + ' in the copied text');
    rows.push({ pick, when: whenText, alt });
    item.append(pick);
    const go = create('button', '', 'Show');
    go.type = 'button';
    go.onclick = () => { freeDialog.close(); showOnCalendar(start, end, 'Free slot: ' + whenText); };
    item.append(when);
    if (alt) item.append(create('small', 'free-alt', alt));
    item.append(go);
    list.append(item);
  });
  freeResults.append(list);
  const copy = create('button', 'free-copy', 'Copy selected as text');
  copy.type = 'button';
  copy.onclick = async () => {
    const chosen = rows.filter(row => row.pick.checked).map(row => ({ when: row.when, alt: row.alt }));
    if (!chosen.length) { copy.textContent = 'Tick at least one time'; return; }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { await navigator.clipboard.writeText(CalendarFreeTime.proposalText(minutes, zone, chosen)); copy.textContent = 'Copied'; }
    catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy selected as text'; }, 2500);
  };
  freeResults.append(copy);
}
// Cancelled events never block time. All-day events (leave, holidays) block it only when asked.
const markBusy = (events, countAllDay) => events.filter(e => !isCancelledTitle(e.title) && e.end && (countAllDay || !e.allDay));
document.getElementById('open-free-time').onclick = () => { closeSidebarForTool(); freeDialog.showModal(); findFreeSlots(); };
document.getElementById('free-time-form').onsubmit = e => { e.preventDefault(); findFreeSlots(); };
document.getElementById('free-time-close').onclick = () => freeDialog.close();

// ---- Keyboard shortcuts ----
const shortcutsDialog = toolsDialog('shortcuts-dialog');
const SHORTCUTS = [
  ['t', 'Go to today', () => calendar.today()],
  ['j', 'Next period', () => calendar.next()],
  ['k', 'Previous period', () => calendar.prev()],
  ['d', 'Day view', () => calendar.changeView('timeGridDay')],
  ['w', 'Week view', () => calendar.changeView('timeGridWeek')],
  ['m', 'Month view', () => calendar.changeView('dayGridMonth')],
  ['a', 'Agenda view', () => calendar.changeView('listWeek')],
  ['/', 'Search events', () => searchInput.focus()],
  ['f', 'Find free time', () => document.getElementById('open-free-time').click()],
  ['n', 'Jump to the next free slot', () => jumpToNextFree()],
  ['g', 'Join the meeting running now', () => joinNowFromKey()],
  ['o', 'Overlapping meetings', () => showOverlaps()],
  ['s', 'Week summary', () => showWeekSummary()],
  ['b', 'Focus time blocks', () => showFocusTime()],
  ['?', 'Show this list', () => shortcutsDialog.showModal()]
];
(function renderShortcuts() {
  const list = toolsDialog('shortcuts-list');
  SHORTCUTS.forEach(([key, label]) => {
    const row = create('div', 'shortcut-row');
    row.append(create('kbd', '', key), create('span', '', label));
    list.append(row);
  });
})();
const typingTarget = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (typingTarget(event.target) || document.querySelector('dialog[open]') || document.body.classList.contains('sidebar-open')) return;
  const shortcut = SHORTCUTS.find(([key]) => key === event.key);
  if (!shortcut) return;
  event.preventDefault();
  shortcut[2]();
});
document.getElementById('open-shortcuts').onclick = () => { closeSidebarForTool(); shortcutsDialog.showModal(); };
document.getElementById('shortcuts-close').onclick = () => shortcutsDialog.close();

// ---- Print: fit the view to the page ----
// Time-grid views show the working hours (plus one hour either side) so a week fits on one page. The scale is done in
// print CSS (zoom), because FullCalendar measures its own layout in px and would not follow a CSS height change.
let printState = null;
function applyPrintRange() {
  if (printState) return;
  printState = { min: calendar.getOption('slotMinTime'), max: calendar.getOption('slotMaxTime') };
  const timeGrid = calendar.view.type.startsWith('timeGrid');
  if (timeGrid && workingHours.start < endOfDay(workingHours.end)) {
    // Working hours plus one hour either side; an overnight shift keeps the full day.
    const [startHour] = workingHours.start.split(':').map(Number), [endHour, endMinute] = endOfDay(workingHours.end).split(':').map(Number);
    const pad = hour => String(hour).padStart(2, '0') + ':00:00';
    calendar.setOption('slotMinTime', pad(Math.max(0, startHour - 1)));
    calendar.setOption('slotMaxTime', pad(Math.min(24, endHour + (endMinute ? 2 : 1))));
  }
}
function restorePrintRange() {
  if (!printState) return;
  calendar.setOption('slotMinTime', printState.min);
  calendar.setOption('slotMaxTime', printState.max);
  printState = null;
}
window.addEventListener('beforeprint', applyPrintRange);
window.addEventListener('afterprint', restorePrintRange);
