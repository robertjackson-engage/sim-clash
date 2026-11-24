'use strict';
// What the desktop window shows before the game is there, and how it remembers its shape
// (v2:release; used by main.js, tested without Electron in test/app-shell.test.js).
//
//   splashUrl(product, { error })   a dark page with the wordmark, as a data: URL: the window
//                                   opens on it at once, so there is never a white flash or
//                                   a blank window while the server starts; with `error` it
//                                   says why the game could not start instead
//   startErrorText(error, ports)    the sentence for that page (a busy port is the usual one)
//   readWindowPrefs / writeWindowPrefs   { fullscreen } in <user data>/window.json: full
//                                   screen by default, and F11 / Alt+Enter is remembered
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colour = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : d);

function splashHtml(product = {}, { error = null } = {}) {
  const c = product.colors || {};
  const ink = colour(c.ink, '#07090d'), p1 = colour(c.p1, '#ff5a36'), p2 = colour(c.p2, '#2e9bff'), gold = colour(c.gold, '#ffd21f');
  const words = Array.isArray(product.wordmark) && product.wordmark.length ? product.wordmark : String(product.name || '').toUpperCase().split(/\s+/);
  const [first, ...rest] = words.filter(Boolean);
  const mark = `<i>${esc(first || '')}</i>${rest.length ? ` <b>${esc(rest.join(' '))}</b>` : ''}`;
  const body = error
    ? `<p class="e">${esc(error)}</p><p class="h">Close this window (Alt+F4) and try again.</p>`
    : '<p class="l">LOADING</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(product.name || '')}</title><style>
html,body{height:100%;margin:0;background:${ink};color:#fffdf5;overflow:hidden;cursor:default;user-select:none}
body{display:grid;place-items:center;font-family:"Bahnschrift","DIN Condensed","Impact","Arial Narrow",sans-serif;font-stretch:75%;font-weight:700;text-align:center}
h1{margin:0;font-size:min(15vw,26vh);line-height:.9;font-style:italic;letter-spacing:.02em}
h1 i{font-style:inherit;color:${p1}}h1 b{font-weight:inherit;color:${p2}}
.t{margin-top:2.2vh;font-size:min(1.9vw,3.2vh);letter-spacing:.2em;text-transform:uppercase;color:${gold}}
.l{margin-top:7vh;font-size:min(1.4vw,2.4vh);letter-spacing:.5em;opacity:.55;animation:p 1.1s ease-in-out infinite alternate}
.e{margin:6vh auto 0;max-width:70vw;font:500 min(1.7vw,2.8vh)/1.45 "Segoe UI",system-ui,sans-serif;color:#fffdf5}
.h{margin-top:2vh;font:500 min(1.2vw,2vh)/1.4 "Segoe UI",system-ui,sans-serif;opacity:.6}
@keyframes p{from{opacity:.25}to{opacity:.7}}
@media (prefers-reduced-motion:reduce){.l{animation:none}}
</style></head><body><div><h1>${mark}</h1><div class="t">${esc(product.tagline || '')}</div>${body}</div></body></html>`;
}

const splashUrl = (product, opts) => `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(product, opts))}`;

/** Why the game could not start, for a player. `error`: what server.js's `ready` rejected with. */
function startErrorText(error, { httpPort = 8222, name = 'The game' } = {}) {
  const code = error && error.code;
  if (code === 'EADDRINUSE') {
    return `${name} could not start: port ${error.port || httpPort} on this PC is already in use. Is another copy of the game, or Open-Birdie, already running? Close it and start ${name} again.`;
  }
  if (code === 'EACCES') return `${name} could not start: Windows refused it port ${error.port || httpPort}. Another program may have reserved it.`;
  const msg = error && error.message ? String(error.message).split('\n')[0].slice(0, 200) : 'unknown error';
  return `${name} could not start: ${msg}`;
}

/** { fullscreen }: true unless the file says otherwise. Never throws. */
function readWindowPrefs(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { fullscreen: raw && raw.fullscreen === false ? false : true };
  } catch (_) {
    return { fullscreen: true };
  }
}

/** Remember the window's shape. Never throws (a read-only profile just forgets). */
function writeWindowPrefs(file, prefs) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ fullscreen: !!(prefs && prefs.fullscreen) })}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { splashHtml, splashUrl, startErrorText, readWindowPrefs, writeWindowPrefs };
