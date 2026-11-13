const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static checks on the page markup. They catch common mistakes without a browser; a full axe run needs a browser tool.
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'index.html'), 'utf8');
const tags = name => [...html.matchAll(new RegExp('<' + name + '\\b([^>]*)>([\\s\\S]*?)(?=<\\/' + name + '>|$)', 'g'))]
  .map(m => ({ attrs: m[1], inner: m[2].replace(/<[^>]+>/g, '').trim() }));
const attr = (attrs, name) => (new RegExp('\\b' + name + '="([^"]*)"').exec(attrs) || [])[1];
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('element ids are unique', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const duplicates = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual(duplicates, []);
});

test('every dialog is named by a heading that exists', () => {
  for (const { attrs } of tags('dialog')) {
    const label = attr(attrs, 'aria-labelledby');
    assert.ok(label, 'dialog ' + attr(attrs, 'id') + ' has no aria-labelledby');
    for (const id of label.split(/\s+/)) assert.ok(ids.has(id), id + ' is missing');
  }
});

test('every button has visible text or an aria-label', () => {
  for (const { attrs, inner } of tags('button')) {
    assert.ok(inner || attr(attrs, 'aria-label') || attr(attrs, 'title'), 'unnamed button: ' + attrs.trim());
  }
});

test('aria-controls, aria-describedby and aria-labelledby point at existing ids', () => {
  for (const m of html.matchAll(/aria-(?:controls|describedby|labelledby)="([^"]+)"/g)) {
    for (const id of m[1].split(/\s+/)) assert.ok(ids.has(id), 'missing id ' + id);
  }
});

test('visible form fields have a label, aria-label or wrapping label', () => {
  const unnamed = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="(hidden|checkbox|radio|file)"/.test(attrs) && /\bhidden\b/.test(attrs)) continue;
    const id = attr(attrs, 'id');
    const named = attr(attrs, 'aria-label') || attr(attrs, 'aria-labelledby') ||
      (id && new RegExp('<label[^>]*\\bfor="' + id + '"').test(html));
    if (named) continue;
    // A field inside a <label>...</label> element is named by it.
    const before = html.slice(0, m.index);
    const insideLabel = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    if (!insideLabel) unnamed.push(attrs.trim());
  }
  assert.deepEqual(unnamed, []);
});

test('images have alt text', () => {
  for (const { attrs } of tags('img')) assert.notEqual(attr(attrs, 'alt'), undefined, attrs.trim());
});

test('the page declares a language and a title', () => {
  assert.match(html, /<html lang="[a-z-]+"/);
  assert.match(html, /<title>[^<]+<\/title>/);
});
