// Consent stays in this browser. Every hosted request also carries the shared notice acknowledgement.
globalThis.CalendarPrivacy = (() => {
  const key = 'ics-calendar-viewer.hostedConsent.v1';
  const dialog = document.getElementById('ai-consent-dialog');
  const acknowledgement = document.getElementById('ai-consent-ack');
  const allow = document.getElementById('ai-consent-allow');
  const decline = document.getElementById('ai-consent-decline');
  const notice = document.getElementById('ai-consent-storage');
  const requests = new Set();
  const volatile = new Set();
  const storageWarnings = new Map();
  const storageKey = provider => key + '.' + provider;
  let records = read(), pending = null;
  function parse(value, provider) {
    try {
      const data = JSON.parse(value);
      return CalendarConsent.valid(data, provider) ? data : undefined;
    } catch { return undefined; }
  }
  function read() {
    try {
      return Object.fromEntries(Object.keys(CalendarConsent.LABELS)
        .map(provider => [provider, parse(localStorage.getItem(storageKey(provider)), provider)])
        .filter(([, value]) => value));
    } catch { return {}; }
  }
  function receipt(provider) {
    if (!CalendarConsent.hosted(provider)) return undefined;
    if (!volatile.has(provider)) {
      try {
        const latest = parse(localStorage.getItem(storageKey(provider)), provider);
        if (latest) records[provider] = latest; else delete records[provider];
      } catch { /* A choice already made on this page can remain in memory if storage becomes blocked. */ }
    }
    return CalendarConsent.valid(records[provider], provider) ? { ...records[provider] } : undefined;
  }
  function notify(provider, withdrawn = false) {
    for (const request of requests) {
      if ((withdrawn && (provider === null || provider === request.provider)) || !receipt(request.provider)) request.controller.abort();
    }
    window.dispatchEvent(new CustomEvent('calendar-consent-change', { detail: { provider, withdrawn, warning: storageWarnings.get(provider) || '' } }));
  }
  function save(provider, accepted) {
    if (accepted) records[provider] = { provider, accepted: true, revision: CalendarConsent.REVISION, grantedAt: new Date().toISOString() };
    else delete records[provider];
    storageWarnings.delete(provider);
    try {
      // Independent keys prevent another tab's unrelated provider save from restoring an old grant.
      if (accepted) localStorage.setItem(storageKey(provider), JSON.stringify(records[provider]));
      else localStorage.removeItem(storageKey(provider));
      volatile.delete(provider);
    }
    catch {
      volatile.add(provider);
      // Removing the old record prevents an old grant returning after a failed withdrawal write.
      let cleared = false;
      try { localStorage.removeItem(storageKey(provider)); cleared = true; } catch { /* Report that persistence could not be changed. */ }
      const warning = accepted ? 'Browser could not save this choice. Consent applies to this page only.' :
        cleared ? 'Consent withdrawn. This provider will ask again after reload.' :
          'Consent withdrawn for this page. Clear this site’s browser data before reloading to remove any previously saved choice.';
      storageWarnings.set(provider, warning);
    }
    notify(provider, !accepted);
  }
  function description(provider) {
    if (!CalendarConsent.hosted(provider)) return 'Built-in models run on this PC. Hosted-AI sharing consent is not needed.';
    const warning = storageWarnings.get(provider);
    return `${CalendarConsent.LABELS[provider]}: ${receipt(provider) ? 'sharing allowed' : 'sharing not allowed'}. Choice applies to this browser only.` + (warning ? ' ' + warning : '');
  }
  async function manage(provider) {
    if (!CalendarConsent.hosted(provider) || !dialog) return false;
    if (pending) return pending.provider === provider ? pending.promise : false;
    const previousFocus = document.activeElement;
    document.getElementById('ai-consent-provider').textContent = CalendarConsent.LABELS[provider];
    const policy = document.getElementById('ai-consent-provider-policy');
    policy.href = CalendarConsent.POLICIES[provider];
    policy.textContent = CalendarConsent.LABELS[provider] + ' API data policy';
    document.getElementById('ai-consent-revision').textContent = 'Notice revision: ' + CalendarConsent.REVISION;
    const granted = !!receipt(provider);
    acknowledgement.checked = granted;
    allow.disabled = !acknowledgement.checked;
    allow.textContent = granted ? 'Keep sharing allowed' : 'Allow sharing with ' + CalendarConsent.LABELS[provider];
    decline.textContent = granted ? 'Withdraw consent' : 'Not now';
    notice.textContent = storageWarnings.get(provider) || '';
    dialog.returnValue = '';
    const promise = new Promise(resolve => {
      dialog.addEventListener('close', () => {
        pending = null;
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(!!receipt(provider));
      }, { once: true });
    });
    pending = { provider, promise };
    allow.onclick = () => { if (acknowledgement.checked) { save(provider, true); dialog.close(); } };
    decline.onclick = () => { save(provider, false); dialog.close(); };
    dialog.showModal();
    decline.focus();
    return promise;
  }
  acknowledgement.addEventListener('change', () => { allow.disabled = !acknowledgement.checked; });
  document.getElementById('ai-consent-close').onclick = () => dialog.close();
  window.addEventListener('storage', event => {
    try { if (event.storageArea && event.storageArea !== localStorage) return; }
    catch { records = {}; volatile.clear(); storageWarnings.clear(); notify(null, true); return; }
    if (event.key === null) { records = {}; volatile.clear(); storageWarnings.clear(); notify(null, true); return; }
    const provider = Object.keys(CalendarConsent.LABELS).find(name => event.key === storageKey(name));
    if (!provider) return;
    const value = parse(event.newValue, provider);
    storageWarnings.delete(provider);
    volatile.delete(provider);
    if (value) records[provider] = value; else delete records[provider];
    // A queued withdrawal still cancels old work even if storage already holds a newer grant.
    notify(provider, !value);
  });
  return Object.freeze({
    receipt, description, manage,
    ensure: provider => provider === 'llamacpp' ? Promise.resolve(true) : receipt(provider) ? Promise.resolve(true) : manage(provider),
    track(controller, provider) {
      if (!CalendarConsent.hosted(provider)) return () => {};
      const request = { controller, provider }; requests.add(request);
      if (!receipt(provider)) controller.abort();
      return () => requests.delete(request);
    }
  });
})();
