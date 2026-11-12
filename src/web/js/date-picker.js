// Keep wheel changes local until the modal's Apply date action.
function pickerDate(date, field, value) {
  const year = field === 'year' ? value : date.getFullYear();
  const month = field === 'month' ? value : date.getMonth();
  const last = new Date(0);
  last.setFullYear(year, month + 1, 0);
  const day = Math.min(field === 'day' ? value : date.getDate(), last.getDate());
  const next = new Date(0);
  next.setFullYear(year, month, day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function pickerWheelIndex(scrollTop, count) {
  return Math.max(0, Math.min(count - 1, Math.round(scrollTop / 44)));
}

function createDatePicker(dialog, { getDate, onSelect, buttons, fallback }) {
  const wheels = [...dialog.querySelectorAll('[data-date-wheel]')];
  const timers = new Map();
  const months = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1).toLocaleDateString(undefined, { month: 'long' }));
  const summary = dialog.querySelector('.date-picker-summary');
  let pending, opener, firstYear;
  function valueFor(wheel) {
    return Number(wheel.children[pickerWheelIndex(wheel.scrollTop, wheel.children.length)].dataset.value);
  }
  function readWheels() {
    // Set the day last so intermediate month changes do not discard a valid day.
    let date = pickerDate(pending, 'day', 1);
    for (const field of ['year', 'month', 'day']) {
      date = pickerDate(date, field, valueFor(wheels.find(wheel => wheel.dataset.dateWheel === field)));
    }
    return date;
  }
  function showSummary(date) {
    summary.textContent = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function markWheel(wheel, index) {
    [...wheel.children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  }
  function paintWheels() {
    for (const wheel of wheels) {
      clearTimeout(timers.get(wheel));
      const field = wheel.dataset.dateWheel;
      const current = field === 'month' ? pending.getMonth() : field === 'day' ? pending.getDate() : pending.getFullYear();
      const end = new Date(pending.getTime());
      end.setMonth(end.getMonth() + 1, 0);
      const values = field === 'month' ? Array.from({ length: 12 }, (_, i) => i)
        : field === 'day' ? Array.from({ length: end.getDate() }, (_, i) => i + 1)
          : Array.from({ length: Math.min(9999, firstYear + 200) - firstYear + 1 }, (_, i) => firstYear + i);
      if (wheel.children.length !== values.length || Number(wheel.firstElementChild?.dataset.value) !== values[0]) {
        wheel.replaceChildren(...values.map(value => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.value = value;
          button.textContent = field === 'month' ? months[value] : value;
          button.onclick = () => { pending = pickerDate(readWheels(), field, value); paintWheels(); };
          return button;
        }));
      }
      const index = values.indexOf(current);
      markWheel(wheel, index);
      wheel.dataset.centered = String(index * 44);
      wheel.scrollTop = index * 44;
    }
    showSummary(pending);
  }
  function settleWheels() {
    if (!dialog.open) return;
    pending = readWheels();
    paintWheels();
  }
  function update(date) {
    for (const button of buttons) {
      const text = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      button.querySelector('.date-input-value').textContent = text;
      button.setAttribute('aria-label', 'Choose date: ' + text);
    }
  }
  function open(button) {
    opener = button;
    pending = new Date(getDate().getTime());
    firstYear = Math.max(1, pending.getFullYear() - 100);
    dialog.showModal();
    for (const input of buttons) input.setAttribute('aria-expanded', 'true');
    paintWheels();
    const wheel = wheels.find(item => item.dataset.dateWheel === 'month');
    wheel.querySelector('[aria-pressed=true]').focus({ preventScroll: true });
  }
  for (const button of buttons) button.onclick = () => open(button);
  for (const wheel of wheels) {
    let drag = null, suppressUntil = 0;
    wheel.addEventListener('scroll', () => {
      if (!dialog.open) return;
      markWheel(wheel, pickerWheelIndex(wheel.scrollTop, wheel.children.length));
      showSummary(readWheels());
      if (Math.abs(wheel.scrollTop - Number(wheel.dataset.centered)) < 1) return;
      clearTimeout(timers.get(wheel));
      if (!drag) timers.set(wheel, setTimeout(settleWheels, 160));
    }, { passive: true });
    wheel.addEventListener('keydown', event => {
      const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
      let index = pickerWheelIndex(wheel.scrollTop, wheel.children.length);
      if (event.key in steps) index += steps[event.key];
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = wheel.children.length - 1;
      else return;
      event.preventDefault();
      const button = wheel.children[Math.max(0, Math.min(wheel.children.length - 1, index))];
      pending = pickerDate(readWheels(), wheel.dataset.dateWheel, Number(button.dataset.value));
      paintWheels();
      wheel.querySelector('[aria-pressed=true]').focus({ preventScroll: true });
    });
    wheel.addEventListener('pointerdown', event => {
      suppressUntil = 0;
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      clearTimeout(timers.get(wheel));
      drag = { id: event.pointerId, y: event.clientY, top: wheel.scrollTop, moved: false };
    });
    wheel.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const distance = event.clientY - drag.y;
      if (!drag.moved && Math.abs(distance) < 6) return;
      drag.moved = true;
      wheel.setPointerCapture(drag.id);
      wheel.style.scrollSnapType = 'none';
      wheel.classList.add('is-dragging');
      event.preventDefault();
      wheel.scrollTop = drag.top - distance;
    });
    function release(event, cancel = false) {
      if (!drag || drag.id !== event.pointerId) return;
      const { id, moved } = drag;
      drag = null;
      if (wheel.hasPointerCapture(id)) wheel.releasePointerCapture(id);
      wheel.style.scrollSnapType = '';
      wheel.classList.remove('is-dragging');
      if (moved) suppressUntil = Date.now() + 300;
      if (!dialog.open) return;
      if (cancel) paintWheels(); else if (moved) settleWheels();
    }
    wheel.addEventListener('pointerup', event => release(event));
    wheel.addEventListener('pointercancel', event => release(event, true));
    wheel.addEventListener('lostpointercapture', event => release(event, true));
    wheel.addEventListener('pointerleave', event => { if (drag && !drag.moved) release(event, true); });
    wheel.addEventListener('click', event => {
      if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  dialog.querySelector('.date-picker-close').onclick = () => dialog.close();
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([tabindex="-1"])')]
      .filter(button => !button.disabled && button.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.querySelector('.date-picker-apply').onclick = () => {
    // Include the latest scroll position even if its debounce has not fired yet.
    const date = readWheels();
    onSelect(date);
    dialog.close();
  };
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    for (const timer of timers.values()) clearTimeout(timer);
    for (const button of buttons) button.setAttribute('aria-expanded', 'false');
    (opener?.getClientRects().length ? opener : fallback)?.focus({ preventScroll: true });
  });
  return { update };
}

if (typeof module !== 'undefined') module.exports = { pickerDate, pickerWheelIndex };
