// Read-only schedule helpers: next free slot, focus time, overlaps, week summary and the Join now button.
const insightsDialog = document.getElementById('insights-dialog');
const insightsBody = document.getElementById('insights-body');
const FOCUS_MINUTES = 120;
const JOIN_LEAD_MS = 10 * 60000;
const insightsDay = date => date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const insightsRange = (a, b) => insightsDay(a) + ', ' + a.toLocaleTimeString(undefined, CLOCK) + ' – ' + b.toLocaleTimeString(undefined, CLOCK);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysFromToday = n => { const d = startOfToday(); d.setDate(d.getDate() + n); return d; };
const busyBetween = (from, to) => markBusy(expandSources(sources, from, to), false);

function openInsights(title, build) {
  document.getElementById('insights-title').textContent = title;
  insightsBody.replaceChildren();
  closeSidebarForTool();
  try { build(insightsBody); } catch (error) { insightsBody.append(create('p', 'free-note', error.message)); }
  if (!insightsDialog.open) insightsDialog.showModal();
}
// A list row with text, a small detail line and a Show button that marks the time range on the calendar.
function insightsRow(list, text, detail, start, end) {
  const item = create('li');
  item.append(create('span', 'free-when', text));
  if (detail) item.append(create('small', 'free-alt', detail));
  const go = create('button', '', 'Show');
  go.type = 'button';
  go.onclick = () => { insightsDialog.close(); showOnCalendar(start, end, text + (detail ? ': ' + detail : '')); };
  item.append(go);
  list.append(item);
}
const insightsList = () => create('ul', 'free-list insights-list');

// ---- Next free slot ----
function jumpToNextFree() {
  const minutes = Number(document.getElementById('free-minutes').value) || 30;
  const from = new Date(), to = daysFromToday(15);
  try {
    const [slot] = CalendarFreeTime.findFreeTime(busyBetween(from, to), [from, to], minutes, workingHours, Date.now());
    if (!slot) return setStatus('No free ' + minutes + ' minute slot in the next 14 days within your working hours.');
    const start = new Date(slot.start), end = new Date(slot.end);
    showOnCalendar(start, new Date(Math.min(+end, +start + minutes * 60000)), 'Next free ' + minutes + ' minutes: ' + insightsRange(start, end));
  } catch (error) { setStatus(error.message); }
}
// The button says how long a slot it looks for, because that length comes from the Find free time form.
const nextFreeLabel = document.getElementById('next-free-label');
const syncNextFreeLabel = () => { nextFreeLabel.textContent = 'Next free ' + (Number(document.getElementById('free-minutes').value) || 30) + ' min'; };
document.getElementById('free-minutes').addEventListener('input', syncNextFreeLabel);
syncNextFreeLabel();
document.getElementById('next-free').onclick = () => { closeSidebarForTool(); jumpToNextFree(); };

// ---- Focus time ----
function showFocusTime() {
  openInsights('Focus time', body => {
    const from = new Date(), to = daysFromToday(15);
    const blocks = CalendarInsights.freeBlocks(busyBetween(from, to), [from, to], FOCUS_MINUTES, workingHours, Date.now(), 20);
    body.append(create('p', 'free-note', blocks.length
      ? 'Meeting-free stretches of ' + CalendarInsights.minutesText(FOCUS_MINUTES) + ' or more inside your working hours, next 14 days.'
      : 'No meeting-free stretch of ' + CalendarInsights.minutesText(FOCUS_MINUTES) + ' or more in the next 14 days within your working hours.'));
    const list = insightsList();
    blocks.forEach(block => insightsRow(list, insightsRange(block.start, block.end), CalendarInsights.minutesText((block.end - block.start) / 60000) + ' free', block.start, block.end));
    if (blocks.length) body.append(list);
  });
}
document.getElementById('open-focus').onclick = showFocusTime;

// ---- Overlaps ----
function showOverlaps() {
  openInsights('Overlapping meetings', body => {
    const from = new Date(), to = daysFromToday(8);
    const events = visibleEvents(expandSources(sources, from, to), hideCancelled);
    const pairs = CalendarInsights.overlapPairs(events).filter(pair => pair.end > from);
    body.append(create('p', 'free-note', pairs.length ? pairs.length + (pairs.length === 1 ? ' overlap' : ' overlaps') + ' in the next 7 days.' : 'No overlapping meetings in the next 7 days.'));
    const list = insightsList();
    pairs.slice(0, 100).forEach(pair => insightsRow(list, pair.first.title + ' and ' + pair.second.title,
      insightsRange(pair.start, pair.end) + ' (' + CalendarInsights.minutesText((pair.end - pair.start) / 60000) + ')', pair.start, pair.end));
    if (pairs.length) body.append(list);
  });
}
document.getElementById('open-overlaps').onclick = showOverlaps;

// ---- Week summary ----
function showWeekSummary() {
  openInsights('Week summary', body => {
    const weekly = ['timeGridWeek', 'timeGridWorkWeek', 'listWeek'].includes(calendar.view.type);
    const from = weekly ? calendar.view.currentStart : startOfToday(), to = weekly ? calendar.view.currentEnd : daysFromToday(7);
    const events = visibleEvents(expandSources(sources, from, to), hideCancelled);
    const s = CalendarInsights.weekSummary(events, [from, to], workingHours, Date.now());
    body.append(create('p', 'free-note', insightsDay(from) + ' to ' + insightsDay(new Date(to - 1)) + (weekly ? ' (the week on screen).' : ' (the next 7 days).')));
    const rows = [
      ['Meetings', s.meetings + (s.allDay ? ' (plus ' + s.allDay + ' all-day)' : '')],
      ['Time in meetings', CalendarInsights.minutesText(s.meetingMinutes)],
      ['Busiest day', s.busiest ? insightsDay(s.busiest.date) + ', ' + CalendarInsights.minutesText(s.busiest.minutes) + ' in ' + s.busiest.meetings + (s.busiest.meetings === 1 ? ' meeting' : ' meetings') : 'No meetings'],
      ['Longest free stretch', s.longestFree ? insightsRange(s.longestFree.start, s.longestFree.end) + ' (' + CalendarInsights.minutesText(s.longestFree.minutes) + ')' : 'None inside working hours'],
      ['Overlaps', String(s.overlaps)]
    ];
    const table = create('dl', 'insights-facts');
    rows.forEach(([label, value]) => {
      const fact = create('div');
      fact.append(create('dt', '', label), create('dd', '', value));
      table.append(fact);
    });
    body.append(table);
    const days = create('ul', 'insights-days');
    const longest = Math.max(1, ...s.days.map(day => day.minutes));
    s.days.forEach(day => {
      const item = create('li');
      const bar = create('span', 'insights-bar');
      bar.style.setProperty('--fill', Math.round(day.minutes / longest * 100) + '%');
      item.append(create('span', '', insightsDay(day.date)), bar, create('small', '', day.minutes ? CalendarInsights.minutesText(day.minutes) : 'free'));
      days.append(item);
    });
    body.append(days);
  });
}
document.getElementById('open-week-summary').onclick = showWeekSummary;
document.getElementById('insights-close').onclick = () => insightsDialog.close();

// ---- Join now: the Teams meeting running now, or starting within 10 minutes ----
const joinNow = document.getElementById('join-now');
function updateJoinNow() {
  const now = Date.now();
  let hit = null;
  try {
    const events = visibleEvents(expandSources(sources, new Date(now - 12 * 3600000), new Date(now + JOIN_LEAD_MS)), true);
    hit = CalendarInsights.joinableNow(events, now, JOIN_LEAD_MS, event => findMeetingUrl(event.extendedProps));
  } catch { /* Leave the button hidden if a calendar cannot be read. */ }
  joinNow.hidden = !hit;
  if (!hit) return;
  joinNow.href = hit.url.href;
  joinNow.textContent = 'Join now: ' + hit.event.title;
  joinNow.title = hit.event.title + ' · ' + insightsRange(hit.event.start, hit.event.end);
}
function joinNowFromKey() {
  if (joinNow.hidden) return setStatus('No Teams meeting is running or starting in the next 10 minutes.');
  window.open(joinNow.href, '_blank', 'noopener');
}
setInterval(updateJoinNow, 30000);
