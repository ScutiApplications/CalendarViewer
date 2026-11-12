const test = require('node:test');
const assert = require('node:assert/strict');
const { write } = require('../src/shared/storage');
function store() {
  const data = new Map([['a', 'old']]);
  return { data, getItem: key => data.get(key) ?? null, removeItem: key => data.delete(key), setItem: (key, value) => data.set(key, value) };
}
test('restore preflight writes no live settings and successful apply replaces the selected keys', () => {
  const s = store();
  write(s, { a: 'new', b: 'added' }, true);
  assert.deepEqual([...s.data], [['a', 'old']]);
  write(s, { a: 'new', b: 'added' });
  assert.deepEqual([...s.data], [['a', 'new'], ['b', 'added']]);
});
test('a partial storage failure rolls back every changed key', () => {
  const s = store(), set = s.setItem;
  s.setItem = (key, value) => { if (key === 'b' && value === 'bad') throw Error('Quota exceeded'); set(key, value); };
  assert.throws(() => write(s, { a: 'new', b: 'bad' }), /Quota/);
  assert.deepEqual([...s.data], [['a', 'old']]);
});
