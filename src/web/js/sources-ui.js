// The sidebar calendar list: rows, health labels, rename, remove and the options menu.
const BELL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' + BELL_PATH + '</svg>';
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';

function isReservedGreen(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!hex) return false;
  const [r, g, b] = hex[1].match(/../g).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < .05) return false;
  let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return hue >= 75 && hue <= 170;
}

function renderSources() {
  const box = document.getElementById('sources');
  closeSourceMenu(false);
  box.replaceChildren();
  if (!sources.length) {
    box.append(create('p', 'sb-empty', 'No calendars yet. Use + to add a link or an .ics file.'));
    return;
  }
  sources.forEach(s => {
    if (isReservedGreen(s.color)) s.color = PALETTE[(s.id - 1) % PALETTE.length];
    const el = create('div', 'src' + (s.enabled ? '' : ' off'));
    el.setAttribute('role', 'listitem');
    el.style.setProperty('--source-color', s.color);
    el.innerHTML = '<input type="checkbox" class="src-check" aria-label="Show or hide calendar" title="Show or hide"><span class="src-labels"><span class="src-name"></span><small class="src-health"></small></span><button type="button" class="icon-button bell-button" aria-label="Default alerts" title="Default alerts">' + BELL_ICON + '</button><button type="button" class="icon-button more-button" aria-label="Calendar options" aria-haspopup="menu" aria-expanded="false" title="Options">' + MORE_ICON + '</button><input type="color" class="src-color" tabindex="-1" aria-hidden="true">';
    const [chk, labels, bell, more, col] = el.children;
    const name = labels.querySelector('.src-name');
    el.dataset.sourceId = s.id;
    const calRule = alertRules.calendars[s.alertKey];
    bell.classList.toggle('active', !!(calRule && calRule.enabled && calRule.offsets.length));
    bell.onclick = () => openCalendarAlerts(s);
    name.textContent = s.name;
    name.title = s.name;
    chk.checked = s.enabled;
    chk.onchange = () => { s.enabled = chk.checked; el.classList.toggle('off', !s.enabled); saveLocalSources(); calendar.refetchEvents(); };
    col.value = s.color;
    col.oninput = () => {
      if (isReservedGreen(col.value)) {
        col.value = s.color;
        setStatus('Green is reserved for upcoming and ongoing events. Choose another calendar color.');
        return;
      }
      s.color = col.value;
      el.style.setProperty('--source-color', s.color);
      saveLocalSources();
      calendar.refetchEvents();
    };
    more.onclick = () => openSourceMenu(s, el, more, col);
    box.append(el);
  });
  updateSourceHealth();
}

function updateSourceHealth() {
  const now = Date.now();
  const minutes = Number(document.getElementById('auto-refresh').value);
  const staleAfter = Math.max(10, minutes * 2) * 60000;
  const describe = health => {
    const at = health.fetchedAt;
    const time = at == null ? '' : new Date(at).toLocaleTimeString([], CLOCK);
    const labels = { current: 'Updated', refreshing: 'Refreshing…', error: 'Failed', stale: 'Stale', pending: 'Not fetched', inactive: 'Not needed', offline: 'Server offline' };
    return labels[health.state] + (time ? ' · ' + time : '');
  };
  document.querySelectorAll('.src[data-source-id]').forEach(row => {
    const source = sources.find(s => s.id === Number(row.dataset.sourceId));
    const label = row.querySelector('.src-health');
    if (!source || !label) return;
    label.replaceChildren();
    if (!source.feedId) { label.textContent = 'Local file'; return; }
    const page = syncHealth(source, now, staleAfter);
    const background = backgroundReachable ? backgroundFeedHealth.get(source.feedId) || { state: 'pending' } :
      { ...backgroundFeedHealth.get(source.feedId), state: 'offline' };
    for (const [name, health] of [['Page', page], ['Alerts', background]]) {
      const line = create('span', 'source-sync');
      line.dataset.state = health.state;
      line.textContent = name + ': ' + describe(health);
      line.title = line.textContent + (health.fetchedAt == null ? '' : '\nLast successful refresh: ' + new Date(health.fetchedAt).toLocaleString());
      label.append(line);
    }
  });
}

async function removeSource(s) {
  if (s.feedId) {
    try { await api('/api/feeds/' + s.feedId, { method: 'DELETE' }); }
    catch (e) { return setStatus('Remove failed: ' + e.message); }
  }
  sources.splice(sources.indexOf(s), 1);
  if (alertRules.calendars[s.alertKey]) { delete alertRules.calendars[s.alertKey]; saveAlertRules(); }
  saveLocalSources();
  renderSources();
  calendar.refetchEvents();
}

function startRename(s, row) {
  const span = row.querySelector('.src-name');
  const more = row.querySelector('.more-button');
  const field = create('input', 'src-rename');
  field.type = 'text';
  field.value = s.name;
  field.setAttribute('aria-label', 'Calendar name');
  let finished = false;
  const finish = (save, refocus) => {
    if (finished) return;
    finished = true;
    const next = field.value.trim();
    if (save && next && next !== s.name) { s.name = next; saveLocalSources(); calendar.refetchEvents(); }
    span.textContent = s.name;
    span.title = s.name;
    field.replaceWith(span);
    if (refocus) more.focus();
  };
  field.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false, true); }
  };
  field.onblur = () => finish(true, false);
  span.replaceWith(field);
  field.focus();
  field.select();
}

// One shared options menu for every calendar row (Rename, Colour, Remove).
const sourceMenu = create('div', 'src-menu');
sourceMenu.setAttribute('role', 'menu');
sourceMenu.hidden = true;
document.body.append(sourceMenu);
let menuOwner = null; // { button, confirmTimer }

function closeSourceMenu(refocus) {
  if (!menuOwner) return;
  clearTimeout(menuOwner.confirmTimer);
  menuOwner.button.setAttribute('aria-expanded', 'false');
  if (refocus) menuOwner.button.focus();
  menuOwner = null;
  sourceMenu.hidden = true;
  sourceMenu.replaceChildren();
}

function openSourceMenu(s, row, button, colorInput) {
  if (menuOwner && menuOwner.button === button) return closeSourceMenu(true);
  closeSourceMenu(false);
  menuOwner = { button, confirmTimer: 0 };
  button.setAttribute('aria-expanded', 'true');
  const item = (label, onClick, className) => {
    const b = create('button', className, label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.onclick = onClick;
    sourceMenu.append(b);
    return b;
  };
  item('Rename', () => { closeSourceMenu(false); startRename(s, row); });
  item('Colour', () => {
    closeSourceMenu(false);
    if (colorInput.showPicker) colorInput.showPicker(); else colorInput.click();
  });
  const remove = item('Remove', () => {
    if (!remove.dataset.confirm) {
      remove.dataset.confirm = '1';
      remove.textContent = 'Confirm remove';
      menuOwner.confirmTimer = setTimeout(() => { delete remove.dataset.confirm; remove.textContent = 'Remove'; }, 4000);
      return;
    }
    closeSourceMenu(false);
    removeSource(s);
  }, 'danger');
  sourceMenu.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = sourceMenu.offsetWidth, height = sourceMenu.offsetHeight;
  sourceMenu.style.left = Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)) + 'px';
  sourceMenu.style.top = (rect.bottom + 4 + height > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4) + 'px';
  sourceMenu.querySelector('button').focus();
}

sourceMenu.addEventListener('keydown', e => {
  const items = [...sourceMenu.querySelectorAll('button')];
  const at = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeSourceMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Tab') closeSourceMenu(false);
});
document.addEventListener('pointerdown', e => {
  if (menuOwner && !sourceMenu.contains(e.target) && !menuOwner.button.contains(e.target)) closeSourceMenu(false);
});
window.addEventListener('resize', () => closeSourceMenu(false));
document.getElementById('sources').addEventListener('scroll', () => closeSourceMenu(false));
