// Alert editors: per-calendar defaults and per-event overrides.
function buildOffsetEditor(offsets, onChange) {
  const root = create('div', 'offset-editor');
  let list = normalizeOffsets(offsets);
  const set = next => { list = normalizeOffsets(next); onChange(list); draw(); };
  function draw() {
    root.replaceChildren();
    const chips = create('div', 'offset-chips');
    if (!list.length) chips.append(create('span', 'alert-hint', 'No alerts set.'));
    list.forEach(min => {
      const chip = create('span', 'offset-chip', formatOffset(min));
      const rm = create('button', '', '×');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove alert ' + formatOffset(min));
      rm.onclick = () => set(list.filter(m => m !== min));
      chip.append(rm);
      chips.append(chip);
    });
    const add = create('div', 'offset-add');
    add.innerHTML = '<input type="number" min="1" value="15" aria-label="Alert amount"><select aria-label="Alert unit"><option value="1">minutes</option><option value="60">hours</option><option value="1440">days</option></select><button type="button" class="primary">Add</button>';
    const [amount, unit, addBtn] = add.children;
    addBtn.onclick = () => {
      const min = Math.round(Number(amount.value) * Number(unit.value));
      if (!Number.isFinite(min) || min < 1 || min > MAX_OFFSET_MIN) return setStatus('Alert must be between 1 minute and 30 days before.');
      set([...list, min]);
    };
    root.append(chips, add);
  }
  draw();
  return root;
}

// -- Per-calendar defaults --
const calAlertDlg = document.getElementById('cal-alert-dlg');
const calAlertEnabled = document.getElementById('cal-alert-enabled');
function openCalendarAlerts(src) {
  const rule = () => alertRules.calendars[src.alertKey] || (alertRules.calendars[src.alertKey] = { enabled: true, offsets: [] });
  document.getElementById('cal-alert-title').textContent = 'Default alerts: ' + src.name;
  calAlertEnabled.checked = rule().enabled;
  calAlertEnabled.onchange = () => { rule().enabled = calAlertEnabled.checked; alertRulesChanged(calAlertEnabled.checked); };
  document.getElementById('cal-alert-editor').replaceChildren(buildOffsetEditor(rule().offsets, list => {
    rule().offsets = list;
    alertRulesChanged(list.length > 0);
  }));
  calAlertDlg.showModal();
}

// -- Per-event override (keyed by UID, so it covers every occurrence of a recurring event) --
let alertEventCtx = null;
function openEventAlerts(event) {
  const p = event.extendedProps;
  alertEventCtx = { key: eventAlertKey(p.uid, event.title), sourceKeys: eventSourceKeys(p), cancelled: isCancelledTitle(event.title) };
  renderEventAlerts();
}

function renderEventAlerts() {
  const { key, sourceKeys, cancelled } = alertEventCtx;
  const override = alertRules.events[key];
  const mode = override ? override.mode : 'default';
  document.querySelectorAll('input[name=alert-mode]').forEach(r => { r.checked = r.value === mode; r.disabled = cancelled; });
  const effective = resolveOffsets(alertRules, key, sourceKeys);
  document.getElementById('alert-summary').textContent = cancelled ? 'Cancelled — alerts disabled' : alertRules.global.muted ? 'All alerts muted' :
    mode === 'muted' ? 'Muted' : effective.length ? effective.map(formatOffset).join(', ') : 'No alerts';
  const custom = document.getElementById('alert-custom');
  custom.replaceChildren();
  if (mode === 'custom' && !cancelled) {
    custom.append(buildOffsetEditor(override.offsets, list => {
      alertRules.events[key] = { mode: 'custom', offsets: list };
      alertRulesChanged(list.length > 0);
    }));
  }
  document.getElementById('alert-note').textContent = cancelled ? 'Cancelled events never send alerts. Saved settings apply if the event becomes active again.' : (alertRules.global.muted ? 'All alerts are muted in the sidebar. ' : '') +
    (mode === 'default' ? '' : 'Applies to every occurrence of this event.');
}

document.querySelectorAll('input[name=alert-mode]').forEach(radio => {
  radio.onchange = () => {
    if (!radio.checked || !alertEventCtx || alertEventCtx.cancelled) return;
    const { key, sourceKeys } = alertEventCtx;
    if (radio.value === 'default') delete alertRules.events[key];
    else if (radio.value === 'muted') alertRules.events[key] = { mode: 'muted', offsets: [] };
    else alertRules.events[key] = { mode: 'custom', offsets: calendarDefaultOffsets(alertRules, sourceKeys) };
    renderEventAlerts();
    alertRulesChanged(radio.value === 'custom');
  };
});
