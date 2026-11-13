// The FullCalendar instance and its options. It is rendered by main.js.
function currentScrollTime() {
  const now = new Date();
  // Leave room above "now" so it lands near the middle of the visible grid.
  now.setMinutes(now.getMinutes() - 210, 0, 0);
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':00';
}

function focusCurrentTime() {
  const scrollTime = currentScrollTime();
  // The second frame waits for FullCalendar to finish sizing its scroller.
  requestAnimationFrame(() => requestAnimationFrame(() => calendar.scrollToTime(scrollTime)));
}

// The sync strip lives in <main> in the markup; move it once so it sits directly under FullCalendar's toolbar.
const syncStrip = document.getElementById('sync-strip');
function placeSyncStrip() {
  const toolbar = document.querySelector('#cal .fc-header-toolbar');
  if (toolbar && toolbar.nextElementSibling !== syncStrip) toolbar.after(syncStrip);
}
// FullCalendar marks its arrow icons role=img without a name; the buttons already carry the label, so hide the icons.
function hideToolbarIconRoles() {
  document.querySelectorAll('#cal .fc-icon[role=img]').forEach(icon => { icon.removeAttribute('role'); icon.setAttribute('aria-hidden', 'true'); });
}
const setSyncState = state => { syncStrip.dataset.state = state; };
const upNextRail = document.getElementById('up-next');
const calBox = document.getElementById('cal');
const CLOCK = { hour: 'numeric', minute: '2-digit' };

const calendar = new FullCalendar.Calendar(calBox, {
  initialView,
  height: '100%',
  nowIndicator: true,
  nowIndicatorContent(arg) {
    if (!arg.isAxis) return undefined;
    return { domNodes: [create('span', 'now-chip', arg.date.toLocaleTimeString([], CLOCK).replace(/\s?[AP]M$/i, ''))] };
  },
  businessHours: businessHours(),
  eventDisplay: 'block',
  dayMaxEvents: 3,
  moreLinkClick: 'popover',
  moreLinkContent: arg => '+' + arg.num + ' more',
  fixedWeekCount: false,
  firstDay: 0,
  slotDuration: '00:30:00',
  slotEventOverlap: false, // overlapping meetings sit side by side instead of stacking over each other
  scrollTime: currentScrollTime(),
  allDaySlot: false, // switched on in eventsSet only when the visible range has all-day events
  headerToolbar: { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWorkWeek,timeGridWeek,dayGridMonth,listWeek' },
  buttonText: { today: 'Today', timeGridDay: 'Day', timeGridWorkWeek: 'Work week', timeGridWeek: 'Week', dayGridMonth: 'Month', listWeek: 'Agenda' },
  noEventsContent() {
    const active = CalendarSearch.active(searchQuery, searchFilters);
    const empty = create('div', 'calendar-empty');
    empty.append(create('span', 'empty-calendar-icon', '▦'), create('h3', '', active ? 'No events found.' : 'A little breathing room.'),
      create('p', '', active ? 'No events match this view. Try another date or clear your filters.' : 'Nothing scheduled in this date range.'));
    if (active) {
      const clear = create('button', '', 'Clear filters');
      clear.type = 'button'; clear.onclick = resetSearch; empty.append(clear);
    }
    return { domNodes: [empty] };
  },
  views: {
    timeGridWorkWeek: { type: 'timeGridWeek', weekends: false },
    timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 days' },
    listDay: { buttonText: 'Agenda' }
  },
  datesSet(arg) {
    store.set(CalendarLayout.viewKey(responsiveMode, VIEW_KEY), arg.view.type);
    if (arg.view.type.startsWith('timeGrid')) focusCurrentTime();
    showUpNext(responsiveMode === 'desktop' && arg.view.type === 'timeGridDay');
    hideToolbarIconRoles();
    document.getElementById('print-title').textContent = arg.view.title;
    renderCompactCalendar();
  },
  eventsSet(events) {
    const hasAllDay = events.some(e => e.allDay);
    if (calendar.getOption('allDaySlot') !== hasAllDay) {
      calendar.setOption('allDaySlot', hasAllDay);
      if (calendar.view.type.startsWith('timeGrid')) focusCurrentTime();
    }
    renderUpNext();
    if (typeof updateJoinNow === 'function') updateJoinNow();
  },
  dayHeaderContent(arg) {
    const weekday = arg.date.toLocaleDateString(undefined, { weekday: 'short' });
    if (arg.view.type === 'dayGridMonth') return { html: weekday };
    return { html: weekday + '<span class="header-date">' + arg.date.getDate() + '</span>' };
  },
  eventContent(arg) {
    if (arg.event.display === 'background') return { domNodes: [] }; // the Show outline carries no text
    if (arg.view.type.startsWith('list')) return agendaEventContent(arg);
    if (arg.view.type === 'dayGridMonth') {
      const chip = createEventCard(arg.event, 'month-chip');
      if (!arg.event.allDay && arg.timeText) chip.append(create('span', 'mc-time', arg.timeText));
      chip.append(create('span', 'mc-title', arg.event.title));
      appendConflictBadge(chip, arg.event.extendedProps.conflicts);
      appendEventBell(chip, arg.event);
      appendNoteBadge(chip, arg.event);
      appendEventSummary(chip, arg.event);
      return { domNodes: [chip] };
    }
    const card = createEventCard(arg.event, arg.event.allDay ? 'all-day-card' : '');
    card.append(create('div', 'event-title', arg.event.title));
    if (appendEventBell(card, arg.event)) card.classList.add('has-alert');
    const memberships = arg.event.extendedProps.sourceDetails;
    const meta = create('div', 'event-meta');
    if (!arg.event.allDay && arg.timeText) meta.append(create('span', 'event-time', arg.timeText));
    if (memberships.length) {
      const dots = createSourceDots(memberships);
      dots.setAttribute('aria-label', memberships.map(s => s.name).join(', '));
      meta.append(dots);
    }
    card.append(meta);
    const badges = create('div', 'event-badges');
    appendConflictBadge(badges, arg.event.extendedProps.conflicts);
    appendNoteBadge(badges, arg.event);
    if (badges.childElementCount) card.append(badges);
    if (!arg.event.allDay && arg.event.end - arg.event.start < 45 * 60000) card.classList.add('compact-event');
    if (!arg.event.allDay && arg.event.end - arg.event.start < 25 * 60000) card.classList.add('tiny-event');
    appendEventSummary(card, arg.event);
    // The title leads; time and calendar dots remain together, with separate state labels.
    const conflicts = arg.event.extendedProps.conflicts;
    if (conflicts?.length) card.classList.add('has-conflict');
    card.title = [
      arg.event.title,
      !arg.event.allDay && arg.timeText,
      memberships.length && memberships.map(s => s.name).join(', '),
      conflicts?.length && 'Overlaps with: ' + conflicts.join(', ')
    ].filter(Boolean).join('\n');
    return { domNodes: [card] };
  },
  events(info, ok, fail) {
    try {
      const events = expandSources(sources, info.start, info.end);
      const eligible = markConflicts(visibleEvents(events, hideCancelled));
      const matches = eligible.filter(event => CalendarSearch.matches(event, searchQuery, searchFilters));
      updateSearchStatus(matches.length, eligible.length);
      ok(matches);
    } catch (e) { fail(e); }
  },
  eventClick({ event }) {
    showEventDialog(event);
  },
  eventDidMount({ el, event }) {
    el.style.setProperty('--card-accent', event.backgroundColor || DEFAULT_SOURCE_COLOR);
  }
});
