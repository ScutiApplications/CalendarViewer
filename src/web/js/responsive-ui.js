// Compact navigation reuses FullCalendar and the existing sidebar, never a second event store.
function renderCompactCalendar() {
  const title = document.getElementById('compact-title');
  if (!title || responsiveMode === 'desktop') return;
  const date = calendar.getDate();
  document.getElementById('compact-weekday').textContent = date.toLocaleDateString(undefined, { weekday: 'long' });
  compactDatePicker.update(date);
  // FullCalendar writes height inline; set its option rather than fighting it with CSS.
  const height = calendar.view.type.startsWith('list') ? 'auto' : responsiveMode === 'mobile' ? 540 : 660;
  if (calendar.getOption('height') !== height) calendar.setOption('height', height);
  const views = document.getElementById('compact-views');
  const choices = CalendarLayout.profile(responsiveMode).views;
  if (views.dataset.mode !== responsiveMode) {
    views.dataset.mode = responsiveMode;
    views.replaceChildren(...choices.map(view => {
      const button = create('button', '', view === 'timeGridThreeDay' ? '3 days' : view.startsWith('list') ? 'Agenda' : 'Day');
      button.type = 'button';
      button.dataset.view = view;
      button.onclick = () => calendar.changeView(view);
      return button;
    }));
  }
  views.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === calendar.view.type)));
  compactDateWheel.render(date);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('compact-week').title = 'Times shown in ' + zone;
  renderCompactNext();
}

function renderCompactNext() {
  const panel = document.getElementById('compact-up-next');
  if (!panel || responsiveMode === 'desktop') return;
  const now = Date.now();
  let event;
  try {
    event = pickUpNext(expandSources(sources, new Date(now), new Date(now + WEEK_MS)), now, 1)[0];
  } catch { /* A broken source must not stop the rest of the interface. */ }
  panel.hidden = !event;
  panel.replaceChildren();
  if (!event) return;
  const body = create('div', 'compact-next-body');
  body.append(create('div', 'compact-next-label', 'UP NEXT · IN ' + formatRemaining(event.start.getTime() - now)), create('strong', '', event.title));
  const date = event.start.toDateString() === new Date(now).toDateString() ? '' : event.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ';
  const when = event.allDay ? 'All day' : event.start.toLocaleTimeString([], CLOCK) + (event.end ? ' – ' + event.end.toLocaleTimeString([], CLOCK) : '');
  body.append(create('div', 'compact-next-time', date + when));
  const details = create('button', 'primary', 'Details');
  details.type = 'button';
  details.onclick = () => showEventDialog(event);
  panel.append(body, details);
}

function initResponsiveUI() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.querySelector('.sidebar-backdrop');
  const close = document.getElementById('sidebar-close');
  const main = document.querySelector('main');
  const refreshLabel = document.querySelector('.sync-auto');
  let opener = null;
  function closePanel(restoreFocus = true) {
    const wasOpen = document.body.classList.contains('sidebar-open');
    document.body.classList.remove('sidebar-open');
    backdrop.hidden = true;
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    sidebar.inert = responsiveMode !== 'desktop';
    main.inert = false;
    document.querySelectorAll('[data-open-panel]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    closeSourceMenu(false);
    if (wasOpen && restoreFocus && opener) opener.focus();
  }
  function openPanel(section, trigger) {
    if (responsiveMode === 'desktop') return;
    opener = trigger;
    sidebar.inert = false;
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    document.body.classList.add('sidebar-open');
    backdrop.hidden = false;
    main.inert = true;
    document.querySelectorAll('[data-open-panel]').forEach(button => button.setAttribute('aria-expanded', 'true'));
    if (section === 'settings') document.getElementById('display-settings').open = true;
    const target = section === 'settings' ? sidebar.querySelector('#display-settings') : sidebar.querySelector('.sb-head');
    target.scrollIntoView({ block: 'start' });
    if (section === 'settings') target.querySelector('input, button')?.focus();
    else close.focus();
  }
  document.querySelectorAll('[data-open-panel]').forEach(button => button.onclick = () => openPanel(button.dataset.openPanel, button));
  close.onclick = () => closePanel();
  backdrop.onclick = () => closePanel();
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('sidebar-open') || document.querySelector('dialog[open]')) return;
    // The source menu owns its Escape key; the next Escape dismisses the drawer.
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); closePanel(); }
    if (event.key !== 'Tab') return;
    const nodes = [...sidebar.querySelectorAll('button, input, select, summary, a[href]')]
      .filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!nodes.length) return;
    const at = nodes.indexOf(document.activeElement);
    if (event.shiftKey && at <= 0) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
    else if (!event.shiftKey && (at === nodes.length - 1 || at < 0)) { event.preventDefault(); nodes[0].focus(); }
  });
  document.getElementById('compact-today').onclick = () => calendar.today();
  for (const [id, days] of [['compact-prev', -7], ['compact-next', 7]]) {
    document.getElementById(id).onclick = () => {
      const date = calendar.getDate();
      date.setDate(date.getDate() + days);
      calendar.gotoDate(date);
    };
  }
  function applyLayout() {
    const next = CalendarLayout.mode(window.innerWidth, window.innerHeight);
    const changed = next !== responsiveMode;
    if (changed) closePanel(false);
    responsiveMode = next;
    document.documentElement.dataset.layout = next;
    sidebar.inert = next !== 'desktop' && !document.body.classList.contains('sidebar-open');
    if (changed) {
      const view = CalendarLayout.view(next, store.get(CalendarLayout.viewKey(next, VIEW_KEY)));
      calendar.changeView(view);
      if (sidebar.contains(document.activeElement)) {
        if (next === 'desktop') document.getElementById('add-toggle').focus();
        else document.querySelector('.menu-toggle').focus();
      }
    }
    if (next === 'desktop') {
      if (calendar.getOption('height') !== '100%') calendar.setOption('height', '100%');
      syncStrip.insertBefore(refreshLabel, document.getElementById('refresh'));
      placeSyncStrip();
    } else {
      main.insertBefore(syncStrip, document.getElementById('compact-up-next'));
      sidebar.querySelector('.alerts-panel').append(refreshLabel);
    }
    renderCompactCalendar();
    calendar.updateSize();
  }
  let frame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(applyLayout);
  });
  applyLayout();
}
