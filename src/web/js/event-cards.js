// Event card, alert bell, source dots, conflict badge and agenda card for FullCalendar.
// A bell on every card that will alert, and a crossed bell on upcoming cards that will not.
function alertIndicator(key, sourceKeys, finishMs, cancelled = false) {
  const rules = alertRules, event = rules.events[key];
  let state = 'on', label = 'Alert set';
  if (cancelled) { state = 'muted'; label = 'Cancelled — alerts disabled'; }
  else if (event && event.mode === 'muted') { state = 'muted'; label = 'Alerts muted for this event'; }
  else if (rules.global.muted) { state = 'muted'; label = 'All alerts muted'; }
  else if (!resolveOffsets(rules, key, sourceKeys).length) { state = 'none'; label = 'No alert set'; }
  if (state !== 'on' && finishMs <= Date.now()) return null;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'event-bell ' + state);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', label);
  icon.innerHTML = '<title>' + label + '</title>' + (state === 'on' ? BELL_PATH : BELL_OFF_PATH);
  return icon;
}

function createEventCard(event, className, tag = 'div') {
  const card = create(tag, 'event-card' + (className ? ' ' + className : '') + (isCancelledTitle(event.title) ? ' canceled' : ''));
  if (tag === 'button') card.type = 'button';
  card.title = event.title;
  card.dataset.finish = eventFinishTime(event);
  card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
  return card;
}

function createSourceDots(details) {
  const dots = create('div', 'event-sources');
  details.forEach(source => {
    const dot = create('span', 'source-dot');
    dot.style.setProperty('--detail-color', source.color);
    dot.title = source.name;
    dots.append(dot);
  });
  return dots;
}

// Appends the alert bell when the event shows one; returns whether it did.
function appendEventBell(parent, event) {
  const p = event.extendedProps;
  const bell = alertIndicator(eventAlertKey(p.uid, event.title), eventSourceKeys(p), eventFinishTime(event), isCancelledTitle(event.title));
  if (bell) parent.append(bell);
  return !!bell;
}

function agendaEventContent(arg) {
  const event = arg.event, p = event.extendedProps;
  const card = createEventCard(event, 'agenda-card', 'button');
  const heading = create('span', 'agenda-heading');
  heading.append(create('span', 'event-title', event.title));
  appendConflictBadge(heading, p.conflicts);
  appendEventBell(heading, event);
  card.append(heading);
  appendNoteBadge(heading, event);
  appendEventSummary(card, event);
  const details = [p.location, p.sourceDetails.map(source => source.name).join(', ')].filter(Boolean);
  if (details.length) card.append(create('span', 'agenda-detail', details.join(' · ')));
  return { domNodes: [card] };
}

function appendConflictBadge(card, conflicts) {
  if (!conflicts?.length) return;
  const badge = create('span', 'conflict-badge', 'Overlap');
  badge.title = 'Overlaps with: ' + conflicts.join(', ');
  badge.setAttribute('aria-label', badge.title);
  card.classList.add('has-conflict');
  card.append(badge);
  card.title += '\n' + badge.title;
}
