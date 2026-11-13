// @ts-check
// Fetches calendar feeds with a timeout, a size cap and hand-followed redirects.

const FEED_TIMEOUT_MS = Number(process.env.CALENDAR_FEED_TIMEOUT_MS) || 20000; // the override is for tests
const FEED_MAX_BYTES = 10e6;
const MAX_REDIRECTS = 5;

// Plain-language reasons for the HTTP statuses a calendar service returns when a private ICS link no longer works.
function feedStatusMessage(status) {
  if (status === 401 || status === 403) return 'Link rejected (HTTP ' + status + '). It may have expired or been revoked. Create a new ICS link in your calendar service and re-add it.';
  if (status === 404 || status === 410) return 'Link not found (HTTP ' + status + '). It may have been reset. Create a new ICS link in your calendar service and re-add it.';
  if (status === 429) return 'Calendar service is rate limiting requests (HTTP 429). Try again later.';
  if (status >= 500) return 'Calendar service error (HTTP ' + status + '). Try again later.';
  return 'Upstream returned HTTP ' + status;
}

// A rejected private link often redirects to a sign-in page that answers 200 with HTML. Parsing that would show an empty calendar.
function looksLikeWebPage(text) {
  return /^\uFEFF?\s*<(?:!doctype\s+html|html|head|body|\?xml)/i.test(text.slice(0, 200));
}
const WEB_PAGE_MESSAGE = 'Link returned a web page, not a calendar. It is probably a sign-in page. Create a new ICS link in your calendar service and re-add it.';

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
      if (!r.ok) throw new Error(feedStatusMessage(r.status));
      const chunks = [];
      let size = 0;
      for await (const c of r.body) {
        size += c.length;
        if (size > FEED_MAX_BYTES) { r.body.cancel().catch(() => {}); throw new Error('Feed is larger than 10 MB'); }
        chunks.push(c);
      }
      const text = Buffer.concat(chunks).toString();
      if (looksLikeWebPage(text)) throw new Error(WEB_PAGE_MESSAGE);
      return text;
    } catch (e) { throw e.name === 'TimeoutError' ? new Error('Feed timed out') : e; }
  };
}

module.exports = { createFeedFetcher, feedStatusMessage, looksLikeWebPage };
