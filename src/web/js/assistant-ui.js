// Model dialog; answers are plain text and actions come only from tool records.
function assistantValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function initAssistantUI() {
  const launcher = document.getElementById('assistant-open');
  if (!launcher) return;
  const dialog = document.getElementById('assistant-dialog');
  const input = document.getElementById('assistant-question');
  const thread = document.getElementById('assistant-thread');
  const state = document.getElementById('assistant-state');
  const send = document.getElementById('assistant-send');
  const stop = document.getElementById('assistant-stop');
  const refresh = document.getElementById('assistant-retry');
  const newChat = document.getElementById('assistant-new');
  const picker = document.getElementById('assistant-provider-pick');
  const check = document.getElementById('assistant-check');
  // The chat is remembered in this page only: a summary of older exchanges plus up to 3 recent ones. It is dropped after
  // 5 minutes without use, on New chat, and on reload.
  const CHAT_MS = 5 * 60 * 1000;
  let memory = { summary: '', turns: [] }, expiry = null;
  const keepChat = () => { clearTimeout(expiry); expiry = setTimeout(() => { if (active) keepChat(); else resetChat('The chat was cleared after 5 minutes without use.'); }, CHAT_MS); };
  function resetChat(message) {
    clearTimeout(expiry); expiry = null; memory = { summary: '', turns: [] };
    thread.replaceChildren(); state.textContent = message;
  }
  let active = null, reachable = false;
  const headers = { 'X-Calendar-Action': '1', 'Content-Type': 'application/json' };
  async function status() {
    refresh.disabled = true;
    try {
      const response = await fetch('/api/assistant/status', { headers });
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      launcher.hidden = !data.enabled;
      reachable = data.reachable;
      document.getElementById('assistant-privacy').textContent = `Questions and event details go to ${data.provider === 'llamacpp' ? 'the built-in model on this PC and go no further' : `${data.providerLabel || data.provider} over the internet`}. Dates use ${data.timezone}. Answers can be wrong; check the calendar sources below. Recent questions and answers are sent along for context, then forgotten after 5 minutes without use or when you press New chat.`;
      const load = document.getElementById('assistant-load');
      load.textContent = data.backend && data.backend !== 'cpu' ? 'Automatic GPU acceleration: ' + (data.device || data.backend) + '.' :
        data.load ? `CPU mode. Estimated memory use: ${data.load.ramPercent}% of this PC; estimated CPU use while answering: ${data.load.cpuPercent}%.` : '';
      if (data.accelerationError) load.textContent += ' ' + data.accelerationError;
      load.hidden = !load.textContent;
      state.textContent = reachable ? `Ready${data.model ? ' · ' + data.model : ''}` :
        data.tokenState === 'rejected' ? 'The model service rejected the access token. Update it under Calendar assistant in the sidebar.' :
        data.tokenState === 'missing' ? 'No API key is set. Add one under Calendar assistant in the sidebar.' :
        data.provider === 'llamacpp' ? 'The built-in model is not ready. Download it in the Calendar assistant settings.' :
        'Assistant offline. Check the model service, then press Check Connection. After three failures, restart the calendar server.';
      send.disabled = !reachable || !!active;
    } catch { reachable = false; send.disabled = true; if (dialog.open) state.textContent = 'Assistant offline: calendar server unavailable.'; }
    finally { refresh.disabled = false; }
  }
  // Provider dropdown: every provider is listed, but only the ones that are set up can be picked.
  async function loadProviders() {
    try {
      const response = await fetch('/api/assistant/providers', { headers });
      if (!response.ok) throw new Error('providers');
      const data = await response.json();
      picker.replaceChildren(...data.items.map(item => {
        const option = create('option', '', item.label + (item.available ? '' : ' (not set up)'));
        option.value = item.name; option.title = item.hint || '';
        option.disabled = !item.available && item.name !== data.current;
        return option;
      }));
      picker.value = data.current; picker.disabled = !!data.locked || !!active;
    } catch { picker.disabled = true; }
  }
  picker.onchange = async () => {
    const wanted = picker.value; picker.disabled = true; check.className = 'chat-check'; check.textContent = '';
    try {
      const response = await fetch('/api/assistant/provider', { method: 'POST', headers, body: JSON.stringify({ provider: wanted }) });
      if (!response.ok) throw new Error((await response.text()) || 'Could not switch.');
      state.textContent = 'Switching…'; await status();
    } catch (e) { check.className = 'chat-check bad'; check.textContent = 'Provider not changed: ' + e.message; }
    await loadProviders();
  };
  const FAILURES = { 'not-ready': 'The model is not ready. Download it in the assistant settings.', 'token-rejected': 'The service rejected the access token or API key.', 'no-key': 'No API key is set. Add one in the assistant settings.', 'no-tools': 'The service does not accept tool calls.', 'rate-limited': 'The service is rate limiting this key. Try again shortly.', 'service-error': 'The service returned an error.', unreachable: 'Could not reach the service. Check the address and your connection.' };
  const failureText = r => (FAILURES[r.reason] || 'Connection failed.') + (r.code ? ` (${r.code})` : '') + (r.status ? ` (HTTP ${r.status})` : '') + (r.detail ? ': ' + r.detail : '');
  // Check Connection sends a real one-word test through the chosen provider and shows the outcome under the chat.
  async function checkConnection() {
    refresh.disabled = true; check.className = 'chat-check'; check.textContent = 'Checking the connection…';
    try {
      const response = await fetch('/api/assistant/test', { method: 'POST', headers, body: '{}' });
      if (!response.ok) throw new Error((await response.text()) || 'Could not check.');
      const result = await response.json();
      check.className = 'chat-check ' + (result.ok ? 'ok' : 'bad');
      check.textContent = result.ok ? `Connected${result.model ? ' · ' + result.model : ''}.` : failureText(result);
    } catch (e) { check.className = 'chat-check bad'; check.textContent = 'Could not check: ' + e.message; }
    await status();
  }
  function stopAnswer() { active?.abort(); }
  launcher.onclick = () => { dialog.showModal(); input.focus(); check.textContent = ''; status(); loadProviders(); };
  document.getElementById('assistant-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { stopAnswer(); launcher.focus(); });
  dialog.addEventListener('cancel', stopAnswer);
  stop.onclick = stopAnswer;
  refresh.onclick = checkConnection;
  newChat.onclick = () => { if (active) return; resetChat('New chat started.'); input.focus(); };
  // Enter sends; Shift+Enter inserts a new line.
  input.onkeydown = e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!send.disabled && !active && input.value.trim()) document.getElementById('assistant-form').requestSubmit?.();
  };
  function addRecords(item, host) {
    const group = create('details');
    group.append(create('summary', '', 'Calendar source data (fields may be truncated)'));
    group.append(create('pre', '', JSON.stringify(item.data, null, 2)));
    for (const record of (item.records || []).slice(0, 30)) {
      if (!assistantValidDate(record.start)) continue;
      const button = create('button'); button.type = 'button';
      const date = new Date(record.start);
      button.textContent = `${record.uid ? 'Open event' : 'Jump to date'}: ${record.title} · ${date.toLocaleString()}`;
      button.onclick = () => {
        if (!assistantValidDate(record.start)) return;
        let event;
        if (record.uid) {
          const from = new Date(date); from.setHours(0, 0, 0, 0);
          const to = new Date(from); to.setDate(to.getDate() + 1);
          event = expandSources(sources, from, to).find(e => e.extendedProps.uid === record.uid && +e.start === +date);
          if (!event) { state.textContent = 'This event is no longer in the page calendar. Refresh your calendars.'; return; }
        }
        dialog.close(); calendar.gotoDate(date);
        if (event) showEventDialog(event);
      };
      group.append(button);
    }
    host.append(group);
  }
  document.getElementById('assistant-form').onsubmit = async event => {
    event.preventDefault();
    if (active || !reachable || !input.value.trim()) return;
    const question = input.value.trim(); input.value = '';
    const controller = new AbortController(); active = controller;
    send.disabled = true; send.hidden = true; stop.hidden = false; stop.disabled = false; input.disabled = true; refresh.disabled = true; newChat.disabled = true; picker.disabled = true; keepChat();
    const started = Date.now();
    thread.append(create('div', 'msg user', question));
    const reply = create('div', 'msg bot');
    const steps = create('div', 'steps'); steps.hidden = true;
    const bubble = create('div', 'bubble'); reply.append(steps, bubble); thread.append(reply);
    const toEnd = () => { thread.scrollTop = thread.scrollHeight; }; toEnd();
    state.textContent = 'Thinking…';
    // Slow model servers can take minutes; show that the work is alive.
    const ticker = setInterval(() => { if (!bubble.textContent) { const seconds = Math.round((Date.now() - started) / 1000); state.textContent = `Thinking… ${seconds} s` + (seconds >= 20 ? '. A slow model can take a few minutes; press Stop to cancel.' : ''); } }, 1000);
    const readerState = { done: false, failed: false };
    const consume = line => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.type === 'step') {
        // What the assistant is doing right now, shown in the order it happens; earlier steps are marked done.
        for (const old of steps.children) old.className = 'step done';
        const line = create('div', 'step', String(item.text || '').slice(0, 120));
        steps.hidden = false; steps.append(line); state.textContent = line.textContent + '…'; toEnd();
      }
      else if (item.type === 'content') { for (const old of steps.children) old.className = 'step done'; bubble.textContent += item.text; toEnd(); }
      else if (item.type === 'sources') { addRecords(item, reply); toEnd(); }
      else if (item.type === 'memory') memory = { summary: String(item.summary || ''), turns: [] };
      else if (item.type === 'notice') readerState.notice = String(item.text || '');
      else if (item.type === 'done') readerState.done = true;
      else if (item.type === 'error') { readerState.failed = true; state.textContent = item.message; if (item.offline) reachable = false; }
    };
    let reader;
    try {
      const response = await fetch('/api/assistant', { method: 'POST', headers, body: JSON.stringify({ question, memory, workingHours: typeof workingHours === 'object' && workingHours ? { start: workingHours.start, end: workingHours.end } : undefined }), signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '', bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 1024 * 1024) throw new Error('Assistant response too large.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      }
      buffer += decoder.decode(); consume(buffer);
      if (readerState.done && !readerState.failed) memory.turns.push({ question, answer: bubble.textContent.slice(0, 1500) });
      if (!readerState.failed) state.textContent = readerState.done ? 'Answer complete. The chat is remembered for 5 minutes.' + (readerState.notice ? ' ' + readerState.notice : '') : 'Answer interrupted. Please try again.';
    } catch (e) { state.textContent = controller.signal.aborted ? 'Answer stopped.' : 'Assistant error: ' + e.message; }
    finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      clearInterval(ticker);
      // A reply with no text shows why, in the chat itself.
      if (!bubble.textContent) { bubble.textContent = state.textContent; reply.className = 'msg bot error'; }
      active = null; stop.hidden = true; stop.disabled = true; send.hidden = false; send.disabled = !reachable; input.disabled = false; refresh.disabled = false; newChat.disabled = false; loadProviders(); keepChat();
      if (dialog.open) input.focus();
    }
  };
  status();
}
initAssistantUI();
