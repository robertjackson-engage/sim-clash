// The Foresight bridge's panel (docs/foresight-bridge.md): what the bridge is doing, in
// plain words, and its auto / on / off switch. Self-contained: give it a container.
//
//   import { mountForesightPanel } from './arcade/foresight-panel.js';
//   const panel = mountForesightPanel(container, { fetchJson, events });
//   panel.update(status)    // a status from GET /api/foresight or the 'foresight' event
//   panel.refresh()         // ask the server now
//   panel.dispose()         // stop listening and ticking (also happens by itself once the
//                           //   container has left the page)
//
// Options (all optional):
//   fetchJson(url, opts) -> Promise<json | null>     default: fetch
//   events        the page's EventSource on /events: the panel follows its 'foresight'
//                 event; without it the panel asks the server every `pollMs` (4 s)
//   css           false: do not add the stylesheet (arcade/foresight-panel.css) yourself
//   onStatus(status)   called with every status shown
//
// Classes are prefixed fb-. Sizes are in em: the panel takes the font size of where it is
// put. No sound, no animation loops.

const STATE_TONE = {
  'connector-connected': 'ok', listening: 'wait', starting: 'wait', 'port-in-use': 'warn', 'no-log': 'warn', error: 'warn', off: 'off',
};
const MODES = [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']];
const MODE_HELP = {
  auto: 'Auto: on when the Foresight connector is installed on this PC.',
  on: 'On: always listening for the Foresight connector.',
  off: 'Off: the game leaves the Foresight connector alone.',
};

let lastStatus = null;      // the newest status any panel saw: a panel mounted again shows it at once

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function agoText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 3) return 'just now';
  if (s < 90) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/**
 * A status as words: { tone: 'ok' | 'wait' | 'warn' | 'off', title, help, last }.
 * `last` is the last-shot line ('' when there has been none).
 */
export function describeForesight(status, now = Date.now()) {
  const s = status || {};
  const port = s.port || 9050;
  const state = s.state || 'off';
  let title = 'Off';
  let help = '';
  switch (state) {
    case 'connector-connected':
      if (s.shots > 0) { title = 'Foresight connected'; help = 'Shots are coming through.'; }
      else { title = 'Connector found, waiting for a shot'; help = s.logFound === false ? 'Hit a ball. (The connector writes its log with the first shot.)' : 'Hit a ball.'; }
      break;
    case 'listening':
      title = 'Waiting for the connector';
      help = 'Open the Foresight connector (GSPconnect) and connect your launch monitor.';
      break;
    case 'starting':
      title = 'Starting';
      help = 'One moment.';
      break;
    case 'port-in-use':
      title = `Port ${port} is busy`;
      help = `Close GSPro or any other bridge: something else is using port ${port}. The game takes over by itself a few seconds later.`;
      if (s.unowned > 0) help += ' Shots hit meanwhile were left to that program.';
      break;
    case 'no-log':
      if (s.active === false) {
        title = 'No Foresight connector on this PC';
        help = 'Nothing to do if you play with another launch monitor. If GSPro is installed somewhere else, set the connector folder under Details.';
      } else {
        title = 'Connector folder not found';
        help = `Looked for ${s.logDir || 'the GSPro connector folder'}. The connector (GSPconnect) comes with GSPro: install it, or set its folder under Details.`;
      }
      break;
    case 'error':
      title = `Cannot listen on port ${port}`;
      help = s.lastError ? `Windows said: ${s.lastError}.` : 'The port could not be opened.';
      break;
    default:
      if (s.idleReason === 'private-instance') {
        title = 'Idle on this copy of the game';
        help = 'Auto only runs on the main game (default ports). Choose On to use the bridge here.';
      } else {
        title = 'Off';
        help = 'For Foresight GC launch monitors (GCQuad, GC3, GCHawk, Launch Pro) through the GSPro connector. Choose Auto or On to use it.';
      }
  }
  let last = '';
  if (s.lastShotAt) {
    const mph = s.lastShot && Number.isFinite(s.lastShot.Speed) ? ` · ${s.lastShot.Speed.toFixed(1)} mph` : '';
    last = `Last shot ${agoText(now - s.lastShotAt)}${mph}`;
  }
  // no connector on this PC under Auto is not a fault: most launch monitors need no bridge
  const tone = state === 'no-log' && s.active === false ? 'off' : (STATE_TONE[state] || 'off');
  return { tone, title, help, last };
}

function ensureCss(doc) {
  if (doc.querySelector('link[data-fb-css]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./foresight-panel.css', import.meta.url).href;
  link.setAttribute('data-fb-css', '1');
  doc.head.appendChild(link);
}

const defaultFetchJson = (url, opts) => fetch(url, opts).then((r) => r.json()).catch(() => null);

export function mountForesightPanel(container, { fetchJson = defaultFetchJson, events = null, css = true, pollMs = 4000, onStatus = null } = {}) {
  const doc = container.ownerDocument;
  if (css) ensureCss(doc);
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const root = el('div', 'fb-panel fb-tone-off');
  const head = el('div', 'fb-head');
  const dot = el('span', 'fb-dot');
  dot.setAttribute('aria-hidden', 'true');
  const words = el('div', 'fb-words');
  const title = el('b', 'fb-title', 'Foresight bridge');
  const help = el('span', 'fb-help', '');
  words.append(title, help);
  head.append(dot, words);
  root.setAttribute('role', 'status');

  const row = el('div', 'fb-row');
  const label = el('span', 'fb-label', 'Foresight bridge');
  const tag = el('em', 'fb-tag', 'EXPERIMENTAL');
  label.append(' ', tag);
  const seg = el('div', 'fb-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Foresight bridge');
  const buttons = MODES.map(([mode, text]) => {
    const b = el('button', 'fb-mode', text);
    b.type = 'button';
    b.dataset.mode = mode;
    b.title = MODE_HELP[mode];
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.addEventListener('click', () => setMode(mode));
    seg.append(b);
    return b;
  });
  row.append(label, seg);

  const last = el('div', 'fb-last', '');
  const note = el('div', 'fb-note', '');

  const more = el('details', 'fb-more');
  const summary = el('summary', null, 'Details');
  const facts = el('div', 'fb-facts');
  const pathRow = el('label', 'fb-path');
  const pathLabel = el('span', null, 'Connector folder (where GSPconnect.exe is)');
  const pathInput = el('input', 'fb-input');
  pathInput.type = 'text';
  pathInput.spellcheck = false;
  pathInput.placeholder = 'C:\\GSProV1\\Core\\GSPC';
  const pathSave = el('button', 'fb-save', 'Save');
  pathSave.type = 'button';
  const pathLine = el('div', 'fb-path-line');
  pathLine.append(pathInput, pathSave);
  pathRow.append(pathLabel, pathLine);
  const legal = el('p', 'fb-legal', 'Experimental. You need your own GSPro installation: the connector (GSPconnect) is part of GSPro, and the game neither includes nor changes it. The game only listens on a local port and reads the log the connector writes. Not affiliated with or endorsed by Foresight Sports or GSPro.');
  more.append(summary, facts, pathRow, legal);
  // typing a path must not fire the game's keys
  for (const type of ['keydown', 'keyup', 'keypress']) pathInput.addEventListener(type, (e) => e.stopPropagation());
  pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePath(); });
  pathSave.addEventListener('click', () => savePath());

  root.append(head, row, last, note, more);
  container.append(root);

  let status = lastStatus;
  let disposed = false;
  let busy = false;
  let message = '';

  function render() {
    const s = status;
    const d = describeForesight(s);
    root.className = `fb-panel fb-tone-${d.tone}`;
    root.dataset.state = (s && s.state) || 'unknown';
    title.textContent = s ? d.title : 'Foresight bridge';
    help.textContent = s ? d.help : 'Checking...';
    last.textContent = d.last;
    last.hidden = !d.last;
    const mode = s ? s.mode : null;
    for (const b of buttons) {
      const on = b.dataset.mode === mode;
      b.classList.toggle('fb-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.disabled = busy;
    }
    const pinned = s && s.modeFrom === 'env' ? 'The mode is set by BIRDIE_FORESIGHT for this run; your choice is kept for the next one.' : '';
    note.textContent = message || pinned;
    note.hidden = !note.textContent;
    facts.replaceChildren();
    if (s) {
      const fact = (k, v) => { const p = el('div', 'fb-fact'); p.append(el('span', 'fb-k', k), el('span', 'fb-v', v)); facts.append(p); };
      fact('Listening on', s.listening ? `${s.host}:${s.port}` : `not listening (${s.host}:${s.port})`);
      fact('Connector', s.connections ? `connected (${s.connections})` : 'not connected');
      fact('Connector log', `${s.logFile || ''}${s.logFound ? '' : s.dirFound === false ? '  (folder not found)' : '  (not written yet)'}`);
      fact('Shots this session', String(s.shots || 0));
      if (doc.activeElement !== pathInput) pathInput.value = s.savedLogFile ? s.savedLogFile.replace(/[\\/]ConnectDebug\.txt$/i, '') : '';
    }
  }

  function update(next) {
    if (disposed || !next || typeof next !== 'object' || next.ok === false) return;
    status = next;
    lastStatus = next;
    render();
    if (onStatus) { try { onStatus(next); } catch (_) { /* the host's problem */ } }
  }

  async function refresh() {
    const s = await fetchJson('/api/foresight');
    update(s);
    return s;
  }

  async function post(body) {
    if (busy) return null;
    busy = true; message = ''; render();
    let out = null;
    try {
      out = await fetchJson('/api/foresight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } finally { busy = false; }
    if (out && out.ok !== false) update(out);
    else { message = (out && out.error) || 'Could not change the setting.'; render(); }
    return out;
  }
  function setMode(mode) { return post({ mode }); }
  function savePath() { return post({ logFile: pathInput.value.trim() }); }

  const onEvent = (e) => { try { update(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
  const live = !!(events && typeof events.addEventListener === 'function');
  if (live) events.addEventListener('foresight', onEvent);
  // one timer: the "12 s ago" line, the fallback poll, and letting go once off the page
  let pollDue = live ? pollMs * 5 : pollMs;
  let ticks = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) { if (++ticks > 3) dispose(); return; }
    ticks = 0;
    if (status && status.lastShotAt) last.textContent = describeForesight(status).last;
    pollDue -= 1000;
    if (pollDue <= 0) { pollDue = live ? pollMs * 5 : pollMs; refresh(); }
  }, 1000);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    if (live && typeof events.removeEventListener === 'function') events.removeEventListener('foresight', onEvent);
    root.remove();
  }

  render();
  refresh();
  return { el: root, update, refresh, setMode, dispose, destroy: dispose, get status() { return status; } };
}

export default mountForesightPanel;
