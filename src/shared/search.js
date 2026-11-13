(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function matches(event, query) {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return true;
    const p = event.extendedProps || {};
    return [event.title, p.location, p.description, p.people]
      .some(value => String(value || '').toLowerCase().includes(term));
  }

  // Assistant search (the page search above stays title/location only).
  const wordsOf = text => String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  // shortcut: plural stripping only drops a final "s"; no real stemmer, upgrade if irregular plurals matter.
  // Small models pass whole questions ("when is the budget review"); filler words must not have to match.
  const STOP = new Set('a an the is are was be of on in at to for with my me i what when where which who whats do does did any there about and or'.split(' '));
  const stem = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
  function withinOneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const x = a.slice(i), y = b.slice(i);
    return x.slice(1) === y.slice(1) || x.slice(1) === y || x === y.slice(1);
  }
  // Weight of the field a word was found in: title beats people and location, which beat the description.
  const FIELDS = [['title', 3], ['people', 2], ['location', 2], ['description', 1]];
  function fieldWords(event) {
    const p = event.extendedProps || {};
    const values = { title: event.title, people: p.people, location: p.location, description: p.description };
    return FIELDS.map(([name, weight]) => ({ weight, words: wordsOf(values[name]).map(stem) }));
  }
  // 0 = no match. Every query word must hit; fuzzy also accepts one typo in words of 5+ letters;
  // any lets some words miss (score is the sum of the hits).
  function score(event, query, { fuzzy = false, any = false } = {}) {
    const words = wordsOf(query), content = words.filter(w => !STOP.has(w));
    const need = (content.length ? content : words).map(stem);
    if (!need.length) return 1;
    const fields = fieldWords(event);
    let total = 0;
    for (const w of need) {
      let best = 0;
      for (const { weight, words } of fields) {
        for (const h of words) {
          const s = h === w ? weight + 0.5 : h.startsWith(w) ? weight : fuzzy && w.length >= 5 && withinOneEdit(w, h) ? weight * 0.5 : 0;
          if (s > best) best = s;
        }
      }
      if (!best && !any) return 0;
      total += best;
    }
    return total;
  }
  const matchesWords = (event, query, options) => score(event, query, options) > 0;
  return { matches, matchesWords, score, stem, wordsOf };
});
