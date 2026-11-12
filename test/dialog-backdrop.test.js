const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  class HTMLDialogElement { constructor(busy) { this.open = true; this.busy = busy; } requestClose() { if (!this.busy) this.open = false; } }
  const listeners = {};
  const context = vm.createContext({ HTMLDialogElement, document: { addEventListener: (name, fn) => { listeners[name] = fn; } } });
  vm.runInContext(fs.readFileSync('src/web/js/dialog-backdrop.js', 'utf8'), context);
  return { Dialog: HTMLDialogElement, down: target => listeners.pointerdown({ target }), click: target => listeners.click({ target }) };
}
test('every dialog closes on a backdrop press, through requestClose so a busy dialog can refuse', () => {
  const { Dialog, down, click } = setup();
  const free = new Dialog(false), busy = new Dialog(true);
  down(free); click(free); assert.equal(free.open, false);
  down(busy); click(busy); assert.equal(busy.open, true);
});
test('a press that starts inside a dialog, or a click on its content, does not close it', () => {
  const { Dialog, down, click } = setup();
  const dialog = new Dialog(false), content = {};
  down(content); click(dialog);          // drag from the content out to the backdrop
  assert.equal(dialog.open, true);
  down(content); click(content);         // ordinary click inside
  assert.equal(dialog.open, true);
  click(dialog);                         // release with no matching press
  assert.equal(dialog.open, true);
});
test('the script is loaded by the page before main.js', () => {
  const html = fs.readFileSync('src/web/index.html', 'utf8');
  const at = html.indexOf('/js/dialog-backdrop.js');
  assert.ok(at > 0 && at < html.indexOf('/js/main.js'));
});
