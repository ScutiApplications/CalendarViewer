const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Only the DOM and timer boundaries are simulated; run the actual gesture handlers.
function wheel() {
  const handlers = {}, timers = new Map(), selected = [];
  let timerId = 0;
  const preview = { textContent: '' };
  const root = {
    dataset: {},
    clientWidth: 350, scrollLeft: 0, style: {}, children: [],
    classList: { add() {}, remove() {} },
    addEventListener(name, handler) { handlers[name] = handler; },
    replaceChildren(...nodes) { this.children = nodes; nodes.forEach((n, i) => { n.offsetLeft = i * 50; n.offsetWidth = 50; }); },
    querySelector() { return this.children.find(n => n.attributes['aria-pressed'] === 'true'); },
    contains() { return false; },
    setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {},
    ownerDocument: { activeElement: null, createElement() { return { dataset: {}, style: {}, attributes: {}, append() {}, setAttribute(k, v) { this.attributes[k] = String(v); }, focus() {} }; } }
  };
  const context = vm.createContext({
    document: root.ownerDocument, Date,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  const file = path.join(__dirname, '../src/web/js/date-wheel.js');
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  assert.equal(typeof context.createDateWheel, 'function', 'date-wheel gestures must be implemented');
  const ui = context.createDateWheel(root, date => { selected.push(date); ui.render(date); }, preview);
  ui.render(new Date(2026, 11, 31));
  const send = (type, values = {}) => {
    let prevented = false;
    handlers[type]?.({ preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...values });
    return prevented;
  };
  const settle = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  return { root, selected, send, settle, preview, ui };
}

test('scrolling the date wheel snaps to a day across the year boundary', () => {
  const w = wheel();
  assert.equal(w.send('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0 }), true);
  w.settle();
  assert.deepEqual(w.selected.map(d => [d.getFullYear(), d.getMonth(), d.getDate()]), [[2027, 0, 2]]);
  w.settle();
  assert.equal(w.selected.length, 1, 'recentering must not select another date');
});

test('mouse dragging rolls the dates and suppresses the accidental release click', () => {
  const w = wheel();
  w.send('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 200, clientY: 20 });
  w.send('pointermove', { pointerId: 1, clientX: 100, clientY: 22 });
  assert.equal(w.selected.length, 0, 'do not change the calendar during a drag');
  w.send('pointerup', { pointerId: 1 });
  assert.equal(w.send('click'), true);
  w.settle();
  assert.equal(w.selected[0].getDate(), 2);
  assert.equal(w.selected[0].getMonth(), 0);
});

test('vertical gestures and cancelled drags do not change the chosen day', () => {
  const w = wheel();
  w.send('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 200, clientY: 20 });
  w.send('pointermove', { pointerId: 1, clientX: 198, clientY: 100 });
  w.send('pointerup', { pointerId: 1 });
  w.settle();
  assert.equal(w.selected.length, 0);
  w.send('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 2, clientX: 200, clientY: 20 });
  w.send('pointermove', { pointerId: 2, clientX: 100, clientY: 22 });
  w.send('pointercancel', { pointerId: 2 });
  w.settle();
  assert.equal(w.selected.length, 0);
});

test('keyboard date navigation and tapping still select real calendar dates', () => {
  const w = wheel();
  assert.equal(w.send('keydown', { key: 'ArrowRight' }), true);
  assert.equal(w.selected[0].getFullYear(), 2027);
  assert.equal(w.selected[0].getDate(), 1);
  w.root.children[9].onclick();
  assert.equal(w.selected[1].getFullYear(), 2026);
  assert.equal(w.selected[1].getDate(), 31);
});

test('leaving the strip before a drag begins cannot block later wheel scrolling', () => {
  const w = wheel();
  w.send('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 200, clientY: 20 });
  w.send('pointerleave', { pointerId: 1 });
  w.send('wheel', { deltaX: 50, deltaY: 0, deltaMode: 0 });
  w.settle();
  assert.equal(w.selected.length, 1);
  assert.equal(w.selected[0].getDate(), 1);
});

test('dragging previews the exact date that will be committed on release', () => {
  const w = wheel();
  w.send('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 200, clientY: 20 });
  w.send('pointermove', { pointerId: 1, clientX: 100, clientY: 22 });
  const candidate = w.root.children.find(n => n.dataset.preview === 'true');
  assert.ok(candidate, 'the pending date must be highlighted while dragging');
  assert.equal(new Date(Number(candidate.dataset.date)).getDate(), 2);
  assert.match(w.preview.textContent, /Release to select/);
  assert.equal(w.selected.length, 0);
  w.send('pointerup', { pointerId: 1 });
  w.settle();
  assert.equal(w.selected[0].getTime(), Number(candidate.dataset.date));
  assert.match(w.preview.textContent, /Selected:/);
});

test('the drum faces curve away from the center and hide dates behind the wheel', () => {
  const w = wheel();
  assert.match(w.root.children[10].style.transform || '', /rotateY\(0deg\)/);
  assert.match(w.root.children[11].style.transform || '', /rotateY\(-/);
  assert.match(w.root.children[9].style.transform || '', /rotateY\([\d.]+deg\)/);
  assert.equal(w.root.children[0].style.visibility, 'hidden');
  assert.equal(w.root.children[10].style.visibility, 'visible');
});

test('the wheel side arrows select adjacent days', () => {
  const w = wheel();
  assert.equal(typeof w.ui.step, 'function');
  w.ui.step(1);
  assert.equal(w.selected[0].getFullYear(), 2027);
  assert.equal(w.selected[0].getDate(), 1);
  w.ui.step(-1);
  assert.equal(w.selected[1].getFullYear(), 2026);
  assert.equal(w.selected[1].getDate(), 31);
});
