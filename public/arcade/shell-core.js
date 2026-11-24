// v2:shell The game's front end, the part with no DOM in it (docs/sim-clash-shell.md).
//
// The menu's state machine (which screen is up, where the cursor is, what a key does), the
// lists the screens are built from, and the small sums the test swing and the cards need.
// public/arcade/shell.js draws it; test/shell-core.test.mjs runs it in Node.

// ---------------------------------------------------------------- which product
/**
 * Is this page the game ('simclash') or the simulator ('open-birdie')? The server says
 * (window.__PRODUCT__.mode, from GET /product.js); ?sim=1 shows the simulator on a game
 * server; a page with no bootstrap (an old cache, a demo page) is the game unless ?arcade=0.
 */
export function pageProduct({ query = null, product = null } = {}) {
  const q = (k) => (query && typeof query.get === 'function' ? query.get(k) : null);
  if (q('sim') === '1') return 'open-birdie';
  if (product && product.mode === 'open-birdie') return 'open-birdie';
  if (q('arcade') === '0' || q('visualCapture') === '1') return 'open-birdie';   // the plain simulator view, and the capture rig
  return 'simclash';
}

/**
 * Where the page starts. 'title' unless the address asks for something else:
 *   ?match=1   the match lobby (the deep link the match tools use)
 *   ?menu=0    straight onto the stage, no title, no menu (tools, screenshots, QA)
 *   ?menu=main the main menu, no title
 *   ?connect=1 the launch-monitor wizard (over the main menu)
 */
export function startScreen(query = null) {
  const q = (k) => (query && typeof query.get === 'function' ? query.get(k) : null);
  if (q('match') === '1') return 'versus';
  if (q('menu') === '0') return 'game';
  if (q('menu') === 'main') return 'main';
  if (q('connect') === '1') return 'connect';
  return 'title';
}

// ---------------------------------------------------------------- the menu map
// Every screen of the front end. `parent`: where ESC goes. A screen with `list` has a
// cursor that the arrows move; `grid` screens move in two dimensions (shell.js says how
// many columns). 'versus' is the match lobby (the match UI draws it; the shell only knows
// it is up) and 'game' is play itself: the only screen in which a swing is a shot.
export const SCREENS = Object.freeze({
  title: { parent: null },
  main: { parent: 'title', list: true },
  versus: { parent: 'main' },
  connect: { parent: 'main' },   // the launch-monitor wizard (public/arcade/connect.js draws it; its keys are its own)
  solo: { parent: 'main', list: true },
  'solo-stage': { parent: 'solo', grid: true },
  practice: { parent: 'main', list: true },
  'practice-stage': { parent: 'practice', grid: true },
  players: { parent: 'main', list: true },
  settings: { parent: 'main', list: true },
  monitor: { parent: 'settings' },
  credits: { parent: 'settings' },
  howto: { parent: 'main' },
  game: { parent: null },
  pause: { parent: 'game', list: true },
  result: { parent: null, list: true },
});

export const MAIN_ITEMS = Object.freeze([
  { id: 'versus', label: 'VERSUS', sub: 'TWO PLAYERS · HEAD TO HEAD', to: 'versus', tone: 'duel' },
  { id: 'solo', label: 'SOLO', sub: 'ONE PLAYER · THE TOUR FOR A SCORE', to: 'solo', tone: 'p1' },
  { id: 'practice', label: 'PRACTICE', sub: 'FREE HITTING AND MINI GAMES', to: 'practice', tone: 'p2' },
  { id: 'players', label: 'PLAYERS', sub: 'ROSTER · RANKS · TROPHIES', to: 'players', tone: 'plain' },
  { id: 'settings', label: 'SETTINGS', sub: 'SOUND · CAMERA · ASSISTS · MONITOR', to: 'settings', tone: 'plain' },
  { id: 'howto', label: 'HOW TO PLAY', sub: 'THE RULES · THE BALLS · THE KEYS', to: 'howto', tone: 'plain' },
  { id: 'quit', label: 'QUIT', sub: 'CLOSE THE GAME', to: null, tone: 'plain', desktopOnly: true },
]);

/** The main menu for this window: QUIT only where there is a window to close. */
export function mainItems({ canQuit = false } = {}) {
  return MAIN_ITEMS.filter((x) => !x.desktopOnly || canQuit);
}

/** The solo menu: the tour at three lengths (as many as the stages built allow), and a single stage. */
export function soloItems({ stages = 0, bests = null, playerId = null } = {}) {
  const n = Math.max(0, stages | 0);
  const key = playerId || '_guest';
  const best = (len) => {
    const b = bests && bests.tours && bests.tours[String(len)] ? bests.tours[String(len)][key] : null;
    return b ? `BEST ${relText(b.toPar)} · ${b.strokes} STROKES` : 'NO SCORE YET';
  };
  const out = [];
  const lengths = [];
  if (n >= 4) lengths.push([3, 'SPRINT']);
  if (n >= 8) lengths.push([6, 'HALF TOUR']);
  if (n >= 1) lengths.push([n, n >= 4 ? 'FULL TOUR' : 'THE TOUR']);
  for (const [len, name] of lengths) {
    out.push({ id: `tour-${len}`, kind: 'tour', length: len, label: name, sub: `${len} STAGE${len === 1 ? '' : 'S'} · ${best(len)}` });
  }
  out.push({ id: 'single', kind: 'stage', label: 'SINGLE STAGE', sub: n ? 'PICK ANY STAGE OR ARENA · PLAY IT FOR A SCORE' : 'NO STAGES INSTALLED', disabled: !n });
  return out;
}

// The practice games offered on the arcade stages. The simulator has seven (lib/practice.js);
// four of them (range, long drive, targets, ladder) plant their flags along the hole's line
// from the tee, which on these stages is a lagoon, a canyon or a lava field, so they are
// left out. `fits(stage)`: the stages a game can be played on.
export const PRACTICE_GAMES = Object.freeze([
  { id: 'free', label: 'FREE PLAY', sub: 'PLAY THE STAGE · NO SCORE · IT TEES UP AGAIN', mode: null, fits: () => true },
  { id: 'closest', label: 'CLOSEST TO THE PIN', sub: '5 BALLS · YOUR BEST ONE COUNTS', mode: 'closest', fits: (s) => !!s && s.par === 3 && (s.lengthYd || 0) <= 240 },
  { id: 'putting', label: 'PUTTING CHALLENGE', sub: '9 PUTTS · 3 TO 40 FEET', mode: 'putting', fits: () => true },
  { id: 'chipping', label: 'UP AND DOWN', sub: '6 CHIPS FROM OFF THE GREEN', mode: 'chipping', fits: () => true },
]);
export const practiceGame = (id) => PRACTICE_GAMES.find((g) => g.id === id) || PRACTICE_GAMES[0];

// ---------------------------------------------------------------- the state machine
const clampWrap = (i, n) => (n > 0 ? ((i % n) + n) % n : 0);

/**
 * The menu machine. It owns the stack of screens and the cursor of each; the page tells
 * it what happened (a key, a click, a swing) and it answers what to do.
 *
 *   start      the first screen (startScreen(query))
 *   count      (screen) -> how many items that screen's list has now
 *   columns    (screen) -> columns of a grid screen (default 1)
 *
 * Every method returns an effect: { type, ... } with type one of
 *   'none'     nothing happened (the key was not the menu's)
 *   'move'     the cursor moved             { screen, cursor }
 *   'open'     a screen opened              { screen, from }
 *   'back'     a screen closed              { screen, from }
 *   'select'   an item was chosen           { screen, index }
 *   'adjust'   left / right on a list item  { screen, index, dir }
 *   'leave-title'  a key on the title: the page calls leaveTitle() (it knows whether the
 *                  connection wizard is due)
 * The page plays one sound per effect and redraws.
 */
export function createShellMachine({ start = 'title', count = () => 0, columns = () => 1 } = {}) {
  const first = SCREENS[start] ? start : 'title';
  const stack = [];
  // a deep start still has its parents under it, so ESC steps back through them
  for (let s = first; s; s = SCREENS[s].parent) stack.unshift(s);
  if (first === 'game') stack.splice(0, stack.length, 'game');
  const cursors = {};
  const top = () => stack[stack.length - 1];
  const none = { type: 'none' };

  const api = {
    get screen() { return top(); },
    get stack() { return [...stack]; },
    /** The swing gate: true on every screen that is not play itself. */
    get inMenu() { return top() !== 'game' && top() !== 'pause' && top() !== 'result'; },
    cursor(screen = top()) { return clampWrap(cursors[screen] || 0, Math.max(1, count(screen))); },
    setCursor(i, screen = top()) {
      const n = count(screen);
      if (!n) return none;
      const next = clampWrap(i, n);
      if (next === (cursors[screen] || 0)) return none;
      cursors[screen] = next;
      return { type: 'move', screen, cursor: next };
    },

    /** Open a screen on top of the one that is up. */
    open(screen) {
      if (!SCREENS[screen] || top() === screen) return none;
      const from = top();
      stack.push(screen);
      return { type: 'open', screen, from };
    },
    /** One level back (ESC). The title and play itself have nowhere to go back to. */
    back() {
      const from = top();
      if (from === 'title' || from === 'game' || from === 'result') return none;
      stack.pop();
      if (!stack.length) stack.push(SCREENS[from].parent || 'title');
      return { type: 'back', screen: top(), from };
    },
    /** Straight to a screen, with its parents under it (the main menu from a game, a game from anywhere). */
    go(screen) {
      if (!SCREENS[screen]) return none;
      const from = top();
      stack.length = 0;
      if (screen === 'game' || screen === 'result') stack.push('game');
      if (screen !== 'game') {
        const chain = [];
        for (let s = screen; s && s !== 'game'; s = SCREENS[s].parent) chain.unshift(s);
        stack.push(...chain);
      }
      return from === top() ? none : { type: 'open', screen: top(), from };
    },

    /**
     * A real swing arrived while the menus were up (the server dropped it and said so). On
     * the title it is "press any key"; anywhere else it is nothing. Never a shot.
     */
    swing() {
      if (top() === 'title') return api.open('main');
      return none;
    },

    /**
     * Leave the title. `needsConnect`: no launch monitor has been chosen yet (the first
     * run), so the connection wizard opens on top of the main menu: when it is done, or
     * skipped, the main menu is what is under it.
     */
    leaveTitle({ needsConnect = false } = {}) {
      if (top() !== 'title') return none;
      const eff = api.open('main');
      if (needsConnect) stack.push('connect');
      return { ...eff, screen: top() };
    },

    /**
     * A key. `key` is KeyboardEvent.key. Returns the effect; 'none' means the key is not
     * the menu's (play has its own keys, the match lobby its own).
     */
    key(key, { repeat = false } = {}) {
      const s = top();
      const k = String(key || '');
      if (s === 'game' || s === 'versus' || s === 'connect') return none;
      if (/^F\d+$/.test(k) || k === 'Tab' || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return none;
      if (s === 'title') return repeat ? none : { type: 'leave-title' };
      if (k === 'Escape' || k === 'Backspace') return repeat ? none : api.back();
      const def = SCREENS[s];
      const n = count(s);
      const cols = Math.max(1, def.grid ? columns(s) : 1);
      const cur = api.cursor(s);
      if (def.list || def.grid) {
        if (k === 'ArrowDown') return api.setCursor(def.grid ? Math.min(n - 1, cur + cols) : cur + 1, s);
        if (k === 'ArrowUp') return api.setCursor(def.grid ? Math.max(0, cur - cols) : cur - 1, s);
        if (def.grid && (k === 'ArrowLeft' || k === 'ArrowRight')) return api.setCursor(cur + (k === 'ArrowLeft' ? -1 : 1), s);
        if (k === 'ArrowLeft' || k === 'ArrowRight') return n ? { type: 'adjust', screen: s, index: cur, dir: k === 'ArrowLeft' ? -1 : 1 } : none;
        if (k === 'Home') return api.setCursor(0, s);
        if (k === 'End') return api.setCursor(n - 1, s);
        if (k === 'Enter' || k === ' ') return repeat || !n ? none : { type: 'select', screen: s, index: cur };
        if (/^[1-9]$/.test(k) && !def.grid) {
          const i = +k - 1;
          if (repeat || i >= n) return none;
          cursors[s] = i;
          return { type: 'select', screen: s, index: i };
        }
      } else if (k === 'Enter' || k === ' ') {
        return repeat ? none : { type: 'select', screen: s, index: 0 };
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        return { type: 'adjust', screen: s, index: 0, dir: k === 'ArrowLeft' ? -1 : 1 };
      }
      return none;
    },
  };
  return api;
}

/** The sound of an effect: one cue per action (null: silence). */
export function cueFor(effect) {
  if (!effect) return null;
  if (effect.type === 'move' || effect.type === 'adjust') return 'ui-tick';
  if (effect.type === 'select') return 'ui-confirm';
  if (effect.type === 'back') return 'ui-back';
  if (effect.type === 'open') return effect.from === 'title' ? 'whoosh' : effect.screen === 'versus' ? null /* the lobby brings its own */ : 'ui-confirm';
  return null;
}

// ---------------------------------------------------------------- small sums
export const relText = (n) => (n == null ? '–' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

// A test swing that fits the shot in front of the player: [carry yd, ball mph, launch deg, spin rpm].
const SWING_TABLE = Object.freeze([
  [8, 22, 26, 3200], [15, 30, 28, 4200], [30, 42, 30, 5600], [55, 59, 30, 7400], [80, 73, 28, 8400],
  [110, 88, 25, 8600], [135, 100, 22, 7600], [150, 106, 20, 6900], [165, 113, 18.5, 6300], [180, 120, 17, 5600],
  [200, 130, 15.5, 4800], [220, 140, 14, 3900], [245, 152, 13, 2800], [275, 165, 12.5, 2500], [300, 176, 12, 2400],
]);
const lerp = (a, b, t) => a + (b - a) * t;

/** The ball data of a full swing that carries about `yd` (clamped to the table). */
export function swingForCarry(yd) {
  const d = Math.max(SWING_TABLE[0][0], Math.min(SWING_TABLE[SWING_TABLE.length - 1][0], +yd || 0));
  let i = 1;
  while (i < SWING_TABLE.length - 1 && SWING_TABLE[i][0] < d) i++;
  const a = SWING_TABLE[i - 1], b = SWING_TABLE[i];
  const t = (d - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return { speed: +lerp(a[1], b[1], t).toFixed(1), vla: +lerp(a[2], b[2], t).toFixed(1), hla: 0, spin: Math.round(lerp(a[3], b[3], t) / 50) * 50, spinAxis: 0 };
}
/** A putt that rolls about `ft` on a medium green. */
export function puttForFeet(ft) {
  const f = Math.max(1, +ft || 1);
  return { speed: +Math.min(22, 1.9 + 1.33 * Math.sqrt(f) + f * 0.02).toFixed(1), vla: 0, hla: 0, spin: 0, spinAxis: 0 };
}

// The test swings offered when no launch monitor is connected (the way to try the game).
export const TEST_SWINGS = Object.freeze([
  { id: 'auto', label: 'SMART SWING', sub: 'FITS THIS SHOT', key: '1' },
  { id: 'drive', label: 'DRIVE', sub: '245 YD', key: '2', ball: { speed: 152, vla: 13, hla: 0, spin: 2800, spinAxis: 0 } },
  { id: 'iron', label: 'IRON', sub: '150 YD', key: '3', ball: { speed: 106, vla: 20, hla: 0, spin: 6900, spinAxis: 0 } },
  { id: 'wedge', label: 'WEDGE', sub: '80 YD', key: '4', ball: { speed: 73, vla: 28, hla: 0, spin: 8400, spinAxis: 0 } },
  { id: 'chip', label: 'CHIP', sub: '15 YD', key: '5', ball: { speed: 30, vla: 28, hla: 0, spin: 4200, spinAxis: 0 } },
  { id: 'putt', label: 'PUTT', sub: 'ROLLS IT', key: '6' },
]);

/**
 * The ball of a test swing for the game as it stands.
 *   state    the game state (lie, distToPinYd)
 *   jitter   a function giving -1..1: a little human error on the smart swing (none in the tests)
 *   plan     the lineup's prediction for the club in hand (GET /api/predict: { launch:
 *            { speedMph, vla, totalSpin }, isPutt }). The smart swing IS that shot: the
 *            club the game picked, the swing it expects, a touch off. Without a plan the
 *            table above stands in.
 */
export function testSwing(id, state = null, jitter = null, plan = null) {
  const s = state || {};
  const toPin = Number.isFinite(+s.distToPinYd) ? +s.distToPinYd : 150;
  const onGreen = s.lie === 'green';
  const j = typeof jitter === 'function' ? jitter : () => 0;
  const pl = plan && plan.launch && Number.isFinite(+plan.launch.speedMph) && +plan.launch.speedMph > 0 ? plan : null;
  if (id === 'putt') return pl && pl.isPutt ? { speed: +(+pl.launch.speedMph).toFixed(1), vla: 0, hla: 0, spin: 0, spinAxis: 0 } : puttForFeet(onGreen ? toPin * 3 * 1.06 : 20);
  if (id === 'auto') {
    if (pl && pl.isPutt) return { speed: +(+pl.launch.speedMph * (1 + 0.03 * j())).toFixed(1), vla: 0, hla: +(0.4 * j()).toFixed(1), spin: 0, spinAxis: 0 };
    if (onGreen && !pl) return puttForFeet(toPin * 3 * 1.08);
    const ball = pl
      ? { speed: +pl.launch.speedMph, vla: +(+pl.launch.vla || 12).toFixed(1), hla: 0, spin: Math.round(+pl.launch.totalSpin || 0), spinAxis: 0 }
      : swingForCarry(toPin * (toPin > 60 ? 0.97 : 0.9));
    ball.speed = +(ball.speed * (1 + 0.02 * j())).toFixed(1);
    ball.hla = +(1.2 * j()).toFixed(1);
    ball.spinAxis = +(2.5 * j()).toFixed(1);
    return ball;
  }
  const preset = TEST_SWINGS.find((t) => t.id === id);
  return preset && preset.ball ? { ...preset.ball } : swingForCarry(toPin);
}

/** "2 UNDER", "LEVEL PAR", "3 OVER". */
export function parWords(toPar) {
  if (toPar == null) return '';
  if (toPar === 0) return 'LEVEL PAR';
  return `${Math.abs(toPar)} ${toPar < 0 ? 'UNDER' : 'OVER'}`;
}

/** The solo header's line for a run (lib/solo.js state()) and the game's strokes on the hole. */
export function soloHeaderView(run, game = null) {
  if (!run) return null;
  const s = run.stages[run.index] || run.stages[0];
  const kind = run.kind === 'tour' ? 'SOLO TOUR' : run.kind === 'stage' ? 'SOLO STAGE' : 'FREE PLAY';
  const strokes = game && Number.isFinite(+game.strokes) ? +game.strokes : s.shots || 0;
  return {
    kind,
    step: run.kind === 'tour' ? `STAGE ${run.index + 1} OF ${run.stages.length}` : (s.arena ? 'ARENA' : 'STAGE'),
    stage: String(s.name || '').toUpperCase(),
    par: s.par,
    strokes,
    shot: run.phase === 'play' ? strokes + 1 : strokes,
    total: run.kind === 'tour' ? relText(run.totals.played ? run.totals.toPar : 0) : null,
    player: String((run.player && run.player.name) || 'PLAYER 1').toUpperCase(),
  };
}

// ---------------------------------------------------------------- the menus' backdrop camera
// While the menus are up the stage that is in the bay is their backdrop: a camera high behind
// the hole on the tee's side, swinging slowly across the line of play. Props are scenery,
// nothing collides with them, and the camera used to fly straight through the ones that
// stand where it swings (the skyscrapers beside Midnight Mile, Ice Pick's spires, Thunder
// Dome's floodlights). So the orbit is PLANNED per stage: the usual one when its whole swing
// is clear of every prop, else the first clear one of a short list of gentler orbits (a
// narrower swing, then closer in, then higher).
export const BACKDROP = Object.freeze({
  along: 0.62,                    // the pivot: this far from the ball to the pin
  distMin: 95, distMax: 330,      // the camera's distance from the pivot: len * 0.78 + 42, kept in this range
  pitchDeg: -21, pitchSwingDeg: 2.5,
  swingDeg: 34,                   // the yaw either side of the line of play
  groundClearM: 14,               // the camera never comes nearer the ground it flies over than this
  propClearM: 8,                  // nor nearer a prop, sideways or up and down
});
const B_RAD = Math.PI / 180;

/** Where the backdrop camera is for an orbit, a yaw offset from the line of play and a pitch (degrees). */
export function backdropCamera({ ball, pin, dist, yawOffDeg = 0, pitchDeg = BACKDROP.pitchDeg }) {
  const line = Math.atan2(pin.x - ball.x, pin.y - ball.y);
  const tx = ball.x + (pin.x - ball.x) * BACKDROP.along, ty = ball.y + (pin.y - ball.y) * BACKDROP.along;
  const yaw = line + yawOffDeg * B_RAD, pitch = pitchDeg * B_RAD;
  return { tx, ty, x: tx - Math.sin(yaw) * Math.cos(pitch) * dist, y: ty - Math.cos(yaw) * Math.cos(pitch) * dist, up: -Math.sin(pitch) * dist };
}

/**
 * The orbit to fly over a stage.
 *   ball, pin    { x, y } on the course
 *   groundAt     (x, y) -> the ground's height there
 *   obstacles    [{ x, y, r, base, top }]: every prop as an upright cylinder (PropsLayer.obstacles())
 * -> { dist, swingDeg, lift, clear }: the camera's distance from the pivot, the yaw either side
 *    of the line, metres to lift the whole rig by, and whether the whole swing is clear of
 *    every obstacle by BACKDROP.propClearM (false: nothing on the list was; the least bad is given).
 */
export function backdropOrbit({ ball, pin, groundAt = () => 0, obstacles = [] } = {}) {
  const len = Math.hypot(pin.x - ball.x, pin.y - ball.y);
  const dist0 = Math.max(BACKDROP.distMin, Math.min(BACKDROP.distMax, len * 0.78 + 42));
  const usual = { dist: dist0, swingDeg: BACKDROP.swingDeg, lift: 0, clear: true };
  const obs = (Array.isArray(obstacles) ? obstacles : []).filter((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y) && o.r > 0 && Number.isFinite(o.top));
  if (!obs.length || !(len > 0)) return usual;
  const m = BACKDROP.propClearM;
  const pitches = [BACKDROP.pitchDeg - BACKDROP.pitchSwingDeg, BACKDROP.pitchDeg, BACKDROP.pitchDeg + BACKDROP.pitchSwingDeg];
  // how many sampled camera positions of an orbit are inside (or within the margin of) a prop
  const blocked = (dist, swingDeg, lift) => {
    let n = 0;
    for (let a = -swingDeg; a <= swingDeg + 1e-9; a += 2) {
      for (const pitchDeg of pitches) {
        const c = backdropCamera({ ball, pin, dist, yawOffDeg: a, pitchDeg });
        const base = groundAt(c.tx, c.ty) + 2;
        // the rig is lifted clear of the ground under the camera as it flies (shell.js): count that in
        const z = base + c.up + Math.max(lift, groundAt(c.x, c.y) + BACKDROP.groundClearM - (base + c.up), 0);
        for (const o of obs) {
          if (z > o.top + m || z < (Number.isFinite(o.base) ? o.base : -Infinity) - m) continue;
          if (Math.hypot(c.x - o.x, c.y - o.y) < o.r + m) { n++; break; }
        }
      }
      if (swingDeg === 0) break;
    }
    return n;
  };
  let best = null;
  for (const lift of [0, 12, 25, 40]) {
    for (const k of [1, 0.82, 0.66, 0.52]) {
      for (const swingDeg of [BACKDROP.swingDeg, 24, 14, 6]) {
        const dist = Math.max(60, dist0 * k);
        const n = blocked(dist, swingDeg, lift);
        if (n === 0) return { dist, swingDeg, lift, clear: true };
        if (!best || n < best.n) best = { dist, swingDeg, lift, n };
      }
    }
  }
  return { dist: best.dist, swingDeg: best.swingDeg, lift: best.lift, clear: false };
}

/** Escape for innerHTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
