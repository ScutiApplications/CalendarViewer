// Text and time helpers for events and their detail dialog.
function eventFinishTime(event) {
  if (event.end) return event.end.getTime();
  const end = new Date(event.start);
  if (event.allDay) end.setDate(end.getDate() + 1);
  else end.setHours(end.getHours() + 1);
  return end.getTime();
}

function updateEventStatus() {
  document.querySelectorAll('.event-card[data-finish]').forEach(card => {
    card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
  });
}

function renderDetailText(element, text) {
  const value = String(text || '');
  element.replaceChildren();
  let offset = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    element.append(document.createTextNode(value.slice(offset, match.index)));
    const url = readableUrl(match[0]);
    if (url) {
      element.append(externalLink(url.href, isTeamsMeeting(url) ? 'Join Teams meeting' : 'Open link'));
    } else element.append(document.createTextNode('[Link unavailable]'));
    offset = match.index + match[0].length;
  }
  element.append(document.createTextNode(value.slice(offset)));
}

function splitDescription(text) {
  const value = String(text || '').replace(/\r\n/g, '\n');
  const footer = /^\s*(?:Microsoft Teams(?: meeting)?\s*$|Join (?:the )?meeting(?: now)?\s*$|_{5,}|-{10,})/im.exec(value);
  if (!footer) return { description: value.trim(), footer: '' };
  return { description: value.slice(0, footer.index).trim(), footer: value.slice(footer.index).replace(/^\s*[_-]{5,}\s*/g, '').trim() };
}

function durationText(ms) {
  const minutes = Math.round(ms / 60000);
  if (!(minutes > 0)) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return ' · ' + (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
}

function eventStatus(event, canceled) {
  if (canceled) return { state: 'canceled', text: 'Canceled' };
  if (event.allDay) return { state: 'upcoming', text: '' };
  const now = Date.now();
  const start = event.start.getTime();
  if (eventFinishTime(event) <= now) return { state: 'ended', text: 'Ended' };
  if (start <= now) return { state: 'live', text: 'In progress' };
  return { state: 'upcoming', text: 'Starts in ' + formatRemaining(start - now) };
}

// Plain-text date and time range of an event, e.g. "Tue, Nov 10, 9:00 PM – 9:30 PM".
function eventWhenText(event) {
  const day = event.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (event.allDay) return day + ', all day';
  const clock = { hour: 'numeric', minute: '2-digit' };
  const end = event.end || new Date(eventFinishTime(event));
  const sameDay = end.toDateString() === event.start.toDateString();
  const endText = sameDay ? end.toLocaleTimeString([], clock) : end.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', ...clock });
  return day + ', ' + event.start.toLocaleTimeString([], clock) + ' – ' + endText;
}

// Hidden text on a card so assistants that read the page text see the time, place and calendars, not just the title.
function appendEventSummary(card, event) {
  const p = event.extendedProps || {};
  const parts = [eventWhenText(event), p.location && 'Location: ' + p.location,
    p.sourceDetails?.length && 'Calendar: ' + p.sourceDetails.map(s => s.name).join(', '),
    p.conflicts?.length && 'Overlaps with: ' + p.conflicts.join(', ')].filter(Boolean);
  card.append(create('span', 'sr-only', ' (' + parts.join('. ') + ')'));
}
