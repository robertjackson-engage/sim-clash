// v3:modes HIGHLIGHTS: the reel's screen in the main menu (docs/modes.md "Instant replay and
// highlights"). A mode module of the shell (shell.js _loadModes): mount(ctx) -> ui.
//
// Two lists, LAST MATCH (the notable shots of the game that was played last, newest first)
// and BEST OF THE NIGHT (the best few of the session, best first). Pick one and it is played
// again on its own stage, from an alternate camera: POST /api/highlights/play puts the stage
// in the bay and sends 'replay'; public/app.js films it (arcade/replay.js) and this screen
// steps aside while it plays (replay.css: html.rp-on). It is a menu screen: the swing gate
// is shut, a swing here is nobody's shot (it only skips a replay that is playing).
//
// Keys: up / down, left / right (the other list), Enter (play), C (the camera: the
// director's choice, or one of the three), Esc (back).
import { slotColor, slotMark, esc } from './shell-core.js';
import { REPLAY_CAMERAS, REPLAY_CAMERA_LABELS } from './replay-core.js';

const WHY = Object.freeze({
  ace: 'HOLE IN ONE', 'hole-out': 'HOLED OUT', 'long-putt': 'LONG PUTT', epic: 'EPIC', 'match-winner': 'WON THE MATCH',
  'hole-winner': 'WON THE HOLE', 'sudden-death': 'SUDDEN DEATH', clutch: 'CLUTCH', 'shot-of-the-match': 'SHOT OF THE MATCH',
});
const fmt = (n) => Math.round(+n || 0).toLocaleString('en-US');

/** One line about a highlight: where, and what it did. */
export function highlightLine(h) {
  const parts = [];
  if (h.stage && h.stage.name) parts.push(String(h.stage.name).toUpperCase());
  if (h.holeNumber != null && h.game && h.game.kind === 'match') parts.push(`HOLE ${h.holeNumber}`);
  const why = (h.why || []).slice(1).map((w) => WHY[w]).filter(Boolean);   // (the first reason is the title)
  const said = h.callout && h.callout.text ? String(h.callout.text).toUpperCase() : null;
  const extra = why.find((w) => w !== String(h.title || '').toUpperCase()) || (said && said !== String(h.title || '').toUpperCase() ? said : null);
  if (extra) parts.push(extra);
  else if (h.isPutt && h.fromYd != null) parts.push(`${Math.round(h.fromYd * 3)} FT PUTT`);
  else if (!h.isPutt && h.carryYd != null) parts.push(`${Math.round(h.carryYd)} YD CARRY`);
  return parts;
}

/** What the two lists show, in the order the cursor walks them. -> { cols: [{ id, title, sub, items }], flat } */
export function reelView(reel) {
  const r = reel || {};
  const last = (r.last && Array.isArray(r.last.shots)) ? r.last.shots : [];
  const night = (r.night && Array.isArray(r.night.shots)) ? r.night.shots : [];
  const kind = r.last && r.last.game ? r.last.game.kind : null;
  const cols = [
    { id: 'last', title: kind && kind !== 'match' ? 'LAST GAME' : 'LAST MATCH', sub: r.last && r.last.game && r.last.game.label ? String(r.last.game.label).toUpperCase() : 'NEWEST FIRST', items: last.slice(0, 6) },
    { id: 'night', title: r.night && r.night.current === false && night.length ? 'LAST SESSION\'S BEST' : 'BEST OF THE NIGHT', sub: 'BEST FIRST', items: night.slice(0, 6) },
  ];
  return { cols, flat: [...cols[0].items.map((h) => ({ col: 0, h })), ...cols[1].items.map((h) => ({ col: 1, h }))] };
}

export function mount(ctx) {
  const doc = ctx.doc || document;
  const fetchJson = ctx.fetchJson || ((url, init) => fetch(url, init).then((r) => r.json()).catch(() => null));
  const cue = (name, opts) => { try { ctx.audio?.cue?.(name, opts); } catch (_) { /* silent */ } };
  if (!doc.querySelector('link[data-rp-css]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = 'arcade/replay.css'; link.setAttribute('data-rp-css', '');
    doc.head.appendChild(link);
  }
  const root = doc.createElement('div');
  root.className = 'md-root hl-root hl-hidden';
  ctx.hud.appendChild(root);

  const ui = {
    root, lobbyOpen: false, live: false,
    reel: null, cursor: 0, camera: null, note: '', busy: false,

    openLobby() {
      if (ui.lobbyOpen) return;
      ui.lobbyOpen = true; ui.note = ''; ui.busy = false;
      root.classList.remove('hl-hidden');
      cue('lobby-open');
      try { ctx.audio?.say?.('m-highlights'); } catch (_) { /* silent */ }   // TONIGHT'S BEST!
      render();
      ctx.sync();
      fetchJson('/api/highlights').then((out) => { if (out && out.highlights) { ui.reel = out.highlights; render(); } });
    },
    closeLobby() {
      if (!ui.lobbyOpen) return;
      ui.lobbyOpen = false;
      root.classList.add('hl-hidden');
      ctx.sync();
    },
    key(e) { return onKey(e); },
  };

  function render() {
    if (!ui.lobbyOpen) return;
    const v = reelView(ui.reel);
    ui.cursor = Math.max(0, Math.min(v.flat.length - 1, ui.cursor));
    let i = 0;
    const item = (h, at, list) => {
      const n = i++;
      const ranked = list === v.cols[1].items;   // the night is a ranking (by the reel's own score: what the shot did, then its points)
      const slot = h.player && h.player.slot;
      const c = slot ? slotColor(slot) : '';
      const line = highlightLine(h);
      return `<button type="button" class="hl-item${n === ui.cursor ? ' hl-on' : ''}" data-i="${n}" ${h.replayable === false ? 'disabled' : ''} ${c ? `style="--c:${c}"` : ''}>
        <i class="hl-play${ranked ? ' hl-rank' : ''}" aria-hidden="true">${ranked ? at + 1 : '▶'}</i>
        <span><b class="hl-what">${h.shotOfMatch ? '<i class="hl-star" title="Shot of the match">★</i>' : ''}${esc(String(h.title || 'REPLAY').toUpperCase())}</b>
          <span class="hl-line">${h.player && h.player.name ? `${slot ? `<i>${esc(slotMark(slot))}</i>` : ''}<em>${esc(String(h.player.name).toUpperCase())}</em>` : ''}${line.map((x) => `<span>· ${esc(x)}</span>`).join('')}</span></span>
        <b class="hl-pts">${h.points ? fmt(h.points) : '–'}<span>PTS</span></b></button>`;
    };
    const col = (c) => `<section class="hl-col" data-col="${c.id}">
      <h3 class="hl-col-h">${esc(c.title)}<span>${esc(c.sub)}</span></h3>
      <div class="hl-list">${c.items.length ? c.items.map(item).join('') : `<p class="hl-none">${c.id === 'last'
        ? '<b>NOTHING YET</b>HOLE OUT FROM OFF THE GREEN, DRAIN A LONG PUTT, OR WIN A HOLE IN A MATCH: IT WILL BE HERE TO WATCH AGAIN.'
        : '<b>THE NIGHT IS YOUNG</b>THE BEST SHOTS OF THE SESSION ARE KEPT HERE, WHOEVER HIT THEM.'}</p>`}</div></section>`;
    root.classList.toggle('hl-busy', ui.busy);
    root.innerHTML = `
      <header class="hl-head">
        <button type="button" class="hl-back" data-hl="back" aria-label="Back"><i aria-hidden="true">‹</i>BACK<kbd>ESC</kbd></button>
        <h2 class="hl-h">HIGHLIGHTS</h2><span class="hl-h-sub">THE BEST SHOTS · FROM ANOTHER CAMERA</span>
      </header>
      <div class="hl-cols">${v.cols.map(col).join('')}</div>
      <p class="hl-note" role="alert">${esc(ui.note)}</p>
      <button type="button" class="hl-cam" data-hl="camera" title="Which camera films the replay"><kbd>C</kbd>CAMERA<b>${esc(ui.camera ? REPLAY_CAMERA_LABELS[ui.camera] : 'DIRECTOR\'S CHOICE')}</b></button>
      <footer class="hl-hints"><span><kbd>↑ ↓</kbd>CHOOSE</span><span><kbd>← →</kbd>OTHER LIST</span><span><kbd>ENTER</kbd>WATCH IT</span><span><kbd>ESC</kbd>BACK</span></footer>`;
  }

  async function play(index) {
    const v = reelView(ui.reel);
    const it = v.flat[index];
    if (!it || ui.busy) { cue('ui-error'); return; }
    ui.cursor = index; ui.busy = true; ui.note = '';
    cue('ui-confirm');
    render();
    const out = await fetchJson('/api/highlights/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.h.id, camera: ui.camera }) });
    ui.busy = false;
    if (!out || out.ok === false) { ui.note = String((out && out.error) || 'The game is not answering').toUpperCase(); cue('ui-error'); }
    else if (out.highlights) ui.reel = out.highlights;
    render();
  }

  function back() {
    cue('ui-back');
    ui.closeLobby();
  }
  function cycleCamera() {
    const list = [null, ...REPLAY_CAMERAS];
    ui.camera = list[(list.indexOf(ui.camera) + 1) % list.length];
    cue('ui-tick');
    render();
  }

  function onKey(e) {
    if (!ui.lobbyOpen || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (doc.documentElement.classList.contains('rp-on')) return false;   // a replay is playing: its own listener has the keys
    const k = String(e.key || '');
    const v = reelView(ui.reel);
    const n = v.flat.length;
    const move = (to) => { if (n && to !== ui.cursor) { ui.cursor = Math.max(0, Math.min(n - 1, to)); cue('ui-tick'); render(); } };
    // every key is this screen's while it is up (the play keys under it must not fire: F flyover, S sound, the aim)
    if (/^F\d+$/.test(k) || k === 'Tab' || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return false;
    e.stopImmediatePropagation();
    const take = () => { e.preventDefault(); return true; };
    if (k === 'Escape' || k === 'Backspace') { if (!e.repeat) back(); return take(); }
    if (k === 'ArrowDown') { move(ui.cursor + 1); return take(); }
    if (k === 'ArrowUp') { move(ui.cursor - 1); return take(); }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const cur = v.flat[ui.cursor];
      if (cur) {
        const other = cur.col === 0 ? 1 : 0, first = v.flat.findIndex((x) => x.col === other);
        if (first >= 0 && (k === 'ArrowRight') === (other === 1)) {
          const row = ui.cursor - v.flat.findIndex((x) => x.col === cur.col);
          move(Math.min(first + row, first + v.cols[other].items.length - 1));
        }
      }
      return take();
    }
    if (k === 'Enter' || k === ' ') { if (!e.repeat) play(ui.cursor); return take(); }
    if (k.toLowerCase() === 'c') { if (!e.repeat) cycleCamera(); return take(); }
    if (/^[1-9]$/.test(k)) { if (!e.repeat && +k <= n) play(+k - 1); return take(); }
    return false;
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest ? t.closest('[data-hl]') : null;
    if (act) { if (act.dataset.hl === 'back') back(); else if (act.dataset.hl === 'camera') cycleCamera(); return; }
    const it = t.closest ? t.closest('[data-i]') : null;
    if (it && !it.disabled) play(+it.dataset.i);
  });
  root.addEventListener('pointerover', (e) => {
    const it = e.target.closest ? e.target.closest('[data-i]') : null;
    if (!it || it.disabled || +it.dataset.i === ui.cursor) return;
    ui.cursor = +it.dataset.i;
    cue('ui-tick', { intensity: 0.5 });
    root.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('hl-on', +el.dataset.i === ui.cursor));
  });
  if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => { onKey(e); }, true);
  if (ctx.events && typeof ctx.events.addEventListener === 'function') {
    ctx.events.addEventListener('highlights', (e) => { try { ui.reel = JSON.parse(e.data); } catch (_) { return; } render(); });
  }
  return ui;
}

export default { mount };
