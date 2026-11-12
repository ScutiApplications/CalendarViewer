// A rolling date strip. Touch uses native scrolling; mouse drags use pointer capture.
function createDateWheel(root, onSelect, preview) {
  const doc = root.ownerDocument;
  let selected, drag = null, settleTimer, suppressClickUntil = 0;
  const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  function centerButton(button) {
    root.scrollLeft = button.offsetLeft + button.offsetWidth / 2 - root.clientWidth / 2;
  }
  function nearestButton() {
    if (!root.children.length || !root.clientWidth) return null;
    const center = root.scrollLeft + root.clientWidth / 2;
    return [...root.children].reduce((best, button) =>
      Math.abs(button.offsetLeft + button.offsetWidth / 2 - center) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - center) ? button : best);
  }
  function updatePreview(moving = false) {
    const candidate = nearestButton();
    if (!candidate) return;
    const center = root.scrollLeft + root.clientWidth / 2;
    const first = root.children[0], second = root.children[1];
    const spacing = second.offsetLeft - first.offsetLeft;
    const radius = Math.max(100, root.clientWidth / 2 - 25);
    for (const button of root.children) {
      const distance = button.offsetLeft + button.offsetWidth / 2 - center;
      const angle = distance / spacing * 0.33;
      const depth = Math.max(0, Math.cos(angle));
      button.dataset.preview = String(button === candidate);
      button.style.transform = `translateX(${Math.sin(angle) * radius - distance}px) rotateY(${-angle * 48}deg) scale(${0.62 + depth * 0.38})`;
      button.style.opacity = String(Math.max(0.12, depth * depth));
      button.style.zIndex = String(Math.round(depth * 100) + 1);
      button.style.visibility = Math.abs(angle) > 1.65 ? 'hidden' : 'visible';
    }
    if (preview) {
      const date = new Date(Number(candidate.dataset.date));
      const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      preview.textContent = moving ? 'Release to select ' + label : 'Selected: ' + label + ' · Drag to change';
    }
  }
  function render(date) {
    clearTimeout(settleTimer);
    selected = shift(date, 0);
    const focused = root.contains(doc.activeElement);
    root.replaceChildren(...Array.from({ length: 21 }, (_, i) => {
      const day = shift(selected, i - 10);
      const button = doc.createElement('button');
      button.className = 'compact-day';
      button.type = 'button';
      button.dataset.date = String(day.getTime());
      button.tabIndex = i === 10 ? 0 : -1;
      button.setAttribute('aria-label', day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      button.setAttribute('aria-pressed', String(i === 10));
      if (day.toDateString() === new Date().toDateString()) button.setAttribute('aria-current', 'date');
      const weekday = doc.createElement('span'), number = doc.createElement('strong');
      weekday.textContent = day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
      number.textContent = day.getDate();
      button.append(weekday, number);
      button.onclick = () => onSelect(day);
      return button;
    }));
    root.style.scrollSnapType = 'none';
    const active = root.querySelector('[aria-pressed=true]');
    centerButton(active);
    root.style.scrollSnapType = '';
    updatePreview();
    if (focused) active.focus({ preventScroll: true });
  }
  function settle() {
    if (drag || !selected || !root.clientWidth) return;
    root.style.scrollSnapType = '';
    const nearest = nearestButton();
    const date = new Date(Number(nearest.dataset.date));
    if (date.getTime() !== selected.getTime()) onSelect(date);
    else { centerButton(nearest); updatePreview(); }
  }
  function scheduleSettle() {
    clearTimeout(settleTimer);
    if (!drag) settleTimer = setTimeout(settle, 160);
  }
  root.addEventListener('scroll', () => {
    const candidate = nearestButton();
    updatePreview(!!drag?.moved || (candidate && Number(candidate.dataset.date) !== selected?.getTime()));
    scheduleSettle();
  }, { passive: true });
  root.addEventListener('wheel', event => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta || event.ctrlKey) return; // Preserve browser pinch-to-zoom.
    event.preventDefault();
    root.style.scrollSnapType = 'none';
    root.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth : 1);
    updatePreview(true);
    scheduleSettle();
  }, { passive: false });
  root.addEventListener('pointerdown', event => {
    suppressClickUntil = 0;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    clearTimeout(settleTimer);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: root.scrollLeft, moved: false };
  });
  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return;
      drag.moved = true;
      root.setPointerCapture(drag.id);
      root.style.scrollSnapType = 'none';
      root.classList.add('is-dragging');
    }
    event.preventDefault();
    root.scrollLeft = drag.left - dx;
    updatePreview(true);
  });
  function endDrag(event, cancelled) {
    if (!drag || event.pointerId !== drag.id) return;
    const { id, moved } = drag;
    drag = null;
    root.classList.remove('is-dragging');
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    if (moved) suppressClickUntil = Date.now() + 300;
    if (cancelled) render(selected);
    else scheduleSettle();
  }
  root.addEventListener('pointerup', event => endDrag(event, false));
  root.addEventListener('pointercancel', event => endDrag(event, true));
  root.addEventListener('lostpointercapture', event => endDrag(event, true));
  root.addEventListener('pointerleave', event => { if (drag && !drag.moved) endDrag(event, true); });
  root.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  root.addEventListener('keydown', event => {
    const days = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 }[event.key];
    if (!days) return;
    event.preventDefault();
    onSelect(shift(selected, days));
    root.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
  });
  return { render, step: days => onSelect(shift(selected, days)) };
}
