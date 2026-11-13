const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Consent = require('../src/shared/privacy-consent');
const Releases = require('../src/shared/release-notes');

const consentKey = 'ics-calendar-viewer.hostedConsent.v1';
const notesKey = 'ics-calendar-viewer.releaseNotes.v1';
const settle = () => new Promise(resolve => setImmediate(resolve));

// Native dialog/storage boundaries only; the production scripts own choices and presentation.
function browser({ values = new Map(), blocked = false, version = '1.0.4', otherDialog = false } = {}) {
  const events = new Map(), elements = new Map();
  class Element {
    constructor() { this.children = []; this.listeners = new Map(); this.isConnected = true; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, listener, options) {
      const list = this.listeners.get(name) || []; list.push({ listener, once: options?.once }); this.listeners.set(name, list);
    }
    fire(name) {
      const list = this.listeners.get(name) || [];
      this.listeners.set(name, list.filter(item => !item.once));
      for (const { listener } of list) listener({});
    }
    showModal() { this.open = true; this.shown = (this.shown || 0) + 1; }
    close() { this.open = false; this.fire('close'); }
    focus() { this.focused = true; }
  }
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = vm.createContext({
    CalendarConsent: Consent, CalendarReleases: Releases, Date, AbortController, AbortSignal, queueMicrotask,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: {
      hidden: false, activeElement: new Element(), getElementById: element,
      querySelector: () => otherDialog || [...elements.values()].some(item => item.open),
      addEventListener: (name, callback) => events.set(name, callback)
    },
    window: { addEventListener: (name, callback) => events.set(name, callback), dispatchEvent: event => events.get(event.type)?.(event) },
    localStorage: {
      getItem: key => { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw new Error('blocked'); values.set(key, value); },
      removeItem: key => { if (blocked) throw new Error('blocked'); values.delete(key); }
    },
    create: (tag, className, text) => Object.assign(new Element(), { tag, className, textContent: text }),
    navigator: {}, apiJson: async () => ({ version })
  });
  return { context, element, events, values,
    unblockDialogs() { otherDialog = false; events.get('close')?.(); },
    load(name) { vm.runInContext(fs.readFileSync('src/web/js/' + name + '.js', 'utf8'), context); }
  };
}

test('consent is explicit, provider-specific and revision-specific', () => {
  const accepted = { accepted: true, provider: 'openai', revision: Consent.REVISION };
  assert.equal(Consent.valid(accepted, 'openai'), true);
  for (const value of [null, {}, { ...accepted, accepted: 'true' }, { ...accepted, revision: 'old' }]) assert.equal(Consent.valid(value, 'openai'), false);
  assert.equal(Consent.valid(accepted, 'gemini'), false);
  assert.equal(Consent.valid(accepted, 'llamacpp'), false);
});

test('browser asks before hosted sharing; withdrawal aborts tracked requests and removes saved choice', async () => {
  const app = browser(); app.load('privacy-ui');
  const privacy = app.context.CalendarPrivacy;
  assert.equal(await privacy.ensure('llamacpp'), true);
  assert.equal(privacy.receipt('openai'), undefined);
  const choice = privacy.ensure('openai');
  assert.equal(app.element('ai-consent-ack').checked, false);
  assert.equal(app.element('ai-consent-allow').disabled, true);
  app.element('ai-consent-ack').checked = true; app.element('ai-consent-ack').fire('change');
  app.element('ai-consent-allow').onclick();
  assert.equal(await choice, true);
  assert.equal(Consent.valid(JSON.parse(app.values.get(consentKey + '.openai')), 'openai'), true);
  assert.equal(privacy.receipt('gemini'), undefined);
  const controller = new AbortController(); const release = privacy.track(controller, 'openai');
  const withdrawal = privacy.manage('openai'); app.element('ai-consent-decline').onclick();
  assert.equal(await withdrawal, false); assert.equal(controller.signal.aborted, true);
  assert.equal(app.values.has(consentKey + '.openai'), false); release();
});

test('blocked storage permits page-only choice and cross-tab removal aborts sharing', async () => {
  const blocked = browser({ blocked: true }); blocked.load('privacy-ui');
  const choice = blocked.context.CalendarPrivacy.ensure('anthropic');
  blocked.element('ai-consent-ack').checked = true; blocked.element('ai-consent-allow').onclick();
  assert.equal(await choice, true);
  assert.match(blocked.context.CalendarPrivacy.description('anthropic'), /page only/);
  const record = { accepted: true, provider: 'openai', revision: Consent.REVISION };
  const app = browser({ values: new Map([[consentKey + '.openai', JSON.stringify(record)]]) }); app.load('privacy-ui');
  const controller = new AbortController(); app.context.CalendarPrivacy.track(controller, 'openai');
  app.values.delete(consentKey + '.openai'); app.events.get('storage')({ key: consentKey + '.openai', newValue: null });
  assert.equal(controller.signal.aborted, true); assert.equal(app.context.CalendarPrivacy.receipt('openai'), undefined);
});

test('independent provider writes cannot restore consent withdrawn in another tab', async () => {
  const record = { accepted: true, provider: 'openai', revision: Consent.REVISION };
  const values = new Map([[consentKey + '.openai', JSON.stringify(record)]]);
  const first = browser({ values }), second = browser({ values }); first.load('privacy-ui'); second.load('privacy-ui');
  const withdrawal = first.context.CalendarPrivacy.manage('openai'); first.element('ai-consent-decline').onclick(); await withdrawal;
  const choice = second.context.CalendarPrivacy.ensure('gemini');
  second.element('ai-consent-ack').checked = true; second.element('ai-consent-allow').onclick(); await choice;
  assert.equal(values.has(consentKey + '.openai'), false);
  assert.equal(second.context.CalendarPrivacy.receipt('openai'), undefined);
});

test('queued withdrawal cancels old requests even when another tab has already regranted', () => {
  const record = { accepted: true, provider: 'openai', revision: Consent.REVISION };
  const app = browser({ values: new Map([[consentKey + '.openai', JSON.stringify(record)]]) }); app.load('privacy-ui');
  let change; app.events.set('calendar-consent-change', event => { change = event.detail; });
  const controller = new AbortController(); app.context.CalendarPrivacy.track(controller, 'openai');
  app.events.get('storage')({ key: consentKey + '.openai', newValue: null });
  assert.equal(controller.signal.aborted, true);
  assert.equal(change.withdrawn, true); assert.equal(change.provider, 'openai');
  assert.equal(Consent.valid(app.context.CalendarPrivacy.receipt('openai'), 'openai'), true);
});

test('release history handles skipped versions and refuses malformed versions', () => {
  assert.deepEqual(Releases.since('1.0.1', '1.0.4').map(item => item.version), ['1.0.4', '1.0.3', '1.0.2']);
  assert.equal(Releases.compare('1.0.10', '1.0.9'), 1);
  assert.equal(Releases.compare('unknown', '1.0.4'), null);
  assert.deepEqual(Releases.through('unknown'), []);
});

test('release notes appear once, wait for dialogs and do not reopen after reload or downgrade', async () => {
  const values = new Map([[notesKey, '1.0.1']]);
  const app = browser({ values, otherDialog: true }); app.load('release-notes-ui'); await settle();
  assert.equal(app.element('release-notes-dialog').shown, undefined);
  app.unblockDialogs(); await settle();
  assert.equal(app.element('release-notes-dialog').shown, 1);
  assert.equal(app.element('release-notes-content').children.length, 3);
  assert.equal(values.get(notesKey), '1.0.4');
  app.element('release-notes-close').onclick();
  const reload = browser({ values }); reload.load('release-notes-ui'); await settle();
  assert.equal(reload.element('release-notes-dialog').shown, undefined);
  await reload.element('show-release-notes').onclick();
  assert.equal(reload.element('release-notes-content').children.length, Releases.through('1.0.4').length);
  const older = browser({ values, version: '1.0.2' }); older.load('release-notes-ui'); await settle();
  assert.equal(older.element('release-notes-dialog').shown, undefined);
  assert.equal(values.get(notesKey), '1.0.4');
});

test('with blocked storage automatic notes are skipped but manual history still opens', async () => {
  const app = browser({ blocked: true }); app.load('release-notes-ui'); await settle();
  assert.equal(app.element('release-notes-dialog').shown, undefined);
  await app.element('show-release-notes').onclick();
  assert.equal(app.element('release-notes-dialog').shown, 1);
});
