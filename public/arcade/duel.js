// v3:modes TRICK SHOT DUEL: call your shot, match it or take a letter (docs/modes.md "Trick
// shot duel"). The screens of the game lib/duel.js plays on the server: the lobby (two
// players, the stage, the word), the in-play header (who is on, CALL IT or MATCH IT, each
// player's letters as tiles), the CALL card and the strip that keeps it on screen, the
// verdict (MATCHED! / a LETTER / NO CALL), the result, the menu and the stray-ball prompt.
//
// A mode module of the shell (public/arcade/shell.js _loadModes): mount(ctx) -> ui, with
// ui.root (class md-root, in #hud), ui.lobbyOpen, ui.live, openLobby(), closeLobby(),
// openMenu(). Like public/arcade/bullseye.js it draws its own screens, reads its own keys,
// borrows match.css's shared pieces (mt-x, mt-btn, mt-menu, mt-stray) and makes guarded
// calls to the audio API with existing ids only.
//
// The server sends the state right after a swing, before the ball has flown: it is held
// until the ball has stopped (ctx.isAnimating). Once the call or the verdict has had its
// moment the page asks for the next ball to be teed up (POST /api/duel/next); a swing that
// comes sooner is played all the same.
import { PLAYER_COLORS, PLAYER_MARKS, slotMark, esc } from './shell-core.js';

const PICK_KEY = 'sim-clash.duel.pick';
const CALL_MS = 3600;         // the call card
const VERDICT_MS = 3200;      // MATCHED! / LETTER / NO CALL
const TURN_MS = 2200;
const STRAY_MS = 8000;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const shout = (name) => String(name || '').trim().toUpperCase();
const big = (text, cls = '', extra = '') => `<span class="mt-x ${cls}" style="--n:${Math.max(3, String(text).length)}${extra ? `;${extra}` : ''}">${esc(text)}</span>`;

// ---------------------------------------------------------------- pure helpers (exported for the tests)

/** The word as tiles: the letters a player has are lit. `fresh`: the index of one just taken. */
export function tilesHtml(word, count, { fresh = -1, cls = '' } = {}) {
  return `<span class="dl-tiles ${cls}" aria-label="${esc(String(word).slice(0, count) || 'no letters')}">${[...String(word)].map((ch, i) => `<i class="${i < count ? 'on' : ''}${i === fresh ? ' fresh' : ''}">${esc(ch)}</i>`).join('')}</span>`;
}

/** What a shot was, in a line: "152 YD · LEFT 12 YD · 96 FT HIGH · 18 FT FROM THE PIN". */
export function shotWords(f) {
  if (!f) return '';
  if (!f.clean) return f.miss === 'water' ? 'IN THE WATER' : 'OUT OF BOUNDS';
  const out = [];
  if (f.carryYd != null) out.push(`${Math.round(f.carryYd)} YD`);
  if (f.curveYd != null && Math.abs(f.curveYd) >= 1) out.push(`${f.curveYd > 0 ? 'RIGHT' : 'LEFT'} ${Math.round(Math.abs(f.curveYd))} YD`);
  if (f.apexFt != null) out.push(`${f.apexFt} FT HIGH`);
  if (f.finishFt != null) out.push(f.holed ? 'HOLED' : `${Math.round(f.finishFt)} FT FROM THE PIN`);
  return out.join(' · ');
}

/** The verdict of the newest ball (state.last) as words: { kind, title, sub, tone }. */
export function verdictWords(s) {
  const l = s && s.last;
  if (!l) return null;
  const p = s.players.find((x) => x.id === l.playerId);
  const name = shout(p ? p.name : '');
  if (l.kind === 'call') return { kind: 'call', title: 'MATCH IT', sub: `${name} CALLS IT`, tone: 'call' };
  if (l.kind === 'no-call') return { kind: 'no-call', title: 'NO CALL', sub: l.reason === 'hazard' ? `${l.shot && l.shot.miss === 'ob' ? 'OUT OF BOUNDS' : 'IN THE WATER'} · NOTHING TO MATCH` : 'A DUFF · NOTHING TO MATCH', tone: 'none' };
  if (l.kind === 'matched') return { kind: 'matched', title: 'MATCHED!', sub: `${name} ANSWERS IT`, tone: 'good' };
  if (l.kind === 'letter') return { kind: 'letter', title: `LETTER: ${l.letter}`, sub: `${name} MISSES IT`, tone: 'bad' };
  return null;
}

/** What the header says the swing that is awaited is. */
export function roleWords(s) {
  if (!s || s.phase !== 'play') return s && s.phase === 'done' ? 'DUEL OVER' : '';
  return s.role === 'match' ? 'MATCH IT' : 'CALL YOUR SHOT';
}

/** A finished round in a line for the result table. */
export function historyLine(s, h) {
  const name = (id) => { const p = s.players.find((x) => x.id === id); return shout(p ? p.name : ''); };
  const call = h.call ? String(h.call).replace(/^MATCH IT: /, '') : 'NO CALL';
  const out = h.result === 'matched' ? `${name(h.matcherId)} MATCHED` : h.result === 'letter' ? `${name(h.matcherId)}: ${h.letter}` : (h.reason === 'hazard' ? 'LOST BALL' : 'A DUFF');
  return { round: h.round, by: name(h.challengerId), call, out, result: h.result };
}

// ---------------------------------------------------------------- the UI

export class DuelUI {
  constructor(ctx) {
    this.ctx = ctx;
    this.doc = ctx.doc || document;
    this.audio = ctx.audio || null;
    this.s = null;
    this.pend = undefined;
    this.info = { stages: [], words: ['CLASH', 'PIG', 'HORSE'], tolerances: null };
    this.lobby = { open: false, busy: false, error: '', players: [], stage: 'random', word: 'CLASH' };
    this.menu = { open: false, ask: null, busy: false };
    this.kind = null;           // the full-bleed screen that is up: 'lobby' | 'loading' | 'result' | null
    this.starting = false;
    this.seen = { shots: 0, turn: '', id: null, doneId: null, ev: 0 };
    this.timers = new Set();
    this.stray = null;
    this.callout = null;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { Object.assign(this.lobby, JSON.parse(lsGet(PICK_KEY) || '{}')); } catch (_) { /* a fresh pick */ }
    this.lobby.open = false; this.lobby.busy = false; this.lobby.error = '';
    this._build();
    const es = ctx.events;
    if (es && es.addEventListener) {
      const on = (name, fn) => es.addEventListener(name, (e) => { let d; try { d = JSON.parse(e.data); } catch (_) { return; } fn(d); });
      on('duel', (d) => this.onState(d));
      on('shot', () => { this.callout = null; this._onShot(); });
      on('arcade', (d) => { this.callout = d && d.callout && d.callout.text ? { text: String(d.callout.text), tone: d.callout.tone || '' } : null; });
      on('leagues', () => { if (this.lobby.open) { this._fixPick(); this._renderLobby(); } });
    }
    this._onKey = (e) => this._key(e);
    this.doc.addEventListener('keydown', this._onKey, true);
    this._load().then(() => { if (this.lobby.open) this._renderLobby(); });
  }

  get lobbyOpen() { return this.lobby.open; }
  get live() { return this.starting || !!(this.s && !this.s.aborted); }

  // ---------- building
  _build() {
    const d = this.doc;
    if (!d.querySelector('link[data-dl-css]')) {
      const link = d.createElement('link');
      link.rel = 'stylesheet'; link.href = 'arcade/duel.css'; link.setAttribute('data-dl-css', '');
      d.head.appendChild(link);
    }
    this.root = d.createElement('div');
    this.root.className = 'md-root dl-root';
    this.root.innerHTML = '<div class="dl-hdr hidden"></div><div class="dl-strip hidden"></div><div class="dl-banner"></div>'
      + '<div class="dl-screen mt-screen hidden"></div><div class="mt-stray hidden"></div><div class="mt-menu hidden"></div>';
    (this.ctx.hud || d.body).appendChild(this.root);
    const q = (c) => this.root.querySelector(c);
    this.hdr = q('.dl-hdr'); this.strip = q('.dl-strip'); this.banner = q('.dl-banner'); this.screen = q('.dl-screen'); this.strayEl = q('.mt-stray'); this.menuEl = q('.mt-menu');
    this.root.addEventListener('click', (e) => this._click(e));
    this.root.style.setProperty('--dl-p1', PLAYER_COLORS[0]);
    this.root.style.setProperty('--dl-p2', PLAYER_COLORS[1]);
  }

  async _load() {
    const r = await this.ctx.fetchJson('/api/duel');
    if (!r || r.ok === false) return;
    for (const k of ['stages', 'words', 'tolerances']) if (r[k] !== undefined) this.info[k] = r[k];
    if (r.duel && !this.s && this.pend === undefined) this.onState(r.duel);
  }
  async _post(action, body = {}) {
    const out = await this.ctx.fetchJson(`/api/duel/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!out || out.ok === false) { this._cue('ui-error'); return { ok: false, error: (out && out.error) || 'The game is not answering' }; }
    return out;
  }
  _cue(name, opts) { if (!name) return; try { this.audio?.cue?.(name, opts); } catch (_) { /* silent */ } }
  _say(line, opts) { if (!line) return; try { this.audio?.say?.(line, opts); } catch (_) { /* silent */ } }
  _after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.reduced ? Math.min(ms, 900) : ms);
    this.timers.add(t);
    return t;
  }
  _clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  _sync() {
    this.root.classList.toggle('md-keys', this.live);   // arcade.js: this game has no ball dock and its keys are its own
    try { this.ctx.sync?.(); } catch (_) { /* the shell is gone */ }
  }

  // ---------- the state
  onState(s) {
    if (this.s && s && this.s.id === s.id && s.seq < this.s.seq) return;
    this.pend = s;
    this._pump();
  }
  _pump() {
    clearTimeout(this._pumpT);
    if (this.pend === undefined) return;
    if (this.ctx.isAnimating && this.ctx.isAnimating()) { this._pumpT = setTimeout(() => this._pump(), 120); return; }
    const s = this.pend;
    this.pend = undefined;
    this._apply(s);
  }
  _onShot() {
    if (!this.s || this.s.phase !== 'play') return;
    this._clearTimers();
    this.banner.innerHTML = '';
    this._strayHide();
  }
  _shots(s) { return s ? s.players.reduce((n, p) => n + p.shots, 0) : 0; }

  _apply(s) {
    const prev = this.s;
    if (!s || (s.aborted && !s.error)) {
      this.s = null; this.starting = false;
      this._clearTimers();
      this.menu.open = false;
      this._strayHide();
      this.banner.innerHTML = '';
      if (this.kind && this.kind !== 'lobby') this._hideScreen();
      this._render();
      this._sync();
      return;
    }
    if (s.aborted) {
      this.s = null; this.starting = false;
      this.lobby.error = `THAT STAGE WOULD NOT LOAD: ${shout(s.error)}`;
      this.openLobby(true);
      return;
    }
    this.s = s;
    this.starting = false;
    if (this.lobby.open) { this.lobby.open = false; if (this.kind === 'lobby') this._hideScreen(); }
    if (this.seen.id !== s.id) this.seen = { shots: prev ? 0 : this._shots(s), turn: '', id: s.id, doneId: null, ev: 0 };
    const fresh = !!prev && prev.id === s.id && this._shots(s) > this.seen.shots && !!s.last;
    for (const e of s.events || []) {
      if (e.seq <= this.seen.ev) continue;
      if (e.type === 'stray-shot' && prev) this._strayShow(s, e);
      if (e.type === 'shot-undone' && prev) this._rewound(s, e);
      if (e.type === 'restarted' && prev) { this.seen.shots = 0; this.seen.turn = ''; this.seen.doneId = null; this._clearTimers(); this.banner.innerHTML = ''; if (this.kind === 'result') this._hideScreen(); }
    }
    this.seen.ev = Math.max(this.seen.ev, ...(s.events || []).map((e) => e.seq));
    this.seen.shots = this._shots(s);
    this._sync();
    this._render();
    if (s.phase === 'loading') { this._screenLoading(s); return; }
    if (this.kind === 'loading') this._hideScreen();
    if (fresh) { this._onBall(s); return; }
    if (s.phase === 'done') { if (this.seen.doneId !== s.id && !this.timers.size) this._screenResult(s); return; }
    if (this.kind === 'result') this._hideScreen();
    if (!s.teed && s.waiting && s.waiting.for === 'tee' && !this.timers.size) { this._next(); return; }   // joined between balls
    this._turn(s);
  }

  // A ball has landed and been read: the call, or the verdict.
  _onBall(s) {
    const v = verdictWords(s);
    this._clearTimers();
    if (!v) { this._next(); return; }
    this._card(s, v);
    // the mode's own sounds and lines (docs/arcade-voice.md, "Bullseye, the duel, replays")
    if (v.kind === 'call') { this._cue('dl-call'); }
    else if (v.kind === 'matched') { this._cue('dl-matched'); this._cue('confetti-pop'); this._say('dl-matched'); }
    else if (v.kind === 'letter') {
      const left = String(s.word || '').length - String((s.last && s.last.letters) || '').length;   // letters still to spell
      this._cue('dl-letter');
      this._say(s.word && left <= 0 ? 'dl-spelled-it' : s.word && left === 1 ? 'dl-one-letter-left' : 'dl-letter');
    }
    else { this._cue('dl-no-call'); this._say('dl-no-call'); }
    const hold = v.kind === 'call' ? CALL_MS : VERDICT_MS;
    if (s.phase === 'done') { this._after(hold, () => this._screenResult(s)); return; }
    this._after(hold, () => { this.banner.innerHTML = ''; this._next(); });
  }
  async _next() {
    const s = this.s;
    if (!s || s.phase !== 'play') return;
    if (s.teed) { this._turn(s); return; }
    await this._post('next');
  }
  _turn(s) {
    if (s.phase !== 'play' || !s.currentPlayerId || !s.teed) return;
    const key = `${s.id}|${s.round}|${s.role}|${s.currentPlayerId}`;
    if (this.seen.turn === key) return;
    this.seen.turn = key;
    const p = s.players.find((x) => x.id === s.currentPlayerId);
    if (!p) return;
    const match = s.role === 'match';
    this.banner.innerHTML = `<div class="dl-turn dl-p${p.slot}"><i class="dl-turn-bg"></i>
      <span class="dl-turn-k">ROUND ${s.round} · PLAYER ${p.slot}</span>
      ${big(`${shout(p.name)}, ${match ? 'MATCH IT' : 'CALL YOUR SHOT'}`, 'dl-turn-t')}
      <span class="dl-turn-s">${match ? esc(String(s.call ? s.call.text : '').replace(/^MATCH IT: /, '')) : 'HIT ANY SHOT · WHAT MAKES IT SPECIAL IS THE CALL'}</span></div>`;
    this._cue('turn-chime');
    this._say(match ? 'dl-match-it' : 'dl-call-your-shot');
    this._after(TURN_MS, () => { const t = this.banner.querySelector('.dl-turn'); if (t) t.remove(); });
  }
  /** The call card, or the verdict, over the picture of the ball that was just hit. */
  _card(s, v) {
    const l = s.last;
    const p = s.players.find((x) => x.id === l.playerId);
    const slot = p ? p.slot : 1;
    let body = '';
    if (v.kind === 'call') {
      body = `<div class="dl-parts">${l.parts.map((part, i) => `<div class="dl-part" style="--d:${(0.35 + i * 0.18).toFixed(2)}s"><b>${esc(part.label)}</b><span>${esc(part.target)}</span></div>`).join('')}</div>`;
    } else if (v.kind === 'no-call') {
      body = `<span class="dl-card-note">${esc(shotWords(l.shot))}</span>`;
    } else {
      body = `<div class="dl-checks">${(l.checks || []).map((c, i) => `<div class="dl-check ${c.ok ? 'ok' : 'no'}" style="--d:${(0.3 + i * 0.16).toFixed(2)}s"><i>${c.ok ? '✔' : '✘'}</i><b>${esc(c.want)}</b><span>${esc(c.got)}</span></div>`).join('')}</div>`
        + (v.kind === 'letter' ? tilesHtml(s.word, (l.letters || '').length, { fresh: (l.letters || '').length - 1, cls: 'dl-tiles-xl' }) : '');
    }
    const call = this.callout && v.kind !== 'letter' ? `<span class="dl-callout ${this.callout.tone === 'bad' ? 'dl-callout-bad' : ''}">${esc(shout(this.callout.text))}</span>` : '';
    this.banner.innerHTML = `<div class="dl-card dl-tone-${v.tone} dl-p${slot}">
      <span class="dl-card-k"><i>${esc(slotMark(slot))}</i>${esc(v.sub)}</span>
      ${big(v.title, 'dl-card-t')}${body}${call}</div>`;
  }
  _flash(title, sub) {
    const el = this.doc.createElement('div');
    el.className = 'dl-flash';
    el.innerHTML = `${big(title, 'dl-flash-t')}<span class="dl-flash-s">${esc(sub)}</span>`;
    this.banner.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  _rewound(s, e) {
    this._clearTimers();
    this._strayHide();
    if (this.kind === 'result') this._hideScreen();
    this.seen.doneId = null; this.seen.turn = '';
    const p = s.players.find((x) => x.id === e.playerId);
    this.banner.innerHTML = '';
    this._flash('SHOT TAKEN BACK', `${p ? shout(p.name) : ''} HITS IT AGAIN`);
    this._cue('ui-back');
  }

  // ---------- drawing: the header, the call strip
  _render() {
    const s = this.s;
    const play = !!s && (s.phase === 'play' || s.phase === 'done');
    this.hdr.classList.toggle('hidden', !play);
    const showStrip = !!s && s.phase === 'play' && s.role === 'match' && !!s.call;
    this.strip.classList.toggle('hidden', !showStrip);
    if (!play) { this.hdr.innerHTML = ''; this.strip.innerHTML = ''; this._renderMenu(); return; }
    const side = (p) => {
      const up = s.currentPlayerId === p.id;
      const tag = s.phase === 'done' ? (s.winnerId === p.id ? 'WINS' : s.loserId === p.id ? `SPELLED ${s.word}` : 'LEVEL')
        : up ? (s.role === 'match' ? 'MATCH IT' : 'CALL YOUR SHOT') : (s.role === 'match' ? 'CALLED IT' : 'WAITS');
      return `<div class="dl-side dl-p${p.slot} ${up ? 'dl-up' : ''} ${s.winnerId === p.id ? 'dl-won' : ''}">
        <i class="dl-side-bg"></i>
        <span class="dl-side-id"><i class="dl-mark">${esc(slotMark(p.slot))}</i><em>P${p.slot}</em><u class="dl-role ${up && s.role === 'match' ? 'dl-role-match' : ''}">${esc(tag)}</u></span>
        <span class="dl-side-n">${esc(shout(p.name))}</span>
        ${tilesHtml(s.word, p.lettersCount)}</div>`;
    };
    const [a, b] = [...s.players].sort((x, y) => x.slot - y.slot);
    const wind = s.stage.wind && Number.isFinite(s.stage.wind.mph) ? ` · ${s.stage.wind.mph} MPH` : '';
    this.hdr.innerHTML = `<div class="dl-id"><button type="button" class="dl-menu-btn" data-dl="menu" title="Menu (Esc)"><i aria-hidden="true"></i>MENU</button>
        <span class="dl-id-k">TRICK SHOT DUEL · ${esc(s.word)}</span>
        <b class="dl-id-n">${esc(shout(s.stage.name))}</b>
        <span class="dl-id-r">${s.phase === 'done' ? 'DUEL OVER' : `ROUND ${s.round} OF ${s.maxRounds}`}${s.stage.lengthYd ? ` · ${s.stage.lengthYd} YD` : ''}${esc(wind)}</span></div>
      <div class="dl-sides">${side(a)}<div class="dl-mid ${s.role === 'match' ? 'dl-mid-match' : ''}"><span>${s.phase === 'done' ? 'FINAL' : `ROUND ${s.round}`}</span><b>${esc(roleWords(s))}</b></div>${side(b)}</div>`;
    if (showStrip) {
      const by = s.players.find((p) => p.id === s.call.playerId);
      this.strip.innerHTML = `<span class="dl-strip-k">${esc(shout(by ? by.name : ''))} CALLED IT · MATCH IT</span>
        <div class="dl-strip-parts">${s.call.parts.map((part) => `<b>${esc(part.target)}</b>`).join('<i>+</i>')}</div>`;
    } else this.strip.innerHTML = '';
    this._renderMenu();
  }

  // ---------- full-bleed screens
  _show(kind, html) {
    this.kind = kind;
    this.screen.className = `dl-screen mt-screen dl-s-${kind}`;
    this.screen.innerHTML = html;
  }
  _hideScreen() {
    this.kind = null;
    this.screen.className = 'dl-screen mt-screen hidden';
    this.screen.innerHTML = '';
  }
  _bg(cls = '') { return `<div class="dl-bg ${cls}" aria-hidden="true"><i class="dl-bg-a"></i><i class="dl-bg-b"></i><i class="dl-bg-slash"></i></div>`; }

  _screenLoading(s) {
    if (this.kind === 'loading') return;
    const first = s.players.find((p) => p.id === s.challengerId);
    this._show('loading', `${this._bg()}<div class="dl-load"><span class="dl-kick">TRICK SHOT DUEL · FIRST TO SPELL ${esc(s.word)} LOSES</span>${big(shout(s.stage.name), 'dl-load-t')}<span class="dl-load-s">${first ? `${esc(shout(first.name))} CALLS FIRST` : 'SETTING UP THE STAGE'}</span></div>`);
  }

  _screenResult(s) {
    if (!this.s || this.s.id !== s.id || s.phase !== 'done') return;
    this.seen.doneId = s.id;
    this.banner.innerHTML = '';
    this.menu.open = false; this._renderMenu();
    const w = s.players.find((p) => p.id === s.winnerId) || null;
    const l = s.players.find((p) => p.id === s.loserId) || null;
    const [a, b] = [...s.players].sort((x, y) => x.slot - y.slot);
    const title = w ? `${shout(w.name)} WINS!` : 'DUEL SHARED';
    const how = w ? (s.reason === 'word' ? `${shout(l.name)} SPELLED ${s.word}` : `${shout(l.name)} HAS MORE LETTERS AFTER ${s.maxRounds} ROUNDS`) : `LEVEL AFTER ${s.maxRounds} ROUNDS`;
    const lines = s.history.slice(-5).map((h) => historyLine(s, h));
    const row = (p) => `<div class="dl-res-p dl-p${p.slot} ${w && w.id === p.id ? 'dl-res-win' : ''}"><span class="dl-res-n"><i class="dl-mark">${esc(slotMark(p.slot))}</i>${esc(shout(p.name))}</span>${tilesHtml(s.word, p.lettersCount, { cls: 'dl-tiles-lg' })}<span class="dl-res-st">${p.calls} CALL${p.calls === 1 ? '' : 'S'} · ${p.matched} MATCHED · ${p.missed} MISSED</span></div>`;
    this._show('result', `${this._bg(`dl-bg-win ${w ? `dl-p${w.slot}` : ''}`)}
      <div class="dl-res ${w ? `dl-p${w.slot}` : ''}">
        <span class="dl-kick">TRICK SHOT DUEL · ${esc(shout(s.stage.name))}</span>
        ${big(title, 'dl-res-t')}
        <span class="dl-res-how">${esc(how)}</span>
        <div class="dl-res-players">${row(a)}${row(b)}</div>
        <div class="dl-hist"><div class="dl-hist-h"><span>RD</span><span>CALLED BY</span><span>THE CALL</span><span></span></div>
          ${lines.map((x) => `<div class="dl-hist-r dl-r-${x.result}"><span>${x.round}</span><span>${esc(x.by)}</span><span>${esc(x.call)}</span><b>${esc(x.out)}</b></div>`).join('')}</div>
        <div class="dl-actions">
          <button type="button" class="mt-btn mt-btn-go" data-dl="again">PLAY AGAIN</button>
          <button type="button" class="mt-btn" data-dl="change">CHANGE GAME</button>
          <button type="button" class="mt-btn mt-btn-dim" data-dl="exit">EXIT</button>
        </div>
      </div>`);
    this._cue('lobby-open');
    this._after(350, () => { this._cue(w ? 'fanfare-win' : 'whoosh'); if (w) { this._cue('confetti-pop'); this._say(w.slot === 1 ? 'm-player-1-wins' : 'm-player-2-wins'); } else this._say('m-all-square'); });
    this._after(500, () => this.screen.querySelector('[data-dl="again"]')?.focus({ preventScroll: true }));
  }

  // ---------- the lobby
  _roster() { return (this.ctx.players && this.ctx.players()) || []; }
  _fixPick() {
    const L = this.lobby;
    const roster = this._roster();
    const ids = roster.map((p) => p.id);
    L.players = (Array.isArray(L.players) ? L.players : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i).slice(0, 2);
    for (const p of roster) { if (L.players.length >= 2) break; if (!L.players.includes(p.id)) L.players.push(p.id); }
    if (L.stage !== 'random' && !(this.info.stages || []).some((x) => x.id === L.stage)) L.stage = 'random';
    if (!(this.info.words || []).includes(L.word)) L.word = (this.info.words || ['CLASH'])[0];
  }
  _savePick() { const { players, stage, word } = this.lobby; lsSet(PICK_KEY, JSON.stringify({ players, stage, word })); }

  async openLobby(keepError = false) {
    const L = this.lobby;
    L.open = true; L.busy = false;
    if (!keepError) L.error = '';
    this._cue('lobby-open');
    this._fixPick();
    this._renderLobby();
    this._render();
    this._sync();
    await this._load();
    if (!L.open) return;
    // two players ready the moment the lobby is up: made on the spot when the roster is short
    for (let n = this._roster().length; n < 2 && L.open; n++) {
      const out = await this.ctx.fetchJson('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Player ${n + 1}` }) });
      if (!out || !out.player) break;
      if (!this._roster().some((x) => x.id === out.player.id)) this._roster().push(out.player);
    }
    if (!L.open) return;
    this._fixPick();
    this._renderLobby();
    this.screen.querySelector('[data-dl="start"]')?.focus({ preventScroll: true });
  }
  closeLobby() {
    if (!this.lobby.open) return;
    this.lobby.open = false;
    if (this.kind === 'lobby') this._hideScreen();
    this._sync();
  }
  _renderLobby() {
    const L = this.lobby;
    if (!L.open) return;
    const roster = this._roster();
    const slot = (i) => {
      const p = roster.find((x) => x.id === L.players[i]) || null;
      return `<button type="button" class="dl-slot dl-p${i + 1}" data-dl="slot" data-i="${i}"><i class="dl-slot-bg"></i>
        <span class="dl-slot-k"><i class="dl-mark">${esc(PLAYER_MARKS[i])}</i>PLAYER ${i + 1}<span class="dl-slot-c"><kbd>${i + 1}</kbd>CHANGE</span></span>
        ${big(p ? shout(p.name) : '—', 'dl-slot-n')}</button>`;
    };
    const st = L.stage === 'random' ? null : (this.info.stages || []).find((x) => x.id === L.stage);
    const stage = st
      ? `<b>${esc(shout(st.name))}</b><span>${st.arena ? 'ARENA' : `PAR ${st.par ?? '–'}`}${st.lengthYd ? ` · ${st.lengthYd} YD` : ''}</span>`
      : '<b>RANDOM</b><span>A PAR 3 OR AN ARENA</span>';
    const tol = this.info.tolerances || {};
    const can = L.players.length === 2 && !L.busy;
    this._show('lobby', `${this._bg('dl-bg-lobby')}
      <header class="dl-lob-head">
        <button type="button" class="dl-back" data-dl="back"><i aria-hidden="true">‹</i>BACK<kbd>ESC</kbd></button>
        ${big('TRICK SHOT DUEL', 'dl-lob-t')}
      </header>
      <section class="dl-lob-players">${slot(0)}<div class="dl-vs"><span>VS</span></div>${slot(1)}</section>
      <section class="dl-lob-mid">
        <div class="dl-opt"><span class="dl-lab"><kbd>← →</kbd>STAGE</span>
          <div class="dl-stage"><button type="button" class="dl-arrow" data-dl="stage" data-dir="-1" aria-label="Previous stage">‹</button><div class="dl-stage-c">${stage}</div><button type="button" class="dl-arrow" data-dl="stage" data-dir="1" aria-label="Next stage">›</button></div></div>
        <div class="dl-opt"><span class="dl-lab"><kbd>W</kbd>THE WORD · FIRST TO SPELL IT LOSES</span>
          <div class="dl-seg">${(this.info.words || []).map((w) => `<button type="button" class="${w === L.word ? 'on' : ''}" data-dl="word" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>
      </section>
      <section class="dl-rules">
        <p><b>1</b>THE CHALLENGER HITS ANY SHOT. WHAT MAKES IT SPECIAL IS THE CALL: ITS CARRY, ITS BEND, HOW CLOSE, HOW HIGH.</p>
        <p><b>2</b>THE OTHER PLAYER GETS ONE BALL TO MATCH IT${tol.carryPct ? ` (CARRY WITHIN ${Math.round(tol.carryPct * 100)} %)` : ''}. MISS IT: A LETTER. THEN THE ROLES SWAP.</p>
        <p><b>3</b>IN THE WATER OR A DUFF IS NO CALL. FIRST TO SPELL ${esc(L.word)} LOSES.</p>
      </section>
      <footer class="dl-lob-foot">
        <div class="dl-lob-note">${L.error ? `<span class="dl-err" role="alert">${esc(L.error)}</span>` : ''}</div>
        <button type="button" class="mt-btn mt-btn-go dl-start" data-dl="start" ${can ? '' : 'disabled'}>${L.busy ? 'STARTING…' : 'START'}<kbd>ENTER</kbd></button>
      </footer>`);
  }
  /** A slot was picked: the next roster player who is not in the other slot. */
  _slot(i) {
    const L = this.lobby;
    const roster = this._roster();
    if (roster.length < 3) { if (roster.length === 2) { L.players = [L.players[1], L.players[0]]; } else { this._cue('ui-error'); return; } }
    else {
      const cur = roster.findIndex((p) => p.id === L.players[i]);
      for (let k = 1; k <= roster.length; k++) {
        const next = roster[(cur + k) % roster.length];
        if (next.id !== L.players[1 - i]) { L.players[i] = next.id; break; }
      }
    }
    this._cue('select-player');
    this._savePick();
    this._renderLobby();
  }
  _cycleStage(dir) {
    const L = this.lobby;
    const list = ['random', ...(this.info.stages || []).map((s) => s.id)];
    const i = Math.max(0, list.indexOf(L.stage));
    L.stage = list[(i + dir + list.length) % list.length];
    this._cue('select-stage');
    this._savePick();
    this._renderLobby();
  }
  _cycleWord() {
    const L = this.lobby;
    const list = this.info.words || ['CLASH'];
    L.word = list[(list.indexOf(L.word) + 1) % list.length];
    this._cue('toggle-on');
    this._savePick();
    this._renderLobby();
  }
  async _start() {
    const L = this.lobby;
    if (L.busy || L.players.length !== 2) { if (!L.busy) this._cue('ui-error'); return; }
    L.busy = true; L.error = '';
    this._cue('start-match');
    this._renderLobby();
    const out = await this._post('start', { playerIds: L.players, stage: L.stage, word: L.word });
    L.busy = false;
    if (!out.ok) { L.error = shout(out.error); this._renderLobby(); return; }
    this.starting = true;
    this.onState(out.duel);
  }

  // ---------- the menu, the stray-ball prompt
  openMenu() {
    if (!this.s || this.menu.open || this.kind === 'lobby') return;
    this.menu = { open: true, ask: null, busy: false };
    this._cue('ui-confirm');
    this._renderMenu();
  }
  closeMenu(quiet = false) {
    if (!this.menu.open) return;
    this.menu.open = false;
    if (!quiet) this._cue('ui-back');
    this._renderMenu();
  }
  _menuItems() {
    const s = this.s;
    if (!s) return [];
    const u = s.undoable;
    const who = u ? s.players.find((p) => p.id === u.playerId) : null;
    return [
      { id: 'resume', label: 'RESUME', sub: 'BACK TO THE DUEL', on: true },
      { id: 'undo', label: 'UNDO LAST SHOT', sub: u ? `${who ? shout(who.name) : ''}'S ${u.role === 'match' ? 'ANSWER' : 'CALL'} IS HIT AGAIN` : 'NO SHOT TO TAKE BACK', on: !!u },
      { id: 'restart', label: 'RESTART', sub: 'THE SAME DUEL FROM THE TOP · THE LETTERS ARE WIPED', on: !!s.canRestart, ask: { title: 'RESTART?', sub: 'THE LETTERS ARE WIPED' } },
      { id: 'exit', label: 'EXIT TO MAIN MENU', sub: 'THE DUEL IS ABANDONED', on: true, ask: s.phase === 'done' ? null : { title: 'EXIT?', sub: 'THE DUEL IS ABANDONED' } },
    ];
  }
  _renderMenu() {
    const ui = this.menu, s = this.s;
    if (!s || !ui.open) { this.menuEl.className = 'mt-menu hidden'; this.menuEl.innerHTML = ''; this.menuEl.dataset.key = ''; return; }
    const items = this._menuItems();
    const asking = items.find((x) => x.id === ui.ask && x.ask && x.on) || null;
    if (!asking) ui.ask = null;
    const [a, b] = [...s.players].sort((x, y) => x.slot - y.slot);
    const where = `${esc(shout(a.name))} ${esc(a.letters || '–')} · ${esc(b.letters || '–')} ${esc(shout(b.name))} · ${s.phase === 'done' ? 'DUEL OVER' : `ROUND ${s.round}`}`;
    const body = asking
      ? `<span class="mt-x mt-menu-t mt-menu-q" style="--n:${asking.ask.title.length}">${esc(asking.ask.title)}</span><span class="mt-menu-sub">${esc(asking.ask.sub)}</span>
         <div class="mt-menu-yn"><button type="button" class="mt-menu-b mt-menu-yes" data-dl="menu-yes" ${ui.busy ? 'disabled' : ''}><i>Y</i><b>YES</b></button>
           <button type="button" class="mt-menu-b mt-menu-no" data-dl="menu-no" ${ui.busy ? 'disabled' : ''}><i>N</i><b>NO</b></button></div>`
      : `<span class="mt-x mt-menu-t">DUEL MENU</span><span class="mt-menu-sub">${where}</span>
         <div class="mt-menu-list">${items.map((x, i) => `<button type="button" class="mt-menu-b mt-menu-${x.id === 'exit' ? 'quit' : x.id}" data-dl="menu-do" data-do="${x.id}" ${x.on && !ui.busy ? '' : 'disabled'}><i>${i + 1}</i><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>
         <span class="mt-menu-note">SWINGS STILL COUNT WHILE THIS IS OPEN · ESC TO RESUME</span>`;
    const key = `${asking ? asking.id : ''}|${ui.busy}|${items.map((x) => `${x.on}${x.sub}`).join('|')}`;
    if (this.menuEl.dataset.key === key && !this.menuEl.classList.contains('hidden')) return;
    this.menuEl.dataset.key = key;
    this.menuEl.className = `mt-menu ${asking ? 'mt-menu-asking' : ''}`;
    this.menuEl.innerHTML = `<div class="mt-menu-back" data-dl="${asking ? 'menu-no' : 'menu-resume'}"></div><div class="mt-menu-panel" role="dialog" aria-modal="true" aria-label="Duel menu">${body}</div>`;
    this.menuEl.querySelector(asking ? '.mt-menu-no' : '.mt-menu-b:not([disabled])')?.focus({ preventScroll: true });
  }
  _menuDo(id) {
    const it = this._menuItems().find((x) => x.id === id);
    if (!it || !it.on || this.menu.busy) { this._cue('ui-error'); return; }
    if (id === 'resume') { this.closeMenu(); return; }
    if (it.ask) { this.menu.ask = id; this._cue('ui-tick'); this._renderMenu(); return; }
    this._menuRun(id);
  }
  async _menuRun(id) {
    this.menu.busy = true;
    this._renderMenu();
    this._cue('ui-confirm');
    if (id === 'undo') await this._post('undo');
    else if (id === 'restart') await this._post('restart');
    else if (id === 'exit') await this._exit();
    this.menu = { open: false, ask: null, busy: false };
    this._renderMenu();
  }
  async _exit() {
    this._clearTimers();
    await this._post('abort');
  }
  _strayShow(s, e) {
    const u = s.undoable;
    if (!u || !u.stray || u.playerId !== e.playerId) return;
    const p = s.players.find((x) => x.id === e.playerId);
    this._strayHide();
    this.stray = { id: s.id, timer: setTimeout(() => this._strayHide(), STRAY_MS) };
    this.strayEl.className = 'mt-stray';
    this.strayEl.innerHTML = `<div class="mt-stray-card" role="alertdialog" aria-label="Stray ball?" style="--ms:${STRAY_MS}ms">
      <span class="mt-stray-k">${e.speedMph != null ? `${Math.round(e.speedMph)} MPH · ` : ''}THAT COUNTED AS ${esc(p ? shout(p.name) : 'A')}'S SHOT</span>
      <span class="mt-x mt-stray-t">STRAY BALL?</span>
      <div class="mt-stray-row">
        <button type="button" class="mt-menu-b mt-stray-undo" data-dl="stray-undo"><i>U</i><b>UNDO</b></button>
        <button type="button" class="mt-menu-b mt-stray-count" data-dl="stray-count"><i>C</i><b>COUNT IT</b></button>
      </div><i class="mt-stray-bar" aria-hidden="true"></i></div>`;
  }
  _strayHide() {
    if (this.stray) clearTimeout(this.stray.timer);
    this.stray = null;
    this.strayEl.className = 'mt-stray hidden';
    this.strayEl.innerHTML = '';
  }

  // ---------- input
  _click(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-dl]') : null;
    if (!el || el.disabled) return;
    const L = this.lobby;
    switch (el.dataset.dl) {
      case 'menu': this.openMenu(); break;
      case 'back': this._cue('ui-back'); this.closeLobby(); break;
      case 'slot': this._slot(+el.dataset.i); break;
      case 'stage': this._cycleStage(+el.dataset.dir || 1); break;
      case 'word': L.word = el.dataset.v; this._cue('toggle-on'); this._savePick(); this._renderLobby(); break;
      case 'start': this._start(); break;
      case 'again': this._cue('start-match'); this._clearTimers(); this._hideScreen(); this.starting = true; this._post('again').then((o) => { if (!o.ok) { this.starting = false; this._sync(); } }); break;
      case 'change': this._cue('ui-confirm'); this.lobby.open = true; this._exit().then(() => this.openLobby()); break;
      case 'exit': this._cue('ui-back'); this._exit(); break;
      case 'menu-resume': this.closeMenu(); break;
      case 'menu-do': this._menuDo(el.dataset.do); break;
      case 'menu-yes': if (this.menu.ask) this._menuRun(this.menu.ask); break;
      case 'menu-no': this._cue('ui-back'); this.menu.ask = null; this._renderMenu(); break;
      case 'stray-undo': this._strayHide(); this._post('undo'); break;
      case 'stray-count': this._cue('ui-back'); this._strayHide(); break;
      default: break;
    }
  }
  _key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = String(e.key || '');
    const low = k.toLowerCase();
    const mine = () => { e.stopPropagation(); e.preventDefault(); };
    const L = this.lobby;
    if (L.open && this.kind === 'lobby') {
      if (k === 'Tab' || k === 'Shift' || /^F\d+$/.test(k)) return;
      e.stopPropagation();
      if (e.repeat) return;
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); this._cue('ui-back'); this.closeLobby(); }
      else if (k === '1' || k === '2') { e.preventDefault(); this._slot(+k - 1); }
      else if (k === 'ArrowRight' || low === 's') { e.preventDefault(); this._cycleStage(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this._cycleStage(-1); }
      else if (low === 'w') { e.preventDefault(); this._cycleWord(); }
      else if (k === 'Enter' && !(e.target && e.target.closest && e.target.closest('.dl-root button:not(.dl-start)'))) { e.preventDefault(); this._start(); }
      return;
    }
    if (!this.s) return;
    const ui = this.menu;
    if (ui.open) {
      if (low === 'tab' || low === 'shift' || low === 'enter' || k === ' ' || /^f\d+$/.test(low)) { e.stopPropagation(); return; }
      mine();
      if (e.repeat || ui.busy) return;
      if (ui.ask) {
        if (low === 'y') this._menuRun(ui.ask);
        else if (low === 'n' || low === 'escape' || low === 'backspace') { this._cue('ui-back'); ui.ask = null; this._renderMenu(); }
      } else if (low === 'escape' || low === 'm') this.closeMenu();
      else if (/^[1-4]$/.test(low)) { const it = this._menuItems()[+low - 1]; if (it) this._menuDo(it.id); }
      return;
    }
    if (this.stray && (low === 'u' || low === 'c')) {
      mine();
      if (!e.repeat) { if (low === 'u') { this._strayHide(); this._post('undo'); } else { this._cue('ui-back'); this._strayHide(); } }
      return;
    }
    if (this.kind === 'result') {
      if (k === 'Tab' || k === 'Shift' || k === 'Enter' || k === ' ' || /^F\d+$/.test(k)) { e.stopPropagation(); return; }
      mine();
      if (!e.repeat && (low === 'escape' || low === 'm')) this.openMenu();
      return;
    }
    if (low === 'escape' || low === 'm') { mine(); if (!e.repeat) this.openMenu(); return; }
    if (low === 'u') { e.stopPropagation(); }   // the bay's "unlimited balls" switch is not this game's
  }

  dispose() {
    this._clearTimers();
    clearTimeout(this._pumpT);
    this._strayHide();
    this.doc.removeEventListener('keydown', this._onKey, true);
    this.root.remove();
  }
}

export function mount(ctx) { return new DuelUI(ctx); }
export default { mount, DuelUI };
