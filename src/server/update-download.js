// @ts-check
// Enterprise asset downloads may redirect to signed storage URLs. Credentials never follow off-origin.
async function fetchUpdateAsset(url, { fetch: fetchImpl = global.fetch, headers = {}, allowedHost = 'github.com', signal } = /** @type {{ fetch?: typeof fetch, headers?: Record<string, string>, allowedHost?: string, signal?: AbortSignal }} */ ({})) {
  let address = new URL(url), credentialsAllowed = true;
  const permitted = value => value.protocol === 'https:' && value.host === allowedHost && !value.username && !value.password;
  if (!permitted(address)) throw new Error('Invalid update download address.');
  for (let redirects = 0; ; redirects++) {
    const requestHeaders = { 'User-Agent': 'CalendarViewer', ...headers };
    if (!credentialsAllowed) for (const name of Object.keys(requestHeaders)) if (name.toLowerCase() === 'authorization') delete requestHeaders[name];
    let response;
    try { response = await fetchImpl(address.href, { headers: requestHeaders, redirect: 'manual', signal }); }
    catch { throw new Error('Could not download from GitHub (github.com).'); }
    if (![302, 307].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (redirects >= 3) throw new Error('Update download redirected too many times.');
    let next;
    try { next = new URL(location || '', address); } catch { throw new Error('Invalid update redirect.'); }
    if (!location || next.protocol !== 'https:' || next.username || next.password) throw new Error('Update redirects must use HTTPS.');
    if (!permitted(next)) credentialsAllowed = false;
    address = next;
  }
}

module.exports = { fetchUpdateAsset };
