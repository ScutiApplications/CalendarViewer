// The Day view "Up next" rail (it lives outside #cal, which FullCalendar owns).
function showUpNext(show) {
  upNextRail.hidden = !show;
  calBox.classList.toggle('show-rail', show);
  calendar.updateSize();
  positionUpNext();
  renderUpNext();
}

function positionUpNext() {
  const harness = document.querySelector('#cal .fc-view-harness');
  if (!harness || upNextRail.hidden || !upNextRail.offsetParent) return; // offsetParent is null while the rail is display:none (phones)
  const main = upNextRail.offsetParent.getBoundingClientRect();
  const cal = calBox.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(calBox).paddingRight) || 0;
  const box = harness.getBoundingClientRect();
  upNextRail.style.top = (box.top - main.top) + 'px';
  upNextRail.style.height = box.height + 'px';
  upNextRail.style.left = (cal.right - pad - upNextRail.offsetWidth - main.left) + 'px';
}
const railObserver = new ResizeObserver(positionUpNext);
railObserver.observe(calBox);
railObserver.observe(syncStrip);

function renderUpNext() {
  renderCompactNext();
  if (upNextRail.hidden) return;
  const now = Date.now();
  let items = [];
  try { items = upNext(sources, now); } catch { /* Keep the rail empty if a calendar cannot be read. */ }
  upNextRail.replaceChildren();
  upNextRail.append(create('div', 'up-eyebrow', new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })));
  upNextRail.append(create('h2', '', 'Up next'));
  upNextRail.append(create('p', 'up-intro', 'A clear view of what’s ahead.'));
  if (!items.length) {
    upNextRail.append(create('p', 'up-empty', 'Nothing in the next 7 days.'));
    return;
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], CLOCK);
  items.slice(0, 3).forEach(o => {
    const item = create('div', 'up-item');
    item.style.setProperty('--card-accent', o.sourceDetails[0]?.color || DEFAULT_SOURCE_COLOR);
    item.append(create('div', 'up-countdown', 'in ' + formatRemaining(o.start - now)));
    item.append(create('div', 'up-title', o.title));
    item.append(createSourceDots(o.sourceDetails));
    const bell = alertIndicator(o.key, o.sourceKeys, Infinity);
    if (bell) item.append(bell);
    const day = new Date(o.start).toDateString() === new Date(now).toDateString() ? '' : new Date(o.start).toLocaleDateString(undefined, { weekday: 'short' }) + ' ';
    const when = create('div', 'up-when', o.allDay ? (day || 'Today ') + 'all day'
      : day + clock(o.start) + (o.end ? ' – ' + clock(o.end) : ''));
    item.append(when);
    if (o.sourceDetails.length) item.append(create('div', 'up-calendar', o.sourceDetails.map(s => s.name).join(', ')));
    if (o.join) item.append(externalLink(o.join, 'Join meeting ↗', 'up-join'));
    upNextRail.append(item);
  });
}
