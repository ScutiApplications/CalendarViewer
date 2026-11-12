// The same strict allowlist runs before preview in the browser and before any server writes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../vendor/ical.min.js'), require('./alert-logic.js'));
  else root.CalendarBackup = factory(root.ICAL, { sanitizeRules, normalizeFeedUrl, MAX_OFFSET_MIN, VIEWS });
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ICAL, logic) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const fail = message => { throw new Error('Invalid backup: ' + message); };
  const object = (v, label) => { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(label + ' must be an object'); return v; };
  const str = (v, label, max = 4096) => { if (typeof v !== 'string' || !v.length || v.length > max || /\u0000/.test(v)) fail(label + ' must be text'); return v; };
  const bool = (v, label) => { if (typeof v !== 'boolean') fail(label + ' must be true or false'); return v; };
  const color = v => { if (typeof v !== 'string' || !/^#[\da-f]{6}$/i.test(v)) fail('calendar color'); return v; };
  const id = v => { str(v, 'id', 200); if (!/^[\w-]+$/.test(v) || badKeys.has(v)) fail('id'); return v; };
  const array = (v, label) => { if (!Array.isArray(v) || v.length > 10000) fail(label + ' must be an array with at most 10000 entries'); return v; };
  function unique(rows, key) { const seen = new Set(); rows.forEach(row => { if (seen.has(row[key])) fail('duplicate ' + key); seen.add(row[key]); }); return rows; }
  function safeTree(v, depth = 0) {
    if (depth > 30) fail('nesting too deep');
    if (!v || typeof v !== 'object') return;
    if (!Array.isArray(v)) object(v, 'value');
    for (const key of Object.keys(v)) { if (badKeys.has(key)) fail('unsafe object key'); safeTree(v[key], depth + 1); }
  }
  function rules(raw) {
    object(raw, 'alertRules'); object(raw.global, 'alertRules.global'); bool(raw.global.muted, 'muted');
    object(raw.calendars, 'alertRules.calendars'); object(raw.events, 'alertRules.events');
    const offsets = list => array(list, 'offsets').forEach(n => { if (!Number.isInteger(n) || n <= 0 || n > logic.MAX_OFFSET_MIN) fail('alert offset'); });
    Object.entries(raw.calendars).forEach(([key, value]) => { str(key, 'calendar rule key'); if (!/^[fl]:[\w-]+$/.test(key)) fail('calendar rule key'); object(value,'calendar rule'); bool(value.enabled,'enabled'); offsets(value.offsets); });
    Object.entries(raw.events).forEach(([key, value]) => { str(key, 'event rule key'); object(value,'event rule'); if (!['muted','custom'].includes(value.mode)) fail('event rule mode'); offsets(value.offsets); });
    return logic.sanitizeRules(raw);
  }
  function validateBackup(raw) {
    // JSON length guards object callers as well as uploaded text. No unknown property is retained.
    let serialized; try { serialized = JSON.stringify(raw); } catch { fail('cannot serialize payload'); }
    if (!serialized || new TextEncoder().encode(serialized).length > MAX_BYTES) fail('file exceeds 20 MB');
    safeTree(raw); object(raw, 'backup');
    if (raw.format !== 'ics-calendar-viewer-backup' || raw.version !== 1) fail('unsupported format or version');
    if (typeof raw.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(raw.createdAt) || !Number.isFinite(Date.parse(raw.createdAt))) fail('creation date');
    const feeds = unique(array(raw.feeds,'feeds').map(f => {
      object(f,'feed'); let url; try { url = new URL(f.url); } catch { fail('feed URL'); }
      if (!['http:','https:','webcal:'].includes(url.protocol) || !url.hostname || typeof f.url !== 'string' || f.url.length > 16000) fail('feed URL');
      return {id:id(f.id),name:str(f.name,'feed name'),color:color(f.color),url:logic.normalizeFeedUrl(f.url)};
    }), 'id');
    const localSources = unique(array(raw.localSources,'localSources').map(s => {
      object(s,'local source'); str(s.alertKey,'local key',202); if (!/^l:[\w-]+$/.test(s.alertKey)) fail('local key');
      str(s.icsText,'ICS',MAX_BYTES); let parsed;
      try { parsed = new ICAL.Component(ICAL.parse(s.icsText)); if (parsed.name !== 'vcalendar') fail('ICS root'); parsed.getAllSubcomponents('vevent').forEach(e => { const ev = new ICAL.Event(e); if (!ev.startDate) fail('event start'); ev.startDate.toJSDate(); if (ev.endDate) ev.endDate.toJSDate(); }); } catch { fail('calendar ICS'); }
      if (!/^\s*BEGIN:VCALENDAR\r?\n/i.test(s.icsText) || !/END:VCALENDAR\s*$/i.test(s.icsText)) fail('calendar ICS');
      return {name:str(s.name,'local name'),color:color(s.color),enabled:bool(s.enabled,'enabled'),icsText:s.icsText,alertKey:s.alertKey};
    }), 'alertKey');
    const feedIds = new Set(feeds.map(f => f.id));
    const feedPreferences = unique(array(raw.feedPreferences,'feedPreferences').map(f => { object(f,'feed preference'); if (!feedIds.has(f.feedId)) fail('preference references missing feed'); return {feedId:id(f.feedId),name:str(f.name,'feed preference name'),color:color(f.color),enabled:bool(f.enabled,'enabled')}; }), 'feedId');
    const p = object(raw.preferences,'preferences'), h = object(p.workingHours,'workingHours');
    if (!['system','light','dark'].includes(p.theme)) fail('theme');
    if (![h.start,h.end].every(v => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) || h.start === h.end) fail('working hours');
    if (![0,1,5,10,15,30,60].includes(p.autoRefreshMinutes)) fail('refresh interval');
    if (!logic.VIEWS.includes(p.view)) fail('view');
    return {format:raw.format,version:1,createdAt:raw.createdAt,feeds,localSources,feedPreferences,alertRules:rules(raw.alertRules),preferences:{theme:p.theme,workingHours:{start:h.start,end:h.end},autoRefreshMinutes:p.autoRefreshMinutes,hideCancelled:bool(p.hideCancelled,'hideCancelled'),view:p.view}};
  }
  function parseBackup(text) { if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) fail('file exceeds 20 MB'); let raw; try { raw = JSON.parse(text); } catch { fail('file is not JSON'); } return validateBackup(raw); }
  return { MAX_BYTES, validateBackup, parseBackup };
});
