// Browser helpers with no page state: safe storage, element factory, links, status text and fetch wrappers.
// localStorage throws when blocked or full, so every access goes through here. Reads fall back; writes report only when given a message.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  list(key) { const value = store.json(key, []); return Array.isArray(value) ? value : []; },
  set(key, value, failure) {
    try { localStorage.setItem(key, value); }
    catch (e) { if (failure) setStatus(failure + ': ' + e.message); }
  }
};
function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function externalLink(href, text, className) {
  const link = create('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const setStatus = msg => {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.title = msg; // The strip truncates long messages; the full text stays available on hover.
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
  return r;
}
const apiJson = async (path, opts) => (await api(path, opts)).json();
// Machine-changing routes need this header; the server refuses them without it.
const apiAction = (path, opts = {}) => apiJson(path, { ...opts, headers: { 'X-Calendar-Action': '1', ...opts.headers } });
