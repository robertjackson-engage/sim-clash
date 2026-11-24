// v3:modes BULLSEYE: darts with a golf ball (docs/modes.md "Bullseye"). The screens of the
// game lib/bullseye.js plays on the server: the lobby (one to four players, the arena, the
// game), the in-play header, the board (every ball a dart on a top-down target drawn from
// the arena's real ring radii), the score of each ball, the result, the menu and the
// stray-ball prompt.
//
// A mode module of the shell (public/arcade/shell.js _loadModes): mount(ctx) -> ui, with
// ui.root (class md-root, in #hud), ui.lobbyOpen, ui.live, openLobby(), closeLobby(),
// openMenu(). It draws its own screens and reads its own keys, as the match UI does, and
// borrows match.css's shared pieces (mt-x, mt-btn, mt-menu, mt-stray) so it reads as the
// same game. Sound: guarded calls to the audio API, existing cue and voice ids only.
//
// The server sends the state right after a swing, before the ball has flown: it is held
// until the ball has stopped (ctx.isAnimating), so the header never gives a score away.
// Once the ball has had its moment the page asks for the next one to be teed up
// (POST /api/bullseye/next); a swing that comes sooner is played all the same.
import { PLAYER_COLORS, PLAYER_MARKS, slotColor, slotMark, esc } from './shell-core.js';

const PICK_KEY = 'sim-clash.bullseye.pick';
const POP_MS = 2300;          // a ball's score keeps the screen this long before the next ball is teed up
const POP_BULL_MS = 3000;     // ... a bullseye, a bust or a checkout a little longer
const ROUND_MS = 4200;        // the board at the end of a round
const TURN_MS = 2200;         // the "you're up" banner
const STRAY_MS = 8000;
const FT = 3.28084;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const shout = (name) => String(name || '').trim().toUpperCase();
const big = (text, cls = '', extra = '') => `<span class="mt-x ${cls}" style="--n:${Math.max(3, String(text).length)}${extra ? `;${extra}` : ''}">${esc(text)}</span>`;

// ---------------------------------------------------------------- pure helpers (exported for the tests)

/** "4.2 FT", "8 IN", "HOLED"; a miss has no distance. */
export function ftWords(ft) {
  if (ft == null) return '';
  if (ft === 0) return 'HOLED';
  if (ft < 1) return `${Math.max(1, Math.round(ft * 12))} IN`;
  return `${ft < 100 ? (Math.round(ft * 10) / 10).toFixed(1) : Math.round(ft)} FT`;
}

/** What a ball says when it lands: { title, sub, tone: 'bull' | 'score' | 'blank' | 'miss' | 'bust' }. */
export function ballWords(d) {
  if (!d) return null;
  if (d.checkout) return { title: 'CHECK OUT!', sub: `${d.name}${d.mult > 1 ? ` ×${d.mult}` : ''} · EXACTLY ZERO`, tone: 'bull' };
  if (d.bust) return { title: 'BUST!', sub: `${d.value * d.mult} IS TOO MANY · THE TURN IS OVER`, tone: 'bust' };
  if (d.miss) return { title: 'MISS', sub: d.miss === 'water' ? 'IN THE WATER' : 'OUT OF BOUNDS', tone: 'miss' };
  if (!d.value) return { title: 'NO SCORE', sub: `OFF THE TARGET · ${ftWords(d.ft)}`, tone: 'blank' };
  const where = d.holed ? 'HOLED IT!' : ftWords(d.ft);
  if (d.ring === 0) return { title: d.mult > 1 ? `BULLSEYE! ×${d.mult}` : 'BULLSEYE!', sub: `+${d.score} · ${where}`, tone: 'bull' };
  return { title: `+${d.score}`, sub: `${d.name}${d.mult > 1 ? ` ×${d.mult}` : ''} · ${where}`, tone: 'score' };
}

/** A player's number on the header: points, or what is left in a countdown. */
export const scoreOf = (s, p) => (s.variant === 'countdown' ? p.remaining : p.total);

/** How a game reads in a line: "HIGH SCORE · 3 ROUNDS OF 3", "COUNTDOWN FROM 100". */
export function gameWords(o) {
  if (!o) return '';
  return o.variant === 'countdown' ? `COUNTDOWN FROM ${o.target}` : `HIGH SCORE · ${o.rounds} ROUND${o.rounds === 1 ? '' : 'S'} OF ${o.balls}`;
}

/**
 * The board: a top-down target drawn from the ring table ([{ r, value }], metres), every dart
 * where its ball finished (x across, y along the line of play, metres from the pin; the tee
 * is at the bottom). A ball outside the last ring sits on the rim in its direction; a lost
 * ball is a cross out there.
 *   darts    [{ x, y, slot, n, miss, value, bust, voided }]
 *   opts     { labels: ring values on the rings, numbers: each dart's ball number, last: n to ring, id }
 */
export function boardSvg(rings = [], darts = [], { labels = true, numbers = false, last = null, id = 'be' } = {}) {
  const list = [...rings].sort((a, b) => a.r - b.r);
  const R = list.length ? list[list.length - 1].r : 19;
  const pad = R * 0.2;
  const V = R + pad;
  const band = (i) => (i === 0 ? '#ffd21f' : ['#e23c2c', '#f3efe2', '#1f7fd6', '#f3efe2', '#e23c2c', '#1f7fd6'][(i - 1) % 6]);
  const ink = (i) => (i === 0 || band(i) === '#f3efe2' ? '#14161c' : '#fff');
  let out = `<svg class="be-board" viewBox="${-V} ${-V} ${2 * V} ${2 * V}" role="img" aria-label="The target and every ball">`;
  out += `<circle r="${V}" fill="#0b0f16"/><circle r="${R + pad * 0.42}" fill="#16311f" stroke="#2c5a3a" stroke-width="${R * 0.012}"/>`;
  for (let i = list.length - 1; i >= 0; i--) out += `<circle r="${list[i].r}" fill="${band(i)}" stroke="#0b0f16" stroke-width="${R * 0.012}"/>`;
  out += `<circle r="${Math.max(0.12, R * 0.012)}" fill="#0b0f16"/>`;
  if (labels) {
    for (let i = 0; i < list.length; i++) {
      const inner = i ? list[i - 1].r : 0;
      const mid = i ? (inner + list[i].r) / 2 : 0;
      const fs = Math.min((list[i].r - inner) * (i ? 0.62 : 0.8), R * 0.12);
      out += `<text x="0" y="${-mid + fs * 0.36}" text-anchor="middle" font-size="${fs}" fill="${ink(i)}" class="be-board-v">${list[i].value}</text>`;
    }
  }
  // the tee is at the bottom of the board
  out += `<path d="M ${-R * 0.07} ${V - pad * 0.1} L 0 ${V - pad * 0.62} L ${R * 0.07} ${V - pad * 0.1} Z" fill="rgba(255,255,255,.55)"/>`;
  const dr = R * 0.062;
  for (const d of darts) {
    let x = +d.x || 0, y = -(+d.y || 0);
    const dist = Math.hypot(x, y);
    const off = d.miss || dist > R;
    if (off) { const k = (R + pad * 0.42) / (dist || 1); x *= k; y *= k; }
    const c = slotColor(d.slot);
    const dead = d.voided || d.bust;
    const g = `<g class="be-dart${d.n === last ? ' be-dart-last' : ''}${dead ? ' be-dart-void' : ''}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">`;
    if (d.miss) {
      out += `${g}<path d="M ${-dr * 0.8} ${-dr * 0.8} L ${dr * 0.8} ${dr * 0.8} M ${dr * 0.8} ${-dr * 0.8} L ${-dr * 0.8} ${dr * 0.8}" stroke="#0b0f16" stroke-width="${dr * 0.75}" stroke-linecap="round"/><path d="M ${-dr * 0.8} ${-dr * 0.8} L ${dr * 0.8} ${dr * 0.8} M ${dr * 0.8} ${-dr * 0.8} L ${-dr * 0.8} ${dr * 0.8}" stroke="${c}" stroke-width="${dr * 0.4}" stroke-linecap="round"/></g>`;
      continue;
    }
    out += `${g}${d.n === last ? `<circle r="${dr * 1.9}" fill="none" stroke="#fff" stroke-width="${dr * 0.22}" class="be-dart-ring"/>` : ''}`
      + `<circle r="${dr}" fill="${off ? '#0b0f16' : c}" stroke="${off ? c : '#0b0f16'}" stroke-width="${dr * 0.3}"/>`
      + `<text x="0" y="${dr * 0.42}" text-anchor="middle" font-size="${dr * 1.15}" fill="${off ? c : '#0b0f16'}" class="be-dart-m">${numbers ? esc(String(d.ball ?? '')) : esc(slotMark(d.slot))}</text></g>`;
  }
  return `${out}</svg>`;
}

/** Every dart of the game with its thrower's slot, in the order thrown. */
export function allDarts(s) {
  if (!s) return [];
  return s.players.flatMap((p) => p.darts.map((d) => ({ ...d, slot: p.slot }))).sort((a, b) => a.n - b.n);
}

// ---------------------------------------------------------------- the UI

export class BullseyeUI {
  constructor(ctx) {
    this.ctx = ctx;
    this.doc = ctx.doc || document;
    this.audio = ctx.audio || null;
    this.s = null;              // the game as shown
    this.pend = undefined;      // a state waiting for the ball to stop (undefined: none; null is "no game")
    this.info = { arenas: [], bests: {}, nearest: null, nearestEver: null, defaults: null };
    this.lobby = { open: false, busy: false, error: '', players: [], arena: null, variant: 'high', rounds: 3, target: 100 };
    this.menu = { open: false, ask: null, busy: false };
    this.kind = null;           // the full-bleed screen that is up: 'lobby' | 'loading' | 'board' | 'result' | null
    this.starting = false;      // START was pressed: the game is on its way
    this.seen = { n: 0, turn: '', id: null, doneId: null };
    this.timers = new Set();
    this.stray = null;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { Object.assign(this.lobby, JSON.parse(lsGet(PICK_KEY) || '{}')); } catch (_) { /* a fresh pick */ }
    this.lobby.open = false; this.lobby.busy = false; this.lobby.error = '';
    this._build();
    const es = ctx.events;
    if (es && es.addEventListener) {
      const on = (name, fn) => es.addEventListener(name, (e) => { let d; try { d = JSON.parse(e.data); } catch (_) { return; } fn(d); });
      on('bullseye', (d) => this.onState(d));
      on('shot', () => { this.callout = null; this._onShot(); });
      on('arcade', (d) => { this.callout = d && d.callout && d.callout.text ? { text: String(d.callout.text), tone: d.callout.tone || '' } : null; });   // the arcade's word on the ball in the air (DANCE FLOOR!): it rides on the score
      on('leagues', () => { if (this.lobby.open) this._renderLobby(); });
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
    if (!d.querySelector('link[data-be-css]')) {
      const link = d.createElement('link');
      link.rel = 'stylesheet'; link.href = 'arcade/bullseye.css'; link.setAttribute('data-be-css', '');
      d.head.appendChild(link);
    }
    this.root = d.createElement('div');
    this.root.className = 'md-root be-root';
    this.root.innerHTML = '<div class="be-hdr hidden"></div><div class="be-mini hidden"></div><div class="be-banner"></div>'
      + '<div class="be-screen mt-screen hidden"></div><div class="mt-stray hidden"></div><div class="mt-menu hidden"></div>';
    (this.ctx.hud || d.body).appendChild(this.root);
    const q = (c) => this.root.querySelector(c);
    this.hdr = q('.be-hdr'); this.mini = q('.be-mini'); this.banner = q('.be-banner'); this.screen = q('.be-screen'); this.strayEl = q('.mt-stray'); this.menuEl = q('.mt-menu');
    this.root.addEventListener('click', (e) => this._click(e));
    for (let i = 0; i < 4; i++) this.root.style.setProperty(`--be-p${i + 1}`, PLAYER_COLORS[i]);
  }

  async _load() {
    const r = await this.ctx.fetchJson('/api/bullseye');
    if (!r || r.ok === false) return;
    this._takeInfo(r);
    if (r.bullseye && !this.s && this.pend === undefined) this.onState(r.bullseye);
  }
  _takeInfo(r) {
    for (const k of ['arenas', 'bests', 'nearest', 'nearestEver', 'defaults']) if (r[k] !== undefined) this.info[k] = r[k];
  }
  async _post(action, body = {}) {
    const out = await this.ctx.fetchJson(`/api/bullseye/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!out || out.ok === false) { this._cue('ui-error'); return { ok: false, error: (out && out.error) || 'The game is not answering' }; }
    return out;
  }

  // ---------- sound (existing ids only; all guarded)
  _cue(name, opts) { if (!name) return; try { this.audio?.cue?.(name, opts); } catch (_) { /* silent */ } }
  _say(line, opts) { if (!line) return; try { this.audio?.say?.(line, opts); } catch (_) { /* silent */ } }

  _after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.reduced ? Math.min(ms, 600) : ms);
    this.timers.add(t);
    return t;
  }
  _clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  _sync() {
    this.root.classList.toggle('md-keys', this.live);   // arcade.js: this game has no ball dock and its keys are its own
    try { this.ctx.sync?.(); } catch (_) { /* the shell is gone */ }
  }

  // ---------- the state
  /** The 'bullseye' event. Held while a ball is in the air. */
  onState(s) {
    if (this.s && s && this.s.id === s.id && s.seq < this.s.seq) return;   // stale
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
  /** A ball is on its way: whatever was waiting to happen on screen gives way to it. */
  _onShot() {
    if (!this.s || this.s.phase !== 'play') return;
    this._clearTimers();
    this.banner.innerHTML = '';
    if (this.kind === 'board') this._hideScreen();
    this._strayHide();
  }

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
    if (s.aborted) {   // the arena would not load: back to the lobby with the reason
      this.s = null; this.starting = false;
      this.lobby.error = `THAT ARENA WOULD NOT LOAD: ${shout(s.error)}`;
      this.openLobby(true);
      return;
    }
    this.s = s;
    this.starting = false;
    if (this.lobby.open) { this.lobby.open = false; if (this.kind === 'lobby') this._hideScreen(); }
    if (this.seen.id !== s.id) this.seen = { n: s.lastBall && !prev ? s.lastBall.n : 0, turn: '', id: s.id, doneId: null };
    const fresh = !!prev && prev.id === s.id && s.lastBall && s.lastBall.n > this.seen.n;
    for (const e of s.events || []) {
      if (e.seq <= (this.seen.ev || 0)) continue;
      if (e.type === 'stray-shot' && prev) this._strayShow(s, e);
      if (e.type === 'ball-undone' && prev) this._rewound(s, e);
      if (e.type === 'restarted' && prev) { this.seen.n = 0; this.seen.turn = ''; this.seen.doneId = null; this._clearTimers(); if (this.kind === 'result' || this.kind === 'board') this._hideScreen(); }
    }
    this.seen.ev = Math.max(this.seen.ev || 0, ...(s.events || []).map((e) => e.seq));
    if (s.lastBall) this.seen.n = Math.max(fresh ? 0 : this.seen.n, s.lastBall.n);
    this._sync();
    this._render();
    if (s.phase === 'loading') { this._screenLoading(s); return; }
    if (this.kind === 'loading') this._hideScreen();
    if (fresh) { this._onBall(s, prev); return; }
    if (s.phase === 'done') { if (this.seen.doneId !== s.id && !this.timers.size) this._screenResult(s); return; }
    if (this.kind === 'result') this._hideScreen();
    if (!s.teed && s.waiting && s.waiting.for === 'tee' && !this.timers.size) { this._next(); return; }   // joined between balls
    this._turn(s);
  }

  // A ball has landed and been scored.
  _onBall(s, prev) {
    const d = s.lastBall;
    const w = ballWords(d);
    const p = s.players.find((x) => x.id === d.playerId);
    this._clearTimers();
    this._pop(w, p);
    if (w.tone === 'bull') { this._cue('coin-burst'); this._say('dart'); } else if (w.tone === 'bust') this._cue('sting-fail');
    else if (w.tone === 'score') this._cue(d.mult > 1 ? 'streak-up' : 'trophy-tick');
    else if (prev && prev.turn && prev.turn.streak > 0) this._cue('streak-break');
    const rec = s.records && s.records.newNearest;
    if (d.checkout && s.phase === 'play') this._after(1100, () => this._flash('CAN ANYONE ANSWER?', `${shout(p ? p.name : '')} IS OUT IN ${p ? p.out : ''} BALLS`));
    else if (rec && rec.n === d.n && !rec.first) this._after(900, () => { this._flash('NEAREST THE PIN TONIGHT!', `${shout(p ? p.name : '')} · ${ftWords(d.ft)}`); this._say('m-closest-to-the-pin'); });
    const hold = w.tone === 'bull' || w.tone === 'bust' || s.phase === 'done' ? POP_BULL_MS : POP_MS;
    if (s.phase === 'done') { this._after(hold, () => this._screenResult(s)); return; }
    const roundOver = s.round > d.round;
    this._after(hold, () => {
      this.banner.innerHTML = '';
      if (roundOver && s.players.length > 1) {
        this._screenBoard(s, { title: `END OF ROUND ${d.round}`, auto: true });
        this._cue('whoosh');
        this._after(ROUND_MS, () => { if (this.kind === 'board') this._hideScreen(); this._next(); });
      } else this._next();
    });
  }
  /** Ask for the next ball to be teed up (the picture leaves the last one). */
  async _next() {
    const s = this.s;
    if (!s || s.phase !== 'play') return;
    if (s.teed) { this._turn(s); return; }
    await this._post('next');
  }
  /** "<NAME>, YOU'RE UP" when the thrower changes (and at the start). */
  _turn(s) {
    if (s.phase !== 'play' || !s.currentPlayerId || !s.teed) return;
    const key = `${s.id}|${s.round}|${s.currentPlayerId}`;
    if (this.seen.turn === key) return;
    this.seen.turn = key;
    const p = s.players.find((x) => x.id === s.currentPlayerId);
    if (!p) return;
    const first = s.round === 1 && !allDarts(s).length;
    const sub = s.variant === 'countdown' ? `${p.remaining} LEFT · ROUND ${s.round} OF ${s.rounds}` : `ROUND ${s.round} OF ${s.rounds} · ${s.balls} BALL${s.balls === 1 ? '' : 'S'}`;
    this.banner.innerHTML = `<div class="be-turn be-p${p.slot}"><i class="be-turn-bg"></i>
      <span class="be-turn-k">${first ? `${esc(shout(s.arena.name))} · ${esc(gameWords(s.options))}` : `PLAYER ${p.slot}`}</span>
      ${big(s.players.length > 1 ? `${shout(p.name)}, YOU'RE UP` : first ? 'HIT THE TARGET' : `ROUND ${s.round}`, 'be-turn-t')}
      <span class="be-turn-s">${esc(sub)}</span></div>`;
    this._cue('turn-chime');
    if (s.players.length > 1) this._say('m-youre-up');
    this._after(TURN_MS, () => { const t = this.banner.querySelector('.be-turn'); if (t) t.remove(); });
  }
  _pop(w, p) {
    this.banner.innerHTML = `<div class="be-pop be-tone-${w.tone} ${p ? `be-p${p.slot}` : ''}">
      ${p && this.s.players.length > 1 ? `<span class="be-pop-who"><i>${esc(slotMark(p.slot))}</i>${esc(shout(p.name))}</span>` : ''}
      ${big(w.title, 'be-pop-t')}<span class="be-pop-s">${esc(w.sub)}</span>${this.callout && w.tone !== 'bust' ? `<span class="be-pop-call ${this.callout.tone === 'bad' ? 'be-call-bad' : ''}">${esc(shout(this.callout.text))}</span>` : ''}</div>`;
  }
  _flash(title, sub) {
    const el = this.doc.createElement('div');
    el.className = 'be-flash';
    el.innerHTML = `${big(title, 'be-flash-t')}<span class="be-flash-s">${esc(sub)}</span>`;
    this.banner.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  _rewound(s, e) {
    this._clearTimers();
    this._strayHide();
    if (this.kind === 'result' || this.kind === 'board') this._hideScreen();
    this.seen.doneId = null; this.seen.turn = '';
    this.seen.n = s.lastBall ? s.lastBall.n : 0;
    const p = s.players.find((x) => x.id === e.playerId);
    this.banner.innerHTML = '';
    this._flash('BALL TAKEN BACK', `${p ? shout(p.name) : ''} THROWS IT AGAIN`);
    this._cue('ui-back');
  }

  // ---------- drawing: the header, the small board
  _render() {
    const s = this.s;
    const play = !!s && (s.phase === 'play' || s.phase === 'done');
    this.hdr.classList.toggle('hidden', !play);
    this.mini.classList.toggle('hidden', !play || s.phase === 'done');
    if (!play) { this.hdr.innerHTML = ''; this.mini.innerHTML = ''; this._renderMenu(); return; }
    const cd = s.variant === 'countdown';
    const up = s.players.find((p) => p.id === s.currentPlayerId) || null;
    const lead = s.standings && s.standings[0] ? s.standings[0].playerId : null;
    const anyScore = s.players.some((p) => p.total > 0);
    const chips = s.players.map((p) => {
      const mine = up && up.id === p.id;
      const thrown = p.darts.filter((d) => d.round === s.round);
      let pips = '';
      if (mine) {
        for (let i = 1; i <= s.balls; i++) {
          const d = thrown.find((x) => x.ball === i);
          pips += `<i class="${d ? `on ${d.bust ? 'bust' : d.miss ? 'miss' : d.score ? 'hit' : 'blank'}` : i === s.ball ? 'now' : ''}">${d ? (d.bust ? 'BUST' : d.miss ? '✕' : d.score || d.voided ? (d.score || 0) : '0') : ''}</i>`;
        }
      }
      const left = mine && s.chase && p.out == null ? s.chase.balls - p.balls : 0;
      const fin = mine && p.finish && p.finish.length ? `<span class="be-fin">CHECK OUT: ${esc(p.finish.join(' / '))}</span>`
        : left > 0 ? `<span class="be-fin be-fin-chase">${left} BALL${left === 1 ? '' : 'S'} TO ANSWER</span>` : '';
      return `<div class="be-chip be-p${p.slot} ${mine ? 'be-up' : ''} ${s.phase === 'done' && s.winnerIds.includes(p.id) ? 'be-won' : ''}">
        <i class="be-chip-bg"></i>
        <span class="be-chip-id"><i class="be-mark">${esc(slotMark(p.slot))}</i><em>${p.slot}</em>${p.out != null ? `<u class="be-lead">OUT IN ${p.out}</u>` : anyScore && lead === p.id && s.players.length > 1 ? '<u class="be-lead">LEADS</u>' : ''}</span>
        <span class="be-chip-n">${esc(shout(p.name))}</span>
        <b class="be-chip-s">${p.out != null ? 'OUT' : scoreOf(s, p)}</b>
        ${mine ? `<span class="be-pips">${pips}</span>${s.turn && s.turn.mult > 1 ? `<em class="be-mult">NEXT ×${s.turn.mult}</em>` : ''}` : ''}
        ${fin}</div>`;
    }).join('');
    const wind = s.arena.wind && Number.isFinite(s.arena.wind.mph) ? ` · ${s.arena.wind.mph} MPH` : '';
    this.hdr.className = `be-hdr be-n${s.players.length}`;
    this.hdr.innerHTML = `<div class="be-id"><button type="button" class="be-menu-btn" data-be="menu" title="Menu (Esc)"><i aria-hidden="true"></i>MENU</button>
        <span class="be-id-k">BULLSEYE · ${cd ? `COUNTDOWN ${s.options.target}` : 'HIGH SCORE'}</span>
        <b class="be-id-n">${esc(shout(s.arena.name))}</b>
        <span class="be-id-r">${s.phase === 'done' ? 'GAME OVER' : `ROUND ${s.round} OF ${s.rounds}`}${s.arena.lengthYd ? ` · ${s.arena.lengthYd} YD` : ''}${esc(wind)}</span></div>
      <div class="be-chips">${chips}</div>`;
    const darts = allDarts(s);
    this.mini.innerHTML = `<button type="button" class="be-mini-b" data-be="board" title="The board (B)">${boardSvg(s.rings, darts, { labels: true, last: s.lastBall ? s.lastBall.n : null })}
      <span class="be-mini-c"><kbd>B</kbd>BOARD · ${darts.length} BALL${darts.length === 1 ? '' : 'S'}</span></button>`;
    this._renderMenu();
  }

  // ---------- full-bleed screens
  _show(kind, html) {
    this.kind = kind;
    this.screen.className = `be-screen mt-screen be-s-${kind}`;
    this.screen.innerHTML = html;
  }
  _hideScreen() {
    this.kind = null;
    this.screen.className = 'be-screen mt-screen hidden';
    this.screen.innerHTML = '';
  }
  _bg(cls = '') { return `<div class="be-bg ${cls}" aria-hidden="true"><i class="be-bg-a"></i><i class="be-bg-b"></i><i class="be-bg-rings"></i></div>`; }

  _screenLoading(s) {
    if (this.kind === 'loading') return;
    this._show('loading', `${this._bg()}<div class="be-load"><span class="be-kick">BULLSEYE · ${esc(gameWords(s.options))}</span>${big(shout(s.arena.name), 'be-load-t')}<span class="be-load-s">SETTING UP THE TARGET</span></div>`);
  }

  _table(s, { final = false } = {}) {
    const cd = s.variant === 'countdown';
    const order = (s.standings || []).map((x) => s.players.find((p) => p.id === x.playerId)).filter(Boolean);
    const rank = (id) => ((s.standings || []).find((x) => x.playerId === id) || {}).rank;
    const rec = s.records || {};
    const rounds = Math.max(1, ...s.players.map((p) => p.turns.length));
    const cols = Math.min(rounds, 4);   // the last four rounds (a long game keeps the row readable)
    return `<div class="be-table be-cols${cols}">
      <div class="be-row be-row-h"><span></span><span>PLAYER</span>${Array.from({ length: cols }, (_, i) => `<span class="be-c">R${rounds - cols + i + 1}</span>`).join('')}<span class="be-c">NEAREST</span><span class="be-tot">${cd ? 'LEFT' : 'TOTAL'}</span></div>
      ${order.map((p) => {
    const turns = p.turns.slice(-cols);
    return `<div class="be-row be-p${p.slot} ${final && s.winnerIds.includes(p.id) ? 'be-row-win' : ''}">
        <span class="be-rk">${rank(p.id) ?? ''}</span>
        <span class="be-nm"><i class="be-mark">${esc(slotMark(p.slot))}</i><b>${esc(shout(p.name))}</b><em>${final && (rec.newBest || []).includes(p.id) ? '<u class="be-new">NEW BEST</u>' : ''}${p.bulls ? `<u class="be-bulls">${p.bulls} BULL${p.bulls === 1 ? '' : 'S'}</u>` : ''}${p.busts ? `<u class="be-bulls">${p.busts} BUST${p.busts === 1 ? '' : 'S'}</u>` : ''}</em></span>
        ${Array.from({ length: cols }, (_, i) => `<span class="be-c">${turns[i] ? (turns[i].bust ? '<s>BUST</s>' : turns[i].score) : '·'}</span>`).join('')}
        <span class="be-c be-near">${p.closestFt == null ? '–' : esc(ftWords(p.closestFt))}</span>
        <b class="be-tot${p.out != null ? ' be-tot-out' : ''}">${p.out != null ? `OUT IN ${p.out}` : scoreOf(s, p)}</b></div>`;
  }).join('')}</div>`;
  }
  _nearLine(s) {
    const rec = s.records || {};
    const n = rec.nearest || this.info.nearest;
    if (!n) return '';
    const fresh = rec.newNearest && !rec.newNearest.first;   // beaten in this game (the night's first ball only sets it)
    return `<div class="be-nearest ${fresh ? 'be-nearest-new' : ''}"><span>NEAREST THE PIN TONIGHT</span><b>${esc(shout(n.name || 'A GUEST'))} · ${esc(ftWords(n.ft))}</b>${fresh ? '<u>NEW TONIGHT!</u>' : n.arenaName && n.arenaId !== s.arena.id ? `<em>AT ${esc(shout(n.arenaName))}</em>` : ''}</div>`;
  }

  /** The board, big: every dart, the scores so far. On B, and by itself at the end of a round. */
  _screenBoard(s, { title = 'THE BOARD', auto = false } = {}) {
    this._show('board', `${this._bg('be-bg-dim')}
      <div class="be-board-l">${boardSvg(s.rings, allDarts(s), { labels: true, last: s.lastBall ? s.lastBall.n : null })}</div>
      <div class="be-board-r">
        <span class="be-kick">${esc(shout(s.arena.name))} · ${esc(gameWords(s.options))}</span>
        ${big(title, 'be-board-t')}
        ${this._table(s)}
        ${this._nearLine(s)}
        <span class="be-hint">${auto ? 'NEXT ROUND IN A MOMENT · HIT WHEN YOU ARE READY' : '<kbd>B</kbd> OR <kbd>ESC</kbd> BACK TO THE TEE · SWINGS STILL COUNT'}</span>
      </div>`);
  }

  _screenResult(s) {
    if (!this.s || this.s.id !== s.id || s.phase !== 'done') return;
    this.seen.doneId = s.id;
    this.banner.innerHTML = '';
    this.menu.open = false; this._renderMenu();
    const cd = s.variant === 'countdown';
    const winners = s.winnerIds.map((id) => s.players.find((p) => p.id === id)).filter(Boolean);
    const w = winners[0] || null;
    const solo = s.players.length === 1;
    const rec = s.records || {};
    const newBest = w && (rec.newBest || []).includes(w.id);
    const title = solo ? (cd ? (w && w.remaining === 0 ? 'CHECKED OUT!' : `${s.players[0].remaining} LEFT`) : `${s.players[0].total} POINTS`)
      : winners.length > 1 ? 'GAME SHARED' : `${shout(w ? w.name : '')} WINS!`;
    const how = solo ? (newBest ? 'A NEW BEST ON THIS ARENA' : rec.bests && rec.bests[s.players[0].id] ? (cd ? `YOUR BEST: ${rec.bests[s.players[0].id].balls} BALLS` : `YOUR BEST: ${rec.bests[s.players[0].id].score}`) : '')
      : winners.length > 1 ? `${winners.map((p) => shout(p.name)).join(' AND ')} · LEVEL ON EVERYTHING`
        : s.reason === 'finish' ? `CHECKED OUT IN ${w.out} BALLS` : s.reason === 'cap' ? `NEAREST TO ZERO: ${w.remaining} LEFT` : `${w.total} POINTS`;
    this._show('result', `${this._bg(`be-bg-win ${w && winners.length === 1 ? `be-p${w.slot}` : ''}`)}
      <div class="be-board-l">${boardSvg(s.rings, allDarts(s), { labels: true })}</div>
      <div class="be-board-r ${w && winners.length === 1 ? `be-p${w.slot}` : ''}">
        <span class="be-kick">${esc(shout(s.arena.name))} · ${esc(gameWords(s.options))}</span>
        ${big(title, 'be-res-t')}
        ${how ? `<span class="be-res-how">${esc(how)}</span>` : ''}
        ${this._table(s, { final: true })}
        ${this._nearLine(s)}
        <div class="be-actions">
          <button type="button" class="mt-btn mt-btn-go" data-be="again">PLAY AGAIN</button>
          <button type="button" class="mt-btn" data-be="change">CHANGE GAME</button>
          <button type="button" class="mt-btn mt-btn-dim" data-be="exit">EXIT</button>
        </div>
      </div>`);
    this._cue('lobby-open');
    this._after(350, () => { this._cue(solo && !newBest ? 'whoosh' : 'fanfare-win'); if (!solo || newBest) this._cue('confetti-pop'); if ((rec.newBest || []).length) this._say('m-new-record'); else if (!solo && winners.length === 1) this._say('m-champion'); });
    this._after(500, () => this.screen.querySelector('[data-be="again"]')?.focus({ preventScroll: true }));
    this.ctx.fetchJson('/api/bullseye').then((r) => { if (r) this._takeInfo(r); });
  }

  // ---------- the lobby
  _roster() { return (this.ctx.players && this.ctx.players()) || []; }
  _fixPick() {
    const L = this.lobby;
    const roster = this._roster();
    const ids = roster.map((p) => p.id);
    L.players = (Array.isArray(L.players) ? L.players : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i).slice(0, 4);
    if (!L.players.length && roster.length) L.players = [roster[0].id];
    const arenas = this.info.arenas || [];
    if (!arenas.some((a) => a.id === L.arena)) L.arena = arenas[0] ? arenas[0].id : null;
    if (L.variant !== 'countdown') L.variant = 'high';
    if (![3, 5, 7].includes(+L.rounds)) L.rounds = 3;
    if (![100, 200, 300].includes(+L.target)) L.target = 100;
  }
  _savePick() { const { players, arena, variant, rounds, target } = this.lobby; lsSet(PICK_KEY, JSON.stringify({ players, arena, variant, rounds, target })); }

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
    this._fixPick();
    this._renderLobby();
    this.screen.querySelector('[data-be="start"]')?.focus({ preventScroll: true });
  }
  closeLobby() {
    if (!this.lobby.open) return;
    this.lobby.open = false;
    if (this.kind === 'lobby') this._hideScreen();
    this._sync();
  }
  _best(arenaId, playerId) {
    const L = this.lobby;
    const b = (this.info.bests || {})[arenaId];
    if (!b) return null;
    if (L.variant === 'countdown') { const r = ((b.countdown || {})[String(L.target)] || {})[playerId]; return r ? `BEST ${r.balls} BALLS` : null; }
    const r = ((b.high || {})[`${L.rounds}x3`] || {})[playerId];
    return r ? `BEST ${r.score}` : null;
  }
  _renderLobby() {
    const L = this.lobby;
    if (!L.open) return;
    const roster = this._roster();
    const arenas = this.info.arenas || [];
    const slots = [0, 1, 2, 3].map((i) => {
      const p = roster.find((x) => x.id === L.players[i]) || null;
      if (!p) {
        const can = i === L.players.length;
        return `<button type="button" class="be-slot be-slot-empty be-p${i + 1}" data-be="slot" data-i="${i}" ${can ? '' : 'disabled'}><i class="be-slot-bg"></i>
          <span class="be-slot-k"><i class="be-mark">${esc(PLAYER_MARKS[i])}</i>PLAYER ${i + 1}</span><b class="be-slot-add">${can ? '+ ADD' : ''}</b><span class="be-slot-h">${can ? `PRESS ${i + 1}` : ''}</span></button>`;
      }
      const best = this._best(L.arena, p.id);
      return `<button type="button" class="be-slot be-p${i + 1}" data-be="slot" data-i="${i}"><i class="be-slot-bg"></i>
        <span class="be-slot-k"><i class="be-mark">${esc(PLAYER_MARKS[i])}</i>PLAYER ${i + 1}<span class="be-slot-c"><kbd>${i + 1}</kbd>CHANGE</span></span>
        ${big(shout(p.name), 'be-slot-n')}
        <span class="be-slot-h">${best ? esc(best) : 'NO SCORE HERE YET'}</span></button>`;
    }).join('');
    const cards = arenas.map((a) => {
      const rings = a.rings && a.rings.length ? a.rings : [{ r: 3, value: 50 }, { r: 7, value: 25 }, { r: 11, value: 15 }, { r: 15, value: 10 }, { r: 19, value: 5 }];
      return `<button type="button" class="be-arena ${a.id === L.arena ? 'on' : ''}" data-be="arena" data-id="${esc(a.id)}">
        ${boardSvg(rings, [], { labels: false })}
        <span class="be-arena-n">${esc(shout(a.name))}</span>
        <span class="be-arena-s">${a.lengthYd ? `${a.lengthYd} YD` : ''}${a.rings ? ` · ${a.rings.length} RINGS` : ''}${a.wind && Number.isFinite(a.wind.max) ? `<br>WIND ${a.wind.min} TO ${a.wind.max} MPH` : ''}</span></button>`;
    }).join('') || '<span class="be-none">NO ARENA IS INSTALLED</span>';
    const seg = (key, options, cur) => `<div class="be-seg">${options.map(([v, label]) => `<button type="button" class="${String(v) === String(cur) ? 'on' : ''}" data-be="${key}" data-v="${v}">${esc(label)}</button>`).join('')}</div>`;
    const cd = L.variant === 'countdown';
    const caps = (this.info.defaults && this.info.defaults.countdownRounds) || { 100: 6, 200: 10, 300: 14 };
    const rules = cd
      ? `START ON ${L.target} AND SCORE DOWN. LAND ON EXACTLY ZERO TO CHECK OUT: THE FEWEST BALLS WINS. GO BELOW ZERO AND YOU BUST. ${caps[L.target]} ROUNDS AT MOST.`
      : `${L.rounds} ROUNDS OF 3 BALLS. THE RING YOUR BALL STOPS IN IS YOUR SCORE. MOST POINTS WINS.`;
    const n = this.info.nearest;
    const can = (L.players.length >= 1 || !roster.length) && !!L.arena && !L.busy;
    this._show('lobby', `${this._bg('be-bg-lobby')}
      <header class="be-lob-head">
        <button type="button" class="be-back" data-be="back"><i aria-hidden="true">‹</i>BACK<kbd>ESC</kbd></button>
        ${big('BULLSEYE', 'be-lob-t')}
        <span class="be-lob-tag">DARTS WITH A GOLF BALL · 1 TO 4 PLAYERS</span>
      </header>
      <section class="be-lob-players">${slots}</section>
      <section class="be-lob-mid">
        <div class="be-lob-arenas"><span class="be-lab"><kbd>A</kbd>ARENA</span><div class="be-arenas">${cards}</div></div>
        <div class="be-lob-game">
          <span class="be-lab"><kbd>G</kbd>GAME</span>${seg('variant', [['high', 'HIGH SCORE'], ['countdown', 'COUNTDOWN']], L.variant)}
          <span class="be-lab"><kbd>R</kbd>${cd ? 'START ON' : 'ROUNDS'}</span>${cd ? seg('target', [[100, '100'], [200, '200'], [300, '300']], L.target) : seg('rounds', [[3, '3'], [5, '5'], [7, '7']], L.rounds)}
          <p class="be-rules">${esc(rules)}</p>
          <p class="be-rules be-rules-2">${cd ? 'BULLSEYE 50 · NO MULTIPLIER · WATER IS A MISS' : 'BULLSEYE 50 · SCORE WITH EVERY BALL OF A TURN: 2ND ×2, 3RD ×3 · WATER IS A MISS'}</p>
        </div>
      </section>
      <footer class="be-lob-foot">
        <div class="be-lob-near">${L.error ? `<span class="be-err" role="alert">${esc(L.error)}</span>` : n ? `<span>NEAREST THE PIN TONIGHT</span><b>${esc(shout(n.name || 'A GUEST'))} · ${esc(ftWords(n.ft))}</b>` : '<span>NEAREST THE PIN TONIGHT</span><b>NOBODY YET</b>'}</div>
        <button type="button" class="mt-btn mt-btn-go be-start" data-be="start" ${can ? '' : 'disabled'}>${L.busy ? 'STARTING…' : 'START'}<kbd>ENTER</kbd></button>
      </footer>`);
  }
  /** A slot was picked: an empty one takes the next player who is not in the game (made on the spot when the roster is short); a filled one cycles on, and drops out after the last. */
  async _slot(i) {
    const L = this.lobby;
    if (L.busy) return;
    const roster = this._roster();
    const free = roster.filter((p) => !L.players.includes(p.id));
    if (i >= L.players.length) {
      if (i > L.players.length) return;
      let p = free[0] || null;
      if (!p) {
        if (roster.length >= 8) { this._cue('ui-error'); return; }
        L.busy = true;
        const out = await this.ctx.fetchJson('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Player ${roster.length + 1}` }) });
        L.busy = false;
        p = out && out.player ? out.player : null;
        if (!p) { this._cue('ui-error'); return; }
        if (!this._roster().some((x) => x.id === p.id)) this._roster().push(p);
      }
      L.players.push(p.id);
    } else {
      const cur = roster.findIndex((p) => p.id === L.players[i]);
      const next = roster.slice(cur + 1).find((p) => !L.players.includes(p.id));
      if (next) L.players[i] = next.id;
      else if (L.players.length > 1) L.players.splice(i, 1);
      else { const first = free[0]; if (first) L.players[i] = first.id; }
    }
    this._cue('select-player');
    this._savePick();
    this._renderLobby();
  }
  _cycle(key, list, dir = 1) {
    const L = this.lobby;
    const i = list.findIndex((v) => String(v) === String(L[key]));
    L[key] = list[(i + dir + list.length) % list.length];
    this._cue(key === 'arena' ? 'select-stage' : 'toggle-on');
    this._savePick();
    this._renderLobby();
  }
  async _start() {
    const L = this.lobby;
    if (L.busy) return;
    if (!L.players.length && this._roster().length) { this._cue('ui-error'); return; }
    L.busy = true; L.error = '';
    this._cue('start-match');
    this._renderLobby();
    const out = await this._post('start', { playerIds: L.players, arena: L.arena, variant: L.variant, ...(L.variant === 'countdown' ? { target: L.target } : { rounds: L.rounds }), balls: 3 });
    L.busy = false;
    if (!out.ok) { L.error = shout(out.error); this._renderLobby(); return; }
    this.starting = true;
    this.onState(out.bullseye);
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
      { id: 'resume', label: 'RESUME', sub: 'BACK TO THE GAME', on: true },
      { id: 'undo', label: 'UNDO LAST BALL', sub: u ? `${who ? shout(who.name) : ''}'S BALL IS THROWN AGAIN` : 'NO BALL TO TAKE BACK', on: !!u },
      { id: 'restart', label: 'RESTART GAME', sub: 'THE SAME GAME FROM THE TOP · EVERY BALL IS WIPED', on: !!s.canRestart, ask: { title: 'RESTART GAME?', sub: 'EVERY BALL IS WIPED' } },
      { id: 'exit', label: 'EXIT TO MAIN MENU', sub: 'THE GAME IS ABANDONED', on: true, ask: s.phase === 'done' ? null : { title: 'EXIT?', sub: 'THE GAME IS ABANDONED' } },
    ];
  }
  _renderMenu() {
    const ui = this.menu, s = this.s;
    if (!s || !ui.open) { this.menuEl.className = 'mt-menu hidden'; this.menuEl.innerHTML = ''; return; }
    const items = this._menuItems();
    const asking = items.find((x) => x.id === ui.ask && x.ask && x.on) || null;
    if (!asking) ui.ask = null;
    const where = `${esc(shout(s.arena.name))} · ${s.phase === 'done' ? 'GAME OVER' : `ROUND ${s.round} OF ${s.rounds}`}`;
    const body = asking
      ? `<span class="mt-x mt-menu-t mt-menu-q" style="--n:${asking.ask.title.length}">${esc(asking.ask.title)}</span><span class="mt-menu-sub">${esc(asking.ask.sub)}</span>
         <div class="mt-menu-yn"><button type="button" class="mt-menu-b mt-menu-yes" data-be="menu-yes" ${ui.busy ? 'disabled' : ''}><i>Y</i><b>YES</b></button>
           <button type="button" class="mt-menu-b mt-menu-no" data-be="menu-no" ${ui.busy ? 'disabled' : ''}><i>N</i><b>NO</b></button></div>`
      : `<span class="mt-x mt-menu-t">BULLSEYE MENU</span><span class="mt-menu-sub">${where}</span>
         <div class="mt-menu-list">${items.map((x, i) => `<button type="button" class="mt-menu-b mt-menu-${x.id === 'exit' ? 'quit' : x.id}" data-be="menu-do" data-do="${x.id}" ${x.on && !ui.busy ? '' : 'disabled'}><i>${i + 1}</i><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>
         <span class="mt-menu-note">SWINGS STILL COUNT WHILE THIS IS OPEN · ESC TO RESUME</span>`;
    const key = `${asking ? asking.id : ''}|${ui.busy}|${items.map((x) => `${x.on}${x.sub}`).join('|')}`;
    if (this.menuEl.dataset.key === key && !this.menuEl.classList.contains('hidden')) return;
    this.menuEl.dataset.key = key;
    this.menuEl.className = `mt-menu ${asking ? 'mt-menu-asking' : ''}`;
    this.menuEl.innerHTML = `<div class="mt-menu-back" data-be="${asking ? 'menu-no' : 'menu-resume'}"></div><div class="mt-menu-panel" role="dialog" aria-modal="true" aria-label="Bullseye menu">${body}</div>`;
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
      <span class="mt-stray-k">${e.speedMph != null ? `${Math.round(e.speedMph)} MPH · ` : ''}THAT COUNTED AS ${esc(p ? shout(p.name) : 'A')}'S BALL</span>
      <span class="mt-x mt-stray-t">STRAY BALL?</span>
      <div class="mt-stray-row">
        <button type="button" class="mt-menu-b mt-stray-undo" data-be="stray-undo"><i>U</i><b>UNDO</b></button>
        <button type="button" class="mt-menu-b mt-stray-count" data-be="stray-count"><i>C</i><b>COUNT IT</b></button>
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
    const el = e.target && e.target.closest ? e.target.closest('[data-be]') : null;
    if (!el || el.disabled) return;
    const L = this.lobby;
    switch (el.dataset.be) {
      case 'menu': this.openMenu(); break;
      case 'board': this._toggleBoard(); break;
      case 'back': this._cue('ui-back'); this.closeLobby(); break;
      case 'slot': this._slot(+el.dataset.i); break;
      case 'arena': L.arena = el.dataset.id; this._cue('select-stage'); this._savePick(); this._renderLobby(); break;
      case 'variant': L.variant = el.dataset.v; this._cue('toggle-on'); this._savePick(); this._renderLobby(); break;
      case 'rounds': L.rounds = +el.dataset.v; this._cue('toggle-on'); this._savePick(); this._renderLobby(); break;
      case 'target': L.target = +el.dataset.v; this._cue('toggle-on'); this._savePick(); this._renderLobby(); break;
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
  _toggleBoard() {
    const s = this.s;
    if (!s || s.phase !== 'play') return;
    if (this.kind === 'board') { this._cue('ui-back'); this._hideScreen(); return; }
    if (this.kind) return;
    this._cue('ui-tick');
    this._screenBoard(s);
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
      const arenas = (this.info.arenas || []).map((a) => a.id);
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); this._cue('ui-back'); this.closeLobby(); }
      else if (/^[1-4]$/.test(k)) { e.preventDefault(); this._slot(+k - 1); }
      else if (low === 'a' || k === 'ArrowRight') { e.preventDefault(); if (arenas.length) this._cycle('arena', arenas, 1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); if (arenas.length) this._cycle('arena', arenas, -1); }
      else if (low === 'g') { e.preventDefault(); this._cycle('variant', ['high', 'countdown']); }
      else if (low === 'r') { e.preventDefault(); if (L.variant === 'countdown') this._cycle('target', [100, 200, 300]); else this._cycle('rounds', [3, 5, 7]); }
      else if (k === 'Enter' && !(e.target && e.target.closest && e.target.closest('.be-root button:not(.be-start)'))) { e.preventDefault(); this._start(); }
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
      if (k === 'Tab' || k === 'Shift' || k === 'Enter' || k === ' ' || /^F\d+$/.test(k)) { e.stopPropagation(); return; }   // the focused button's own
      mine();
      if (!e.repeat && (low === 'escape' || low === 'm')) this.openMenu();
      return;
    }
    if (this.kind === 'board') {
      if (/^F\d+$/.test(k) || k === 'Shift') return;
      mine();
      if (!e.repeat) { this._clearTimers(); this._cue('ui-back'); this._hideScreen(); if (this.s.phase === 'play' && !this.s.teed) this._next(); }
      return;
    }
    if (this.kind === 'loading') { if (low === 'escape' || low === 'm') { mine(); if (!e.repeat) this.openMenu(); } return; }
    if (low === 'escape' || low === 'm') { mine(); if (!e.repeat) this.openMenu(); return; }
    if (low === 'b') { mine(); if (!e.repeat) this._toggleBoard(); return; }
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

export function mount(ctx) { return new BullseyeUI(ctx); }
export default { mount, BullseyeUI };
