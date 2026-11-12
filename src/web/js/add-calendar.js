// Adding calendars: link form, .ics files, and drag and drop onto the sidebar.
async function addFiles(files) {
  for (const f of files) {
    try {
      const icsText = await f.text();
      const events = parseIcs(icsText);
      sources.push({
        id: nextId++,
        alertKey: 'l:' + crypto.randomUUID(),
        name: f.name.replace(/\.ics$/i, ''),
        color: PALETTE[sources.length % PALETTE.length],
        enabled: true,
        events,
        icsText
      });
    } catch (e) {
      setStatus('Could not read ' + f.name + ': ' + e.message);
    }
  }
  saveLocalSources();
  renderSources();
  calendar.refetchEvents();
  setAddCardOpen(false);
}

document.getElementById('add').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({ name: f.name.value, url: f.url.value, color: PALETTE[sources.length % PALETTE.length] })
    });
    f.reset();
    setAddCardOpen(false);
    await loadFeeds();
  } catch (err) { setStatus('Add failed: ' + err.message); }
};

// ---- Add card ----
const addToggle = document.getElementById('add-toggle');
const addCard = document.getElementById('add-card');
const addForm = document.getElementById('add');
const dropZone = document.getElementById('drop');
function setAddMode(mode) {
  addForm.hidden = mode !== 'link';
  dropZone.hidden = mode !== 'file';
  document.getElementById('mode-link').setAttribute('aria-pressed', String(mode === 'link'));
  document.getElementById('mode-file').setAttribute('aria-pressed', String(mode === 'file'));
}
function setAddCardOpen(open) {
  addCard.hidden = !open;
  addToggle.setAttribute('aria-expanded', String(open));
  addToggle.setAttribute('aria-label', open ? 'Close add calendar' : 'Add calendar');
  addToggle.title = addToggle.getAttribute('aria-label');
  addToggle.classList.toggle('open', open);
  if (open) { setAddMode('link'); addForm.elements.name.focus(); }
}
addToggle.onclick = () => setAddCardOpen(addCard.hidden);
document.getElementById('mode-link').onclick = () => setAddMode('link');
document.getElementById('mode-file').onclick = () => setAddMode('file');

// ---- .ics files: choose them in the File tab, or drop them anywhere on the sidebar ----
const fileInput = document.getElementById('file');
function acceptFiles(files) {
  const accepted = [], skipped = [];
  files.forEach(f => (/\.ics$/i.test(f.name) || f.type === 'text/calendar' ? accepted : skipped).push(f));
  if (skipped.length) setStatus('Skipped ' + skipped.map(f => f.name).join(', ') + ': not an .ics file');
  if (accepted.length) addFiles(accepted);
}
fileInput.onchange = () => { acceptFiles([...fileInput.files]); fileInput.value = ''; };

const sidebar = document.getElementById('sidebar');
const dropOverlay = document.getElementById('drop-overlay');
const hasFiles = e => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let dragDepth = 0; // dragenter/dragleave also fire for child elements, so count them
sidebar.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
sidebar.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
sidebar.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
sidebar.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  acceptFiles([...e.dataTransfer.files]);
});
