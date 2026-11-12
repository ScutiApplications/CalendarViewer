const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const logic = require('../src/shared/alert-logic.js');
const { createMcpHandler } = require('../src/server/mcp.js');

const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  ...[['a', 'Standup', '20261102T090000Z', '20261102T100000Z', ''], ['b', 'Review', '20261102T093000Z', '20261102T103000Z', 'Room 4'],
    ['c', 'Lunch', '20261103T120000Z', '20261103T130000Z', 'Cafe']].flatMap(([uid, title, start, end, where]) =>
    ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DTSTART:' + start, 'DTEND:' + end, ...(where ? ['LOCATION:' + where] : []), 'END:VEVENT']),
  'END:VCALENDAR'
].join('\r\n');
const sources = async () => [{ id: 1, alertKey: 'l:x', name: 'Work', color: '#2563eb', enabled: true, events: logic.parseIcs(ics) }];
const mcp = createMcpHandler({ sources, now: () => Date.parse('2026-11-02T08:00:00Z') });
const rpc = (method, params, id = 1) => mcp.handle({ jsonrpc: '2.0', id, method, params });
const tool = async (name, args) => {
  const reply = await rpc('tools/call', { name, arguments: args });
  return { ...reply.result, data: reply.result && JSON.parse(reply.result.content[0].text) };
};
const day = { start: '2026-11-02T00:00:00Z', end: '2026-11-04T00:00:00Z' };

test('initialize negotiates the protocol and notifications get no reply', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await rpc('nope')).error.code, -32601);
  assert.equal((await mcp.handle({ id: 1 })).error.code, -32600);
});

test('every tool is declared read-only', async () => {
  const { tools } = (await rpc('tools/list')).result;
  assert.deepEqual(tools.map(t => t.name), ['list_calendars', 'list_events', 'get_event', 'up_next', 'conflicts']);
  assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
});

test('list_events filters by range and query, and marks overlaps', async () => {
  const all = (await tool('list_events', day)).data;
  assert.deepEqual(all.events.map(e => e.title), ['Standup', 'Review', 'Lunch']);
  assert.deepEqual(all.events[0].overlapsWith, ['Review']);
  assert.deepEqual((await tool('list_events', { ...day, query: 'cafe' })).data.events.map(e => e.title), ['Lunch']);
  assert.equal((await tool('list_events', { start: '2026-11-02T00:00:00Z', end: '2026-11-02T08:30:00Z' })).data.total, 0);
});

test('conflicts, up_next, get_event and list_calendars', async () => {
  assert.deepEqual((await tool('conflicts', day)).data.map(e => e.title), ['Standup', 'Review']);
  assert.deepEqual((await tool('up_next', { limit: 2 })).data.map(e => e.title), ['Standup', 'Review']);
  const event = (await tool('get_event', { uid: 'b' })).data;
  assert.equal(event.location, 'Room 4');
  assert.equal(event.occurrences.length, 1);
  assert.deepEqual((await tool('list_calendars', {})).data, [{ name: 'Work', kind: 'imported', enabled: true, events: 3 }]);
});

test('bad input is reported as a tool error, not a crash', async () => {
  for (const [name, args] of [['list_events', { start: 'x' }], ['list_events', { start: '2026-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z' }],
    ['get_event', {}], ['get_event', { uid: 'missing' }], ['up_next', { limit: 0 }]]) {
    const r = await tool(name, args);
    assert.equal(r.isError, true, name + JSON.stringify(args));
  }
  assert.equal((await rpc('tools/call', { name: 'toString', arguments: {} })).error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'up_next', arguments: [] })).error.code, -32602);
});
