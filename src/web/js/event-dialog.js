// The event details dialog.
function showEventDialog(event) {
    const p = event.extendedProps;
    document.getElementById('dt').textContent = event.title;
    const badges = document.getElementById('dm');
    badges.replaceChildren();
    p.sourceDetails.forEach(source => {
      const badge = create('span', 'source-badge', source.name);
      badge.style.setProperty('--detail-color', source.color);
      badges.append(badge);
    });
    document.getElementById('dlg').style.setProperty('--detail-color', event.backgroundColor || DEFAULT_SOURCE_COLOR);
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    const lastDay = event.allDay && event.end ? new Date(event.end.getTime() - 1) : event.end;
    const spansDays = lastDay && lastDay.toDateString() !== event.start.toDateString();
    document.getElementById('event-date').textContent = event.start.toLocaleDateString(undefined, dateOptions) + (spansDays ? ' – ' + lastDay.toLocaleDateString(undefined, dateOptions) : '');
    document.getElementById('event-time').textContent = event.allDay ? 'All day' : event.start.toLocaleTimeString(undefined, CLOCK) + (event.end ? ' – ' + event.end.toLocaleTimeString(undefined, CLOCK) + durationText(event.end - event.start) : '');
    const altTime = document.getElementById('event-time-alt');
    altTime.textContent = event.allDay ? '' : secondZoneText(event.start, event.end);
    altTime.hidden = !altTime.textContent;
    const canceled = isCancelledTitle(event.title);
    const conflicts = document.getElementById('event-conflicts');
    conflicts.hidden = !p.conflicts?.length;
    conflicts.textContent = p.conflicts?.length ? 'Overlaps with: ' + p.conflicts.join(', ') : '';
    const status = eventStatus(event, canceled);
    const statusEl = document.getElementById('event-status');
    statusEl.textContent = status.text;
    statusEl.dataset.state = status.state;
    statusEl.hidden = !status.text;
    document.getElementById('dlg-bar').dataset.state = status.state === 'upcoming' || status.state === 'live' ? 'active' : 'done';
    document.getElementById('location-row').hidden = !p.location;
    renderDetailText(document.getElementById('event-location'), p.location);
    const description = splitDescription(p.description);
    const dd = document.getElementById('dd');
    renderDetailText(dd, description.description || 'No additional description.');
    dd.classList.add('clamped');
    const ddToggle = document.getElementById('dd-toggle');
    ddToggle.hidden = true;
    ddToggle.textContent = 'Show more';
    const footer = document.getElementById('meeting-footer');
    footer.hidden = !description.footer;
    footer.open = false;
    renderDetailText(document.getElementById('meeting-footer-text'), description.footer);
    document.querySelector('.description-section').scrollTop = 0;
    const meeting = findMeetingUrl(p);
    openEventAlerts(event);
    const join = document.getElementById('join');
    join.hidden = !meeting;
    join.removeAttribute('href');
    if (meeting) join.href = meeting.href;
    const copyLink = document.getElementById('copy-link');
    copyLink.hidden = !meeting;
    copyLink.dataset.href = meeting ? meeting.href : '';
    copyLink.lastElementChild.textContent = 'Copy link';
    showNote(event);
    document.getElementById('dlg').showModal();
    ddToggle.hidden = dd.scrollHeight <= dd.clientHeight + 1;
}

document.getElementById('dd-toggle').onclick = e => {
  const dd = document.getElementById('dd');
  const open = dd.classList.toggle('clamped') === false;
  e.currentTarget.textContent = open ? 'Show less' : 'Show more';
};
document.getElementById('copy-link').onclick = async e => {
  const button = e.currentTarget;
  try { await navigator.clipboard.writeText(button.dataset.href); button.lastElementChild.textContent = 'Copied'; }
  catch { button.lastElementChild.textContent = 'Copy failed'; }
  setTimeout(() => { button.lastElementChild.textContent = 'Copy link'; }, 1500);
};
