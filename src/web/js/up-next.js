// The Day view "Up next" rail (it lives outside #cal, which FullCalendar owns).
// ---- Day view "Up next" rail (lives outside #cal, which FullCalendar owns) ----
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
  upNextRail.append(create('h2', '', 'Up next'));
  if (!items.length) {
    upNextRail.append(create('p', 'up-empty', 'Nothing in the next 7 days.'));
    return;
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], CLOCK);
  items.forEach((o, i) => {
    const item = create('div', 'up-item');
    item.append(create('div', 'up-title', o.title));
    item.append(createSourceDots(o.sourceDetails));
    const bell = alertIndicator(o.key, o.sourceKeys, Infinity);
    if (bell) item.append(bell);
    const day = new Date(o.start).toDateString() === new Date(now).toDateString() ? '' : new Date(o.start).toLocaleDateString(undefined, { weekday: 'short' }) + ' ';
    const when = create('div', 'up-when', o.allDay ? (day || 'Today ') + 'all day'
      : (i === 0 ? 'in ' + formatRemaining(o.start - now) + ' · ' : '') + day + clock(o.start));
    item.append(when);
    if (i === 0 && o.join) item.append(externalLink(o.join, 'Join', 'up-join'));
    upNextRail.append(item);
  });
}
