const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../src/web/js/date-picker.js');
const picker = fs.existsSync(file) ? require(file) : {};

test('month and year wheel changes clamp invalid days and preserve the original date', () => {
  assert.equal(typeof picker.pickerDate, 'function');
  const january = new Date(2026, 0, 31, 16, 30);
  const february = picker.pickerDate(january, 'month', 1);
  assert.deepEqual([february.getFullYear(), february.getMonth(), february.getDate()], [2026, 1, 28]);
  assert.equal(january.getDate(), 31);
  const leapDay = new Date(2028, 1, 29);
  assert.equal(picker.pickerDate(leapDay, 'year', 2029).getDate(), 28);
  assert.equal(picker.pickerDate(new Date(2028, 0, 31), 'month', 1).getDate(), 29);
});

test('date wheel scroll positions select the closest row and stay inside the available values', () => {
  assert.equal(typeof picker.pickerWheelIndex, 'function');
  assert.equal(picker.pickerWheelIndex(0, 12), 0);
  assert.equal(picker.pickerWheelIndex(65, 12), 1);
  assert.equal(picker.pickerWheelIndex(67, 12), 2);
  assert.equal(picker.pickerWheelIndex(-30, 12), 0);
  assert.equal(picker.pickerWheelIndex(100000, 12), 11);
});

test('the date picker supports years below 100 without mapping them to the 1900s', () => {
  assert.equal(typeof picker.pickerDate, 'function');
  const result = picker.pickerDate(new Date(2026, 5, 15), 'year', 80);
  assert.equal(result.getFullYear(), 80);
  assert.equal(result.getMonth(), 5);
  assert.equal(result.getDate(), 15);
});

function modal() {
  class Node {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.handlers = {}; this.scrollTop = 0; this.style = {}; this.classList = { add() {}, remove() {} }; }
    get firstElementChild() { return this.children[0]; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    querySelector() { return this.children.find(node => node.attributes['aria-pressed'] === 'true'); }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    focus() { doc.activeElement = this; }
    getClientRects() { return [{}]; }
  }
  const wheels = ['month', 'day', 'year'].map(field => { const node = new Node(); node.dataset.dateWheel = field; return node; });
  const close = new Node(), apply = new Node(), summary = new Node(), dialog = new Node();
  dialog.querySelectorAll = selector => selector === '[data-date-wheel]' ? wheels : [close, ...wheels.map(wheel => wheel.querySelector()), apply];
  dialog.querySelector = selector => selector.includes('summary') ? summary : selector.includes('close') ? close : apply;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.handlers.close(); };
  const buttons = ['month', 'day', 'year'].map(field => { const node = new Node(); node.dataset.dateField = field; return node; });
  const timers = new Map(); let nextTimer = 0, selected;
  const doc = { createElement: () => new Node(), activeElement: null };
  const context = vm.createContext({ Date, document: doc, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  context.createDatePicker(dialog, { getDate: () => new Date(2026, 0, 15), onSelect: date => { selected = date; }, buttons });
  buttons[0].onclick();
  return { wheels, apply, close, dialog, doc, selected: () => selected };
}

test('clicking a day preserves a month wheel change before its debounce settles', () => {
  const m = modal();
  m.wheels[0].scrollTop = 44; // February is centered, while pending still contains January.
  m.wheels[0].handlers.scroll();
  m.wheels[1].children[15].onclick();
  m.apply.onclick();
  assert.equal(m.selected().getMonth(), 1);
  assert.equal(m.selected().getDate(), 16);
});

test('keyboard changes preserve another wheel position that has not settled yet', () => {
  const m = modal();
  m.wheels[0].scrollTop = 44;
  m.wheels[0].handlers.scroll();
  m.wheels[2].handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  m.apply.onclick();
  assert.equal(m.selected().getFullYear(), 2027);
  assert.equal(m.selected().getMonth(), 1);
});

test('Apply includes an unsettled scroll instead of applying the old date', () => {
  const m = modal();
  m.wheels[0].scrollTop = 44;
  m.wheels[0].handlers.scroll();
  m.apply.onclick();
  assert.equal(m.selected().getMonth(), 1);
  assert.equal(m.selected().getDate(), 15);
});

test('Tab and Shift+Tab wrap within the date modal', () => {
  const m = modal();
  m.apply.focus();
  m.dialog.handlers.keydown?.({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(m.doc.activeElement, m.close);
  m.close.focus();
  m.dialog.handlers.keydown?.({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(m.doc.activeElement, m.apply);
});
