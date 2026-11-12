// Fetches calendar feeds with a timeout, a size cap and hand-followed redirects.

const FEED_TIMEOUT_MS = Number(process.env.CALENDAR_FEED_TIMEOUT_MS) || 20000; // the override is for tests
const FEED_MAX_BYTES = 10e6;
const MAX_REDIRECTS = 5;

// A hung or endless feed must not stall alert refreshes or MCP calls. Redirects are followed by hand to cap the hops.
function createFeedFetcher() {
  return async function fetchFeedText(feed) {
    const signal = AbortSignal.timeout(FEED_TIMEOUT_MS);
    let r, link = feed.url;
    try {
      for (let hops = 0; ; hops++) {
        r = await fetch(link, { redirect: 'manual', signal });
        const next = r.status >= 300 && r.status < 400 && r.headers.get('location');
        if (!next) break;
        if (hops >= MAX_REDIRECTS) throw new Error('Feed redirects too many times');
        await r.body?.cancel();
        link = new URL(next, link).href;
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error('Feed timed out') : e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const chunks = [];
    let size = 0;
    try {
      for await (const c of r.body) {
        size += c.length;
        if (size > FEED_MAX_BYTES) { r.body.cancel().catch(() => {}); throw new Error('Feed is larger than 10 MB'); }
        chunks.push(c);
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error('Feed timed out') : e; }
    return Buffer.concat(chunks).toString();
  };
}

module.exports = { createFeedFetcher };
