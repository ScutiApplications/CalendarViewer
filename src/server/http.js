// Response helpers shared by the route table and the static file server.
// Everything is served from this origin; inline styles stay allowed because FullCalendar injects a <style> element.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');
const sendError = (res, e) => send(res, e.status || 400, e.message);

// Over the limit, stop collecting and fail with 413; the request is drained so the reply can still be sent.
const readBody = (req, limit = 1e5) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0, over = false;
  req.on('data', c => {
    if (over) return;
    size += c.length;
    if (size > limit) { over = true; req.resume(); return reject(Object.assign(new Error('Request body too large'), { status: 413 })); }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  req.on('error', reject);
});

module.exports = { SECURITY_HEADERS, send, sendJson, sendError, readBody };
