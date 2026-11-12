const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = () => fs.readFileSync('src/web/js/assistant-ui.js', 'utf8');
// Load the same shared element factory as the page, rather than mocking it.
function loadUI(context) {
  vm.runInContext(fs.readFileSync('src/web/js/core.js', 'utf8'), context);
  vm.runInContext(script(), context);
}
test('assistant dialog is opt-in, labelled and text-only with stop and native focus', () => {
  const html = fs.readFileSync('src/web/index.html', 'utf8');
  assert.match(html, /id="assistant-open"[^>]*hidden/);
  assert.match(html, /<dialog id="assistant-dialog" aria-labelledby="assistant-title"/);
  assert.match(html, /id="assistant-thread"[^>]*aria-live="polite"/);
  const js = script();
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|\.href\s*=/);
  assert.match(js, /showModal\(/); assert.match(js, /\.abort\(/);
  assert.match(js, /launcher\.focus\(/);
  assert.match(html, /id="assistant-stop"[^>]*hidden/);
  assert.match(html, /id="assistant-retry"[^>]*>Check Connection</);
  assert.match(js, /shiftKey/);
  assert.match(js, /input\.disabled = true/);
});
test('navigation validates trusted dates and uid against actual expanded events', () => {
  const context = vm.createContext({ document: { getElementById: () => null }, Date, console });
  loadUI(context);
  assert.equal(vm.runInContext("assistantValidDate('2026-02-30T09:00:00Z')", context), false);
  assert.equal(vm.runInContext("assistantValidDate('javascript:alert(1)')", context), false);
  assert.equal(vm.runInContext("assistantValidDate('2026-11-05T09:00:00Z')", context), true);
});

test('disabled UI stays hidden; enabled UI streams inert text, navigates known events and restores focus', async () => {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    focus() { this.focused = true; }
  }
  const ids = ['open', 'dialog', 'question', 'thread', 'state', 'send', 'stop', 'retry', 'privacy', 'load', 'close', 'form', 'input-row', 'new', 'provider-pick', 'check'];
  const elements = Object.fromEntries(ids.map(id => ['assistant-' + id, new Element()]));
  let enabled = false, calls = 0, navigated = false, opened = false;
  const known = { start: new Date('2026-11-05T09:00:00Z'), extendedProps: { uid: 'a' } };
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    Date, AbortController, TextDecoder, setInterval, clearInterval, setTimeout: () => 1, clearTimeout() {}, Math,
    calendar: { gotoDate() { navigated = true; } }, sources: [], expandSources: () => [known], showEventDialog() { opened = true; },
    fetch: async (url, opts) => {
      calls++;
      if (url.endsWith('/status')) return new Response(JSON.stringify({ enabled, reachable: true, model: 'test', timezone: 'Asia/Manila' }));
      if (url.endsWith('/providers')) return new Response(JSON.stringify({ current: 'llamacpp', locked: false, items: [] }));
      assert.equal(JSON.parse(opts.body).question, 'Thursday?');
      return new Response([
        { type: 'sources', data: { title: '<script>bad</script>' }, records: [{ uid: 'a', start: known.start.toISOString(), title: 'Known event' }] },
        { type: 'step', text: 'Reading the calendar: list_events' }, { type: 'content', text: '<img src=x onerror=bad()>[evil](javascript:bad())' }, { type: 'done' }
      ].map(JSON.stringify).join('\n'));
    }
  });
  loadUI(context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['assistant-open'].hidden, true); assert.equal(calls, 1);
  enabled = true; await elements['assistant-retry'].onclick();
  assert.equal(elements['assistant-open'].hidden, false);
  elements['assistant-open'].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['assistant-question'].focused, true);
  elements['assistant-question'].value = 'Thursday?';
  await elements['assistant-form'].onsubmit({ preventDefault() {} });
  const [asked, reply] = elements['assistant-thread'].children;
  assert.equal(asked.textContent, 'Thursday?'); assert.equal(asked.className, 'msg user');
  assert.match(reply.children[1].textContent, /<img src=x/);
  assert.equal(reply.children[0].hidden, false); assert.equal(reply.children[0].children[0].textContent, 'Reading the calendar: list_events'); assert.equal(reply.children[0].children[0].className, 'step done');
  assert.match(elements['assistant-state'].textContent, /complete/);
  const action = reply.children[2].children.at(-1);
  action.onclick();
  assert.equal(navigated, true); assert.equal(opened, true);
  assert.equal(elements['assistant-open'].focused, true);
});

test('chat memory: sends earlier exchanges, applies summaries, New chat and the 5 minute expiry clear it', async () => {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); } replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; } showModal() { this.open = true; } close() { this.open = false; } focus() {}
  }
  const ids = ['open', 'dialog', 'question', 'thread', 'state', 'send', 'stop', 'retry', 'privacy', 'load', 'close', 'form', 'input-row', 'new', 'provider-pick', 'check'];
  const elements = Object.fromEntries(ids.map(id => ['assistant-' + id, new Element()]));
  const bodies = []; let timer = null, replies = [{ type: 'content', text: 'one' }, { type: 'done' }];
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    Date, AbortController, TextDecoder, setInterval, clearInterval, Math,
    setTimeout: (fn, ms) => { timer = { fn, ms }; return 1; }, clearTimeout: () => { timer = null; },
    fetch: async (url, opts) => {
      if (url.endsWith('/status')) return new Response(JSON.stringify({ enabled: true, reachable: true, timezone: 'UTC' }));
      if (url.endsWith('/providers')) return new Response(JSON.stringify({ current: 'llamacpp', locked: false, items: [] }));
      bodies.push(JSON.parse(opts.body)); return new Response(replies.map(JSON.stringify).join('\n'));
    }
  });
  loadUI(context);
  await new Promise(resolve => setImmediate(resolve));
  const ask = async text => { elements['assistant-question'].value = text; await elements['assistant-form'].onsubmit({ preventDefault() {} }); };
  await ask('first'); await ask('second');
  assert.deepEqual(bodies[0].memory, { summary: '', turns: [] });
  assert.deepEqual(bodies[1].memory.turns, [{ question: 'first', answer: 'one' }]);
  assert.equal(timer.ms, 5 * 60 * 1000);
  await ask('third');
  replies = [{ type: 'memory', summary: 'SUM' }, { type: 'content', text: 'four' }, { type: 'done' }];
  await ask('fourth');
  assert.equal(bodies[3].memory.turns.length, 3);
  await ask('fifth');
  assert.deepEqual(bodies[4].memory, { summary: 'SUM', turns: [{ question: 'fourth', answer: 'four' }] });
  elements['assistant-new'].onclick();
  assert.match(elements['assistant-state'].textContent, /New chat/); assert.equal(elements['assistant-thread'].children.length, 0);
  await ask('sixth'); assert.deepEqual(bodies[5].memory, { summary: '', turns: [] });
  await ask('seventh'); assert.equal(bodies[6].memory.turns.length, 1);
  timer.fn();
  assert.match(elements['assistant-state'].textContent, /5 minutes/); assert.equal(elements['assistant-thread'].children.length, 0);
  await ask('eighth'); assert.deepEqual(bodies[7].memory, { summary: '', turns: [] });
});

test('Check Connection shows its result; the provider dropdown lists all providers but switches only to set-up ones', async () => {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; this.children = []; this.listeners = {}; this.options = []; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.options = nodes; }
    addEventListener(name, fn) { this.listeners[name] = fn; } showModal() { this.open = true; } close() { this.open = false; } focus() {}
  }
  const ids = ['open', 'dialog', 'question', 'thread', 'state', 'send', 'stop', 'retry', 'privacy', 'load', 'close', 'form', 'input-row', 'new', 'provider-pick', 'check'];
  const elements = Object.fromEntries(ids.map(id => ['assistant-' + id, new Element()]));
  let testResult = { ok: true, model: 'MiniCPM' }, switched = null;
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    Date, AbortController, TextDecoder, setInterval, clearInterval, setTimeout: () => 1, clearTimeout() {}, Math,
    fetch: async (url, opts) => {
      if (url.endsWith('/status')) return new Response(JSON.stringify({ enabled: true, reachable: true, timezone: 'UTC' }));
      if (url.endsWith('/providers')) return new Response(JSON.stringify({ current: 'anthropic', locked: false, items: [
        { name: 'anthropic', label: 'Anthropic', available: true }, { name: 'openai', label: 'OpenAI', available: false, hint: 'Add an API key.' }, { name: 'llamacpp', label: 'Built-in', available: true }] }));
      if (url.endsWith('/test')) return new Response(JSON.stringify(testResult));
      if (url.endsWith('/provider')) { switched = JSON.parse(opts.body).provider; return new Response('ok'); }
    }
  });
  loadUI(context);
  await new Promise(resolve => setImmediate(resolve));
  elements['assistant-open'].onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  const options = elements['assistant-provider-pick'].options;
  assert.deepEqual(options.map(o => [o.value, o.disabled]), [['anthropic', false], ['openai', true], ['llamacpp', false]]);
  assert.match(options[1].textContent, /not set up/);
  elements['assistant-provider-pick'].value = 'llamacpp';
  await elements['assistant-provider-pick'].onchange();
  assert.equal(switched, 'llamacpp');
  await elements['assistant-retry'].onclick();
  assert.match(elements['assistant-check'].textContent, /Connected · MiniCPM/);
  testResult = { ok: false, reason: 'token-rejected' };
  await elements['assistant-retry'].onclick();
  assert.match(elements['assistant-check'].textContent, /rejected/); assert.match(elements['assistant-check'].className, /bad/);
});
