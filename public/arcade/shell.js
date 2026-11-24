// v2:shell The game's front end (docs/sim-clash-shell.md).
//
// In the game product the page opens on a TITLE SCREEN over the live 3D stage, then a MAIN
// MENU where a game type is picked: VERSUS (the match lobby), SOLO (the tour for a score),
// PRACTICE (free play and mini games), PLAYERS, SETTINGS, HOW TO PLAY, QUIT. While a game is
// on, this file draws the solo / practice header, the pause menu, the result cards and the
// TEST SWING control, and its stylesheet (shell.css) hides the simulator's chrome.
//
// The logic with no DOM in it (the menu's state machine, the lists) is shell-core.js. The
// server's side: the product switch and the swing gate (lib/product-mode.js), solo play
// (lib/solo.js). In the simulator product (BIRDIE_PRODUCT=open-birdie, or ?sim=1)
// initShell() does nothing at all.
//
// Sound: guarded calls only, one cue per action, nothing looping.

import { PRODUCT } from './product.js';
import { themeOf, silhouette, rankText } from './match.js';
import {
  createShellMachine, pageProduct, startScreen, mainItems, soloItems, PRACTICE_GAMES, practiceGame, cueFor,
  relText, parWords, TEST_SWINGS, testSwing, soloHeaderView, esc, BACKDROP, backdropOrbit,
} from './shell-core.js';

const LS = {
  data: 'sim-clash.hud.data', volume: 'sim-clash.audio.volume', announcer: 'sim-clash.audio.announcer',
  soloPlayer: 'sim-clash.solo.player', swing: 'sim-clash.hud.swing', connectDone: 'sim-clash.connect.done',
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const defaultFetchJson = (url, init) => fetch(url, init).then((r) => r.json()).catch(() => null);
const hex = (n) => `#${(Number(n) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

// The shell's key handler is registered when this module loads, which is before app.js
// builds anything: on window, in the capture phase, it is the first listener a key meets,
// so the menus own the keyboard while they are up (a number key picks a menu item and does
// not also arm a ball).
let activeShell = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e) => { if (activeShell) activeShell._key(e); }, true);
}

const HOWTO_PAGES = 5;   // v3:modes (was four: a page for the party games, Bullseye and the duel)
const KEYS_HELP = [
  ['← →', 'AIM (SHIFT: BIGGER STEPS)'], ['A', 'AUTO AIM'], ['B', 'THE BALL TRAY'], ['1 … 9', 'ARM A POWER-UP BALL'],
  ['V', 'VIEW FROM ABOVE'], ['F', 'FLY OVER THE HOLE'], ['T', 'TEST SWING (NO MONITOR NEEDED)'], ['D', 'SHOT DATA PANELS'],
  ['S', 'SOUND ON / OFF'], ['ESC', 'MENU · BACK'], ['F11', 'FULL SCREEN'],
  ['X', 'PARTY: WHO YOUR TRICK IS FOR'], ['P', 'PLAY THE REPLAY ON OFFER'],   // v3:modes
];

/**
 * Start the front end if this page is the game. Returns the shell, or null in the simulator.
 *   query        URLSearchParams of the page
 *   scene        the GolfScene (the backdrop camera, the lineup overlay)
 *   matchUI      the MatchUI (the VERSUS lobby and the match screens)
 *   arcade       the ArcadeUI or null
 *   audio        the ArcadeAudio or null (?sound=0)
 *   events       the page's EventSource
 *   toast        (main, sub) => void
 *   getState     () => the last game state
 *   isAnimating  () => a ball is in the air
 *   sound        { get(): boolean, toggle() } the page's sound switch (key S)
 *   openSliders  () => open the simulator's practice-shot sliders
 */
export function initShell(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const mode = pageProduct({ query: opts.query, product: typeof globalThis !== 'undefined' ? globalThis.__PRODUCT__ : null });
  if (doc) {
    doc.documentElement.setAttribute('data-product', mode);
    if (mode === 'simclash') doc.title = PRODUCT.name;
    else if (typeof globalThis !== 'undefined' && globalThis.__PRODUCT__) doc.title = 'Open-Birdie';   // the simulator keeps its own name
  }
  if (mode !== 'simclash' || !doc) return null;
  const shell = new Shell({ ...opts, doc });
  activeShell = shell;
  return shell;
}

export class Shell {
  constructor({ doc, query = null, scene = null, matchUI = null, arcade = null, audio = null, events = null, toast = () => {},
    getState = () => null, isAnimating = () => false, fetchJson = defaultFetchJson, sound = null, openSliders = null, getPlan = null } = {}) {
    Object.assign(this, { doc, query, scene, matchUI, arcade, audio, events, toast, getState, isAnimating, fetchJson, sound, openSliders, getPlan });
    this.canQuit = !!(query && query.get && query.get('primaryNonce')) || /Electron/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    this.players = [];
    this.profiles = {};
    this.stages = [];
    this.arenas = [];
    this.bests = { tours: {}, stages: {} };
    this.run = null;            // the solo run as the server has it
    this.mode = null;           // 'versus' | 'solo' | 'practice' while a game is on
    this.lm = { connected: false };
    this.cid = null;
    this.snap = null;           // the arcade snapshot (assists, the ball catalogue)
    this.ui = { practiceGame: 'free', howto: 0, playerOpen: null, removeAsk: null, exitAsk: false, busy: false, note: '', cardKey: null, swingOpen: false, loading: false };
    this.swingHold = false;     // setSwingHold(): swings are dropped whatever screen is up (the connection wizard's test ball)
    this.connect = { module: undefined, wizard: null, due: false };   // the launch-monitor wizard (public/arcade/connect.js), when the build has it
    this.soloPlayer = lsGet(LS.soloPlayer) || null;
    this.announcer = lsGet(LS.announcer) !== '0';
    this.volume = Number.isFinite(parseFloat(lsGet(LS.volume))) ? Math.max(0, Math.min(1, parseFloat(lsGet(LS.volume)))) : 0.8;
    this.m = createShellMachine({ start: startScreen(query), count: (s) => this._items(s).length, columns: (s) => this._cols(s) });
    if (this.m.screen === 'game') this.mode = 'practice';

    this._build();
    this._wireAudio();
    this._wireScene();
    this._wireEvents();
    if (matchUI) matchUI.shell = true;   // the match menu says EXIT TO MAIN MENU (match.js menuItems)
    this.modes = {};            // v3:modes the mode modules that are in the build: { bullseye, duel, highlights } -> their UI
    this.party = !!(matchUI && typeof matchUI.openPartyLobby === 'function');   // v3:modes PARTY: the match UI's own lobby for 2 to 4
    this._watchMatch();
    this._load();
    this._apply();
    this._boot();
    if (typeof window !== 'undefined') window.__simclash = { shell: this, setSwingHold: (on) => this.setSwingHold(on) };
    this._frameFn = (t) => this._frame(t);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(this._frameFn);
  }

  // ------------------------------------------------------------ building
  _build() {
    const d = this.doc;
    d.documentElement.style.setProperty('--sc-p1', PRODUCT.colors.p1);
    d.documentElement.style.setProperty('--sc-p2', PRODUCT.colors.p2);
    d.documentElement.style.setProperty('--sc-gold', PRODUCT.colors.gold);
    if (lsGet(LS.data) === '1') d.documentElement.classList.add('sc-data');
    this.root = d.createElement('div');
    this.root.className = 'sc-root';
    this.root.innerHTML = '<div class="sc-shade" aria-hidden="true"></div><div class="sc-layer"></div><div class="sc-lm" aria-live="polite"></div><div class="sc-overlay"></div>';
    d.body.appendChild(this.root);
    this.layer = this.root.querySelector('.sc-layer');
    this.lmEl = this.root.querySelector('.sc-lm');
    this.overlay = this.root.querySelector('.sc-overlay');
    this.root.addEventListener('click', (e) => this._click(e));
    this.root.addEventListener('pointerover', (e) => this._hover(e));
    this.root.addEventListener('submit', (e) => this._submit(e));

    // in play: the header takes the simulator's round card's place in the top bar, the test
    // swing its practice-shot button's in the bottom bar (both inside #hud, so they scale with it)
    this.hdr = d.createElement('div');
    this.hdr.className = 'sc-hdr';
    this.hdr.addEventListener('click', (e) => this._click(e));
    const topbar = d.getElementById('topbar');
    if (topbar) topbar.prepend(this.hdr);
    this.swingBar = d.createElement('div');
    this.swingBar.className = 'sc-swing';
    this.swingBar.addEventListener('click', (e) => this._click(e));
    const right = d.querySelector('#bottombar .bb-right');
    if (right) right.prepend(this.swingBar);
    const end = d.getElementById('pb-end');
    if (end) end.textContent = 'Back to free play';
    const lmText = d.getElementById('lm-text');
    if (lmText) lmText.textContent = 'Monitor waiting';
  }

  _wireAudio() {
    const a = this.audio;
    if (!a) return;
    try { a.setVolume?.(this.volume); } catch (_) { /* silent */ }
    // the announcer switch: every voice line goes through say() (audio.js), so one guard is all of it
    if (typeof a.say === 'function' && !a.__scSay) {
      a.__scSay = a.say.bind(a);
      a.say = (line, options) => (this.announcer ? a.__scSay(line, options) : false);
    }
  }

  _wireScene() {
    const sc = this.scene;
    if (!sc || typeof sc.setLineup !== 'function' || sc.__scLineup) return;
    // no aim line or landing band on the stage while it is the menus' backdrop
    sc.__scLineup = sc.setLineup.bind(sc);
    sc.setLineup = (pred) => sc.__scLineup(this.m.inMenu && this.m.screen !== 'versus' ? null : pred);
  }

  _wireEvents() {
    const es = this.events;
    if (!es || typeof es.addEventListener !== 'function') return;
    const on = (name, fn) => es.addEventListener(name, (e) => { let d = null; try { d = JSON.parse(e.data); } catch (_) { return; } fn(d); });
    on('hello', (d) => { this.cid = d && d.cid ? d.cid : null; this._gateSent = null; this._sendGate(); });
    on('lm', (d) => { this.lm = d || { connected: false }; this._renderLm(); this._renderSwing(); });
    on('solo', (d) => this._onSolo(d));
    on('shell-swing', () => this._onSwing());
    on('leagues', (d) => { if (d && Array.isArray(d.players)) { this.players = d.players; this._refreshProfiles(); this._render(); } });
    on('arcade-state', (d) => { this.snap = d; if (this.m.screen === 'settings') this._render(); });
    on('state', () => { this._renderHdr(); this._renderSwing(); setTimeout(() => this._fitData(), 0); });
    on('shot', () => { this._shotAt = Date.now(); this._renderHdr(); setTimeout(() => this._fitData(), 0); });
  }

  async _load() {
    const [lg, mm, so, ar] = await Promise.all([
      this.fetchJson('/api/leagues'), this.fetchJson('/api/match'), this.fetchJson('/api/solo'), this.fetchJson('/api/arcade'),
    ]);
    if (lg && Array.isArray(lg.players)) this.players = lg.players;
    if (mm && mm.profiles) this.profiles = mm.profiles;
    if (so) {
      this.stages = Array.isArray(so.stages) ? so.stages : [];
      this.arenas = Array.isArray(so.arenas) ? so.arenas : [];
      if (so.bests) this.bests = so.bests;
      if (so.run && !this.run) this._onSolo(so.run);
    }
    if (ar) this.snap = ar;
    this._loaded = true;
    await this._loadModes();   // v3:modes
    await this._loadConnect();
    this._render();
    if (this.m.screen === 'connect' && !this.connect.module) { this.m.back(); this._apply(); }   // ?connect=1 in a build without the wizard
  }
  /**
   * The launch-monitor wizard (the connect stream's public/arcade/connect.js; its API and the
   * first-run rule: docs/launch-monitors.md). Absent from the build: no wizard, the LAUNCH
   * MONITOR help screen stands in. Due on the way out of the title when no monitor has
   * been chosen yet (GET /api/connect/status) and none is connected.
   */
  async _loadConnect() {
    if (this.connect.module !== undefined) return;
    try {
      const mod = await import('./connect.js');
      this.connect.module = mod && (mod.ConnectWizard || (mod.default && mod.default.ConnectWizard) || mod.default) ? mod : null;
    } catch (_) { this.connect.module = null; }
    if (!this.connect.module) return;
    if (!this.doc.querySelector('link[data-sc-connect]')) {
      const link = this.doc.createElement('link');
      link.rel = 'stylesheet'; link.href = 'arcade/connect.css'; link.setAttribute('data-sc-connect', '');
      this.doc.head.appendChild(link);
    }
    const st = await this.fetchJson('/api/connect/status');
    const chosen = st && (st.chosen === true || st.configured === true || st.firstRun === false || !!(st.device || st.monitor || st.selected || st.deviceId || st.monitorId));
    this.connect.due = !!st && st.ok !== false && !chosen && !(st.connected === true) && lsGet(LS.connectDone) !== '1';
  }
  /**
   * v3:modes The newer modes (docs/modes.md). Each is a module of its own beside this file,
   * public/arcade/<id>.js, exporting
   *
   *     mount(ctx) -> ui
   *
   * ctx: { id, shell, doc, hud, scene, audio, events, fetchJson, toast, getState, isAnimating,
   *        players() (the roster), profiles(), stages(), arenas(), sync() }
   * ui:  { root        the element it draws in (it appends it to ctx.hud itself)
   *        lobbyOpen   true while its lobby / menu screen is up (a menu: swings are held)
   *        live        true while a game of this mode is on (play itself: swings count)
   *        openLobby() the main menu picked it        closeLobby() ESC took it down
   *        key(e)      (optional) a key while its screen or its game is up: true when it took it }
   * It draws its own screens and reads its own keys, as the match UI does; the shell only
   * follows it: lobbyOpen -> the screen '<id>', live -> play (mode '<id>'), neither -> the
   * main menu. It calls ctx.sync() whenever lobbyOpen / live change. A module that is not in
   * the build (404) simply has no entry in the main menu.
   */
  async _loadModes() {
    if (this._modesLoaded) return;
    this._modesLoaded = true;
    const hud = this.doc.getElementById('hud') || this.doc.body;
    for (const id of ['bullseye', 'duel', 'highlights']) {
      try {
        const mod = await import(`./${id}.js`);
        const mount = mod && (mod.mount || (mod.default && mod.default.mount));
        if (typeof mount !== 'function') continue;
        const ui = mount({
          id, shell: this, doc: this.doc, hud, scene: this.scene, audio: this.audio, events: this.events, fetchJson: this.fetchJson, toast: this.toast,
          getState: this.getState, isAnimating: this.isAnimating,
          players: () => this.players, profiles: () => this.profiles, stages: () => this.stages, arenas: () => this.arenas,
          sync: () => this._syncMode(id),
        });
        if (!ui) continue;
        this.modes[id] = ui;
        this._syncMode(id);
      } catch (e) {
        if (!/Failed to fetch|404|Cannot find module|error loading dynamically imported module/i.test(String(e && e.message))) console.warn(`[shell] the ${id} mode would not start`, e);
      }
    }
  }
  /** Follow a mode's UI: its lobby is the screen '<id>', a live game is play, neither is the main menu. */
  _syncMode(id) {
    const ui = this.modes[id];
    if (!ui) return;
    clearTimeout(this._modeLeave);
    if (ui.live && !ui.lobbyOpen) {
      if (this.m.stack[0] !== 'game' || this.mode !== id) { this.mode = id; this.m.go('game'); this._hideCard(); this._apply(); }
    } else if (ui.lobbyOpen) {
      if (this.m.screen !== id) { this.mode = null; this.m.go(id); this._apply(); }
    } else if (this.mode === id || this.m.screen === id) {
      // neither: back to the main menu, unless a lobby or a game shows up in a moment (PLAY AGAIN)
      this._modeLeave = setTimeout(() => {
        if (ui.live || ui.lobbyOpen) return;
        if (this.mode === id || this.m.screen === id) { this.mode = null; this.m.go('main'); this._apply(); }
      }, 350);
    }
  }
  async _refreshProfiles() {
    const mm = await this.fetchJson('/api/match');
    if (mm && mm.profiles) { this.profiles = mm.profiles; if (this.m.screen === 'players') this._render(); }
  }
  async _refreshBests() {
    const so = await this.fetchJson('/api/solo');
    if (so && so.bests) { this.bests = so.bests; this._render(); }
  }

  // ------------------------------------------------------------ sound
  _cue(name, opts) { if (!name) return; try { this.audio?.cue?.(name, opts); } catch (_) { /* silent */ } }
  _fx(effect) { this._cue(cueFor(effect)); return effect; }

  // ------------------------------------------------------------ the gate, the classes
  /** Tell the server which kind of screen this page is on (the swing gate). */
  _sendGate() {
    if (!this.cid) return;
    const screen = this.m.inMenu || this.swingHold ? 'menu' : 'game';
    const key = `${this.cid}:${screen}`;
    if (this._gateSent === key) return;
    this._gateSent = key;
    this.fetchJson('/api/shell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: this.cid, screen }) });
  }

  /**
   * Hold every swing, whatever screen is up (true), or let the screen decide again (false).
   * While swings are held the server plays none of them and broadcasts 'shell-swing'
   * { speedMph } on the event stream instead: that is how a "hit a ball to check the
   * connection" screen sees its ball without it counting in any game. Also reachable as
   * window.__simclash.setSwingHold(on). The menus hold swings by themselves.
   */
  setSwingHold(on) {
    this.swingHold = !!on;
    this._sendGate();
  }

  /**
   * The first thing on screen is the boot cover (index.html draws it before any module has
   * loaded: the wordmark on black, where the title's will be). It lifts once the stage is
   * in and has had a moment to draw, so the title appears complete, never half built.
   */
  _boot() {
    const cover = this.doc.getElementById('sc-boot');
    const t0 = Date.now();
    const lift = () => {
      this.doc.documentElement.classList.add('sc-ready');
      if (cover) { cover.classList.add('sc-boot-out'); setTimeout(() => cover.remove(), 700); }
    };
    const tick = () => {
      const sc = this.scene;
      const ready = sc && sc.geo && (this.m.stack[0] === 'game' || sc.camMode === 'free' || this.m.screen === 'versus');
      if (ready) { this._bootSeen = this._bootSeen || Date.now(); if (Date.now() - this._bootSeen > 500) { lift(); return; } }
      if (Date.now() - t0 > 12000 || (this._loaded && !this.stages.length && Date.now() - t0 > 2500)) { lift(); return; }   // no stage to wait for
      setTimeout(tick, 100);
    };
    tick();
  }

  /** After every change of screen: classes on <html>, the gate, a redraw. */
  _apply() {
    const h = this.doc.documentElement;
    const s = this.m.screen;
    const inGame = this.m.stack[0] === 'game';
    h.classList.toggle('sc-menu', !inGame);
    h.classList.toggle('sc-game', inGame);
    h.classList.toggle('sc-lobby', s === 'versus');
    for (const k of ['versus', 'solo', 'practice', 'bullseye', 'duel', 'highlights' /* v3:modes */]) h.classList.toggle(`sc-mode-${k}`, inGame && this.mode === k);
    h.classList.toggle('sc-modescreen', !!this.modes[s]);   // v3:modes a mode's own lobby is up (shell.css: its root shows, the shade steps aside)
    this.root.dataset.screen = s;
    if (!inGame && this.scene && this.scene.__scLineup) { try { this.scene.__scLineup(null); } catch (_) { /* no course yet */ } }
    this._sendGate();
    this._render();
  }

  // ------------------------------------------------------------ the backdrop camera
  // While the menus are up the stage drifts in a slow orbit round the green: the scene's
  // free camera (a ground pivot orbited at a yaw, a pitch and a distance), steered from here.
  _frame(t) {
    requestAnimationFrame(this._frameFn);
    const sc = this.scene;
    const dt = Math.min(0.05, Math.max(0, (t - (this._lastT || t)) / 1000));
    this._lastT = t;
    if (!sc || !sc.geo || !sc.free || !sc.pinSim || !sc.ballSim) return;
    const want = this.m.stack[0] !== 'game';
    sc.backdrop = want;   // v3:environment the stage behind the menus: the scene softens its focus on it (scene.js _lensStep)
    if (!want) {
      if (this._orbiting) { this._orbiting = false; if (sc.camMode === 'free') sc.enterFreeCam(false); }
      return;
    }
    if (sc.anim || sc.camMode === 'static' || sc.camMode === 'flyover') return;
    const pin = sc.pinSim, ball = sc.ballSim;
    if (sc.camMode !== 'free') {
      if (!sc.enterFreeCam(true)) return;
      const key = `${sc.geo.name}|${pin.x.toFixed(0)},${pin.y.toFixed(0)}`;
      if (this._orbitKey !== key) { this._orbitKey = key; this._orbitT = 0; this._lift = 0; }   // a new stage: the drift starts over
    }
    this._orbiting = true;
    this._orbitT = (this._orbitT || 0) + dt;
    // A stage is built to be looked at from its tee, so the camera stays on the tee's side:
    // high behind the hole, swinging slowly from one side of the line of play to the other
    // (a full orbit would fly through the cliffs and sea stacks that frame the green).
    // v2:final ... and never through a prop: the orbit is planned for the stage against every
    // model that stands on it (shell-core.js backdropOrbit: the usual swing where that is
    // clear, else a narrower, closer or higher one). Planned again when the stage or its
    // models change (they load a moment after the ground); eased, so the camera never jumps.
    const obst = (sc.props && typeof sc.props.obstacles === 'function' ? sc.props.obstacles() : []).concat(sc.worldEvents && typeof sc.worldEvents.obstacles === 'function' ? sc.worldEvents.obstacles() : []);   // v3:living and the ways the living world's flyers travel
    if (sc.gadgets && typeof sc.gadgets.obstacles === 'function') for (const o of sc.gadgets.obstacles()) obst.push(o);   // v3:gadgets the orbit keeps clear of a wall or a cannon like a prop
    const planKey = `${sc.geo.name}|${pin.x.toFixed(0)},${pin.y.toFixed(0)}|${ball.x.toFixed(0)},${ball.y.toFixed(0)}|${(sc.props && sc.props.version) || 0}|${obst.length}`;
    if (this._orbitPlanKey !== planKey) {
      this._orbitPlanKey = planKey;
      this._orbitPlan = backdropOrbit({ ball, pin, groundAt: (x, y) => sc.hAt(x, y), obstacles: obst });
      if (!this._orbitNow || this._orbitT < 0.2) this._orbitNow = { dist: this._orbitPlan.dist, swingDeg: this._orbitPlan.swingDeg, lift: this._orbitPlan.lift };
    }
    const plan = this._orbitPlan, now = this._orbitNow, ease = Math.min(1, dt * 0.9);
    now.dist += (plan.dist - now.dist) * ease; now.swingDeg += (plan.swingDeg - now.swingDeg) * ease; now.lift += (plan.lift - now.lift) * ease;
    const line = Math.atan2(pin.x - ball.x, pin.y - ball.y) * 180 / Math.PI;
    const f = sc.free;
    f.tx = ball.x + (pin.x - ball.x) * BACKDROP.along; f.ty = ball.y + (pin.y - ball.y) * BACKDROP.along;
    f.yaw = line + now.swingDeg * Math.sin(this._orbitT / 21 + 0.6);
    f.pitch = BACKDROP.pitchDeg + BACKDROP.pitchSwingDeg * Math.sin(this._orbitT / 13);
    f.dist = now.dist;
    // never under the ground it flies over: where the camera will be, the land is looked up and the whole rig lifted clear
    const yaw = f.yaw * Math.PI / 180, pitch = f.pitch * Math.PI / 180;
    const cx = f.tx - Math.sin(yaw) * Math.cos(pitch) * f.dist, cy = f.ty - Math.cos(yaw) * Math.cos(pitch) * f.dist;
    const base = sc.hAt(f.tx, f.ty) + 2;
    const need = Math.max(now.lift, sc.hAt(cx, cy) + BACKDROP.groundClearM - (base - Math.sin(pitch) * f.dist), 0);
    this._lift = (this._lift || 0) + (need - (this._lift || 0)) * Math.min(1, dt * 1.5);
    f.hOff = this._lift;
  }

  // ------------------------------------------------------------ the lists the cursor walks
  _stageList(screen) {
    if (screen === 'practice-stage') {
      const g = practiceGame(this.ui.practiceGame);
      return [...this.stages, ...this.arenas].filter((s) => g.fits(s));
    }
    return [...this.stages, ...this.arenas];
  }
  _cols(screen) { return screen === 'solo-stage' || screen === 'practice-stage' ? 5 : 1; }
  _soloPlayer() {
    return this.players.find((p) => p.id === this.soloPlayer) || this.players[0] || null;
  }
  _pauseItems() {
    const r = this.run;
    const out = [{ id: 'resume', label: 'RESUME', sub: 'BACK TO THE GAME' }];
    if (r && r.kind === 'tour') out.push({ id: 'restart-tour', label: 'RESTART TOUR', sub: 'FROM THE FIRST STAGE · THE SCORE IS WIPED', ask: true });
    if (r && r.canRestartStage) out.push({ id: 'restart-stage', label: 'RESTART STAGE', sub: 'BACK ON THE TEE' });
    if (!r) out.push({ id: 'reset', label: 'RESTART STAGE', sub: 'BACK ON THE TEE' });
    if (r && r.canGiveUp) out.push({ id: 'give-up', label: 'GIVE UP THIS STAGE', sub: `PICK UP · IT COSTS AT LEAST ${relText((r.stages[r.index].par + 4) - r.stages[r.index].par)}`, ask: true });
    out.push({ id: 'settings', label: 'SETTINGS', sub: 'SOUND · CAMERA · ASSISTS' });
    out.push({ id: 'exit', label: 'EXIT TO MAIN MENU', sub: r && r.kind !== 'free' ? 'THE RUN IS ABANDONED' : 'LEAVE THE STAGE', ask: !!(r && r.kind !== 'free') });
    return out;
  }
  _resultItems() {
    const r = this.run;
    if (!r) return [];
    if (r.phase === 'stage-result' && r.kind === 'tour') return [{ id: 'next', label: 'NEXT STAGE' }, { id: 'exit', label: 'QUIT TOUR' }];
    if (r.phase === 'stage-result') return [{ id: 'next', label: 'PLAY AGAIN' }, { id: 'pick', label: 'ANOTHER STAGE' }, { id: 'exit', label: 'MAIN MENU' }];
    if (r.kind === 'tour') return [{ id: 'again', label: 'PLAY AGAIN' }, { id: 'exit', label: 'MAIN MENU' }];
    return [{ id: 'again', label: 'PLAY AGAIN' }, { id: 'pick', label: 'ANOTHER STAGE' }, { id: 'exit', label: 'MAIN MENU' }];
  }
  _settingsRows() {
    const seg = (id) => {
      const el = this.doc.getElementById(id);
      const btns = el ? [...el.querySelectorAll('button')] : [];
      const on = btns.find((b) => b.getAttribute('aria-checked') === 'true');
      return { btns, value: on ? on.dataset.value : null };
    };
    const a = (this.snap && this.snap.assist) || {};
    const soundOn = this.sound ? !!this.sound.get() : false;
    const cam = seg('seg-shotcam'), gfx = seg('seg-gfx');
    const life = seg('seg-life'), clock = seg('seg-worldclock');   // v3:living
    const near = (list, v) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
    return [
      { id: 'sound', label: 'SOUND', value: this.audio ? (soundOn ? 'on' : 'off') : 'none', options: this.audio ? [['on', 'ON'], ['off', 'OFF']] : [['none', 'OFF FOR THIS WINDOW']],
        set: (v) => { if (this.sound && (v === 'on') !== soundOn) this.sound.toggle(); } },
      { id: 'volume', label: 'VOLUME', value: String(Math.round(this.volume * 10)), options: Array.from({ length: 11 }, (_, i) => [String(i), `${i * 10}%`]),
        set: (v) => { this.volume = +v / 10; lsSet(LS.volume, String(this.volume)); try { this.audio?.setVolume?.(this.volume); } catch (_) { /* silent */ } } },
      { id: 'announcer', label: 'ANNOUNCER', value: this.announcer ? 'on' : 'off', options: [['on', 'ON'], ['off', 'OFF']],
        set: (v) => { this.announcer = v === 'on'; lsSet(LS.announcer, this.announcer ? '1' : '0'); if (!this.announcer) { try { this.audio?.stopVoice?.(); } catch (_) { /* silent */ } } } },
      { id: 'camera', label: 'SHOT CAMERA', value: cam.value, options: [['ball', 'BALL CAM'], ['follow', 'FOLLOW'], ['tv', 'TV']],
        set: (v) => cam.btns.find((b) => b.dataset.value === v)?.click() },
      { id: 'putting', label: 'PUTTING', value: a.putting || 'easy', options: [['easy', 'EASY'], ['assist', 'ASSISTED'], ['off', 'REAL']], hint: 'EASY: THE GAME READS THE PUTT FOR YOU',
        set: (v) => this._setAssist({ putting: v }) },
      { id: 'dispersion', label: 'STRAIGHTER SHOTS', value: String(near([0, 0.3, 0.6, 1], Number.isFinite(+a.dispersion) ? +a.dispersion : 0.6)), options: [['0', 'OFF'], ['0.3', 'A LITTLE'], ['0.6', 'NORMAL'], ['1', 'FULL']], hint: 'HOW MUCH A MISS IS PULLED BACK TO THE LINE',
        set: (v) => this._setAssist({ dispersion: +v }) },
      { id: 'tapin', label: 'TAP-INS GIVEN', value: String(near([0, 3, 5, 8], Number.isFinite(+a.tapInFt) ? +a.tapInFt : 8)), options: [['0', 'OFF'], ['3', '3 FT'], ['5', '5 FT'], ['8', '8 FT']], hint: 'A BALL THIS CLOSE IS HOLED FOR YOU',
        set: (v) => this._setAssist({ tapInFt: +v }) },
      { id: 'graphics', label: 'GRAPHICS', value: gfx.value, options: [['auto', 'AUTO'], ['ultra', 'ULTRA'], ['high', 'HIGH'], ['low', 'LOW']],
        set: (v) => gfx.btns.find((b) => b.dataset.value === v)?.click() },
      // v3:living how much moves through a stage and answers the game; the day moving on through a match (docs/living-world.md)
      ...(life.btns.length ? [{ id: 'life', label: 'WORLD LIFE', value: life.value, options: [['full', 'FULL'], ['calm', 'CALM'], ['off', 'OFF']], hint: 'BOATS, BIRDS, WEATHER, AND THE WORLD ANSWERING A SHOT',
        set: (v) => life.btns.find((b) => b.dataset.value === v)?.click() }] : []),
      ...(clock.btns.length ? [{ id: 'worldclock', label: 'WORLD CLOCK', value: clock.value, options: [['off', 'OFF'], ['on', 'ON']], hint: 'IN A LONG MATCH EVERY HOLE IS PLAYED A LITTLE LATER IN THE DAY',
        set: (v) => clock.btns.find((b) => b.dataset.value === v)?.click() }] : []),
      { id: 'monitor', label: 'LAUNCH MONITOR', link: 'monitor', value: this.lm.connected ? 'CONNECTED' : 'WAITING' },
      { id: 'credits', label: 'CREDITS', link: 'credits', value: '' },
    ];
  }
  async _setAssist(patch) {
    const out = await this.fetchJson('/api/arcade/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assist: patch }) });
    if (out && out.assist) { this.snap = { ...(this.snap || {}), assist: out.assist }; this._render(); }
  }

  _items(screen = this.m.screen) {
    switch (screen) {
      case 'main': return mainItems({ canQuit: this.canQuit, modes: [...Object.keys(this.modes || {}), ...(this.party ? ['party'] : [])] });   // v3:modes
      case 'solo': return [{ id: 'player' }, ...soloItems({ stages: this.stages.length, bests: this.bests, playerId: this._soloPlayer()?.id || null })];
      case 'solo-stage': case 'practice-stage': return this._stageList(screen);
      case 'practice': return PRACTICE_GAMES.map((g) => ({ ...g, disabled: ![...this.stages, ...this.arenas].some((s) => g.fits(s)) }));
      case 'players': return [...this.players.map((p) => ({ id: p.id })), { id: 'add' }];
      case 'settings': return this._settingsRows();
      case 'pause': return this._pauseItems();
      case 'result': return this._resultItems();
      default: return [];
    }
  }

  // ------------------------------------------------------------ input
  _key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = String(e.key || '');
    const s = this.m.screen;
    const typing = e.target && e.target.closest && e.target.closest('input, textarea, select');
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (s === 'versus') return;   // the match lobby has its own keys
    if (s === 'connect') return;  // and so has the connection wizard
    if (this.modes[s]) return;    // v3:modes and a mode's lobby (its module listens itself)
    if (s === 'game') {
      if (typing) return;
      const lower = k.toLowerCase();
      // keys of the simulator that open simulator things: not in this game
      if (lower === 'w' || lower === 'l' || lower === 'c') { e.stopImmediatePropagation(); return; }
      if (lower === 'd' && !e.repeat) { take(); this._toggleData(); return; }
      if (lower === 't' && !e.repeat) { take(); this._toggleSwing(); return; }
      if (this.ui.swingOpen) {
        if (k === 'Escape') { take(); this._toggleSwing(false); return; }
        const sw = TEST_SWINGS.find((x) => x.key === k);
        if (sw && !e.repeat) { take(); this._swing(sw.id); return; }
      }
      if (this.mode === 'versus') return;   // Esc / M: the match menu
      if (this.modes[this.mode]) return;    // v3:modes Esc / M: the mode's own menu
      if (lower === 'm' && this.run && this.run.kind !== 'free') { e.stopImmediatePropagation(); return; }   // no mulligans in a scored run
      if (k === 'Escape' && !e.repeat) {
        if (this.arcade && this.arcade.trayOpen) return;   // the ball tray closes first
        take();
        this._do(this._fx(this.m.open('pause')));
      }
      return;
    }
    if (typing) {
      if (k === 'Escape') { take(); e.target.blur(); this.ui.playerOpen = null; this._render(); }
      else e.stopImmediatePropagation();   // a name being typed is not a game shortcut
      return;
    }
    if (/^F\d+$/.test(k)) return;
    if (k === 'Tab') return;
    // a focused button answers Enter / Space itself (one action, not two)
    if ((k === 'Enter' || k === ' ') && e.target && e.target.closest && e.target.closest('.sc-root button, .sc-root a')) { e.stopImmediatePropagation(); return; }
    const before = s;
    const eff = this.m.key(k, { repeat: e.repeat });
    take();
    if (eff.type === 'none') return;
    if (eff.type === 'back' && before === 'result') return;
    this._fx(eff);
    this._do(eff);
  }

  _hover(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-i]') : null;
    if (!el || el.disabled) return;
    const scr = el.closest('[data-list]');
    if (!scr || scr.dataset.list !== this.m.screen) return;
    const eff = this.m.setCursor(+el.dataset.i);
    if (eff.type === 'move') { this._cue('ui-tick', { intensity: 0.5 }); this._markCursor(); }
  }

  _click(e) {
    const t = e.target;
    if (this.m.screen === 'title') { this._do({ type: 'leave-title' }); return; }
    const act = t.closest ? t.closest('[data-sc]') : null;
    if (act) { e.preventDefault(); this._action(act.dataset.sc, act); return; }
    const opt = t.closest ? t.closest('[data-opt]') : null;
    if (opt) { this._setOption(+opt.dataset.row, opt.dataset.opt); return; }
    const item = t.closest ? t.closest('[data-i]') : null;
    if (item && !item.disabled) {
      const scr = item.closest('[data-list]');
      if (scr && scr.dataset.list === this.m.screen) {
        this.m.setCursor(+item.dataset.i);
        const eff = { type: 'select', screen: this.m.screen, index: +item.dataset.i };
        this._fx(eff);
        this._do(eff);
      }
    }
  }

  _submit(e) {
    const form = e.target;
    if (!form || !form.dataset || !form.dataset.form) return;
    e.preventDefault();
    const name = String(form.elements.name.value || '').trim();
    if (form.dataset.form === 'add') this._addPlayer(name);
    else if (form.dataset.form === 'rename') this._renamePlayer(form.dataset.id, name);
  }

  /** A real swing while the menus were up: the server dropped it and said so. */
  _onSwing() {
    const eff = this.m.swing();
    if (eff.type !== 'none') { this._fx(eff); this._do(eff); }
  }

  /** Carry out what the machine answered. */
  _do(eff) {
    if (!eff || eff.type === 'none') return;
    if (eff.type === 'leave-title') {   // title -> (the first run: the connection wizard) -> main menu
      this.m.leaveTitle({ needsConnect: !!this.connect.module && this.connect.due && !this.lm.connected });
      this._cue('whoosh');
      this._apply();
      return;
    }
    if (eff.type === 'move') { this._markCursor(); return; }
    if (eff.type === 'adjust') { this._adjust(eff.screen, eff.index, eff.dir); return; }
    if (eff.type === 'select') { this._select(eff.screen, eff.index); return; }
    if (eff.type === 'back') {
      this.ui.exitAsk = false; this.ui.ask = null; this.ui.playerOpen = null; this.ui.removeAsk = null; this.ui.note = '';
      if (eff.from === 'versus') this.matchUI?.closeLobby?.();
      if (eff.from === 'connect') this._closeConnect();
      if (this.modes[eff.from]) { try { this.modes[eff.from].closeLobby?.(); } catch (_) { /* gone */ } }   // v3:modes
    }
    if (eff.type === 'open' && eff.screen === 'versus') this._openLobby();
    if (eff.type === 'open' && this.modes[eff.screen]) { try { this.modes[eff.screen].openLobby?.(); } catch (e) { console.warn(e); } }   // v3:modes
    this._apply();
  }

  _adjust(screen, index, dir) {
    if (screen === 'settings') {
      const row = this._settingsRows()[index];
      if (!row || !row.options) return;
      const i = row.options.findIndex(([v]) => v === row.value);
      const next = row.options[Math.max(0, Math.min(row.options.length - 1, (i < 0 ? 0 : i) + dir))];
      if (next && next[0] !== row.value) this._setOption(index, next[0], true);
    } else if (screen === 'main') {
      // v3:modes left / right step between the two columns of the main menu (the games, the rest), keeping the row
      const items = this._items('main');
      const games = items.filter((it) => it.game).length, rest = items.length - games;
      if (!items.some((it) => it.mode) || !games || !rest) return;
      const to = index < games ? (dir > 0 ? games + Math.min(rest - 1, index) : -1) : (dir < 0 ? Math.min(games - 1, index - games) : -1);
      if (to >= 0 && this.m.setCursor(to, 'main').type === 'move') this._markCursor();
    } else if (screen === 'solo' && index === 0) this._cyclePlayer(dir);
    else if (screen === 'howto') { this.ui.howto = (this.ui.howto + dir + HOWTO_PAGES) % HOWTO_PAGES; this._render(); }
  }
  _setOption(rowIndex, value, quiet = false) {
    const row = this._settingsRows()[rowIndex];
    if (!row || !row.set || row.value === value) return;
    row.set(value);
    if (!quiet) this._cue(value === 'off' || value === '0' ? 'ui-back' : 'ui-tick');
    this.m.setCursor(rowIndex, 'settings');
    this._render();
  }
  _cyclePlayer(dir) {
    if (!this.players.length) return;
    const cur = this._soloPlayer();
    const i = Math.max(0, this.players.findIndex((p) => cur && p.id === cur.id));
    const next = this.players[(i + dir + this.players.length) % this.players.length];
    this.soloPlayer = next.id;
    lsSet(LS.soloPlayer, next.id);
    this._render();
  }

  _select(screen, index) {
    const it = this._items(screen)[index];
    if (!it || it.disabled) { this._cue('ui-error'); return; }
    switch (screen) {
      case 'main':
        if (it.id === 'quit') { try { window.close(); } catch (_) { /* a browser tab stays */ } return; }
        this._lobbyKind = it.id === 'party' ? 'party' : 'versus';   // v3:modes which lobby the match UI opens (_openLobby)
        this._do(this.m.open(it.to));
        return;
      case 'solo':
        if (it.id === 'player') { if (this.players.length > 1) this._cyclePlayer(1); else this._do(this.m.go('players')); return; }
        if (it.kind === 'tour') { this._startSolo({ kind: 'tour', length: it.length }); return; }
        this._do(this.m.open('solo-stage'));
        return;
      case 'solo-stage': this._startSolo({ kind: 'stage', stage: it.id }); return;
      case 'practice':
        this.ui.practiceGame = it.id;
        this._do(this.m.open('practice-stage'));
        return;
      case 'practice-stage': this._startPractice(it.id); return;
      case 'players':
        if (it.id === 'add') { this.layer.querySelector('.sc-add input')?.focus(); return; }
        this.ui.playerOpen = this.ui.playerOpen === it.id ? null : it.id;
        this.ui.removeAsk = null;
        this._render();
        this.layer.querySelector('.sc-rename input')?.focus();
        return;
      case 'settings':
        if (it.link) { this._do(this.m.open(it.link)); return; }
        if (it.options) { const i = it.options.findIndex(([v]) => v === it.value); this._setOption(index, it.options[(i + 1) % it.options.length][0], true); }
        return;
      case 'howto': this.ui.howto = (this.ui.howto + 1) % HOWTO_PAGES; this._render(); return;
      case 'monitor': case 'credits': this._do(this.m.back()); return;
      case 'pause': this._pauseDo(it); return;
      case 'result': this._resultDo(it.id); return;
      default: return;
    }
  }

  /** A [data-sc] control. */
  _action(what, el) {
    switch (what) {
      case 'back': this._do(this._fx(this.m.back())); break;
      case 'menu':   // the MENU button of the solo / practice header
        if (this.mode === 'versus') { this.matchUI?.openMenu?.(); break; }
        if (this.modes[this.mode]) { this.modes[this.mode].openMenu?.(); break; }   // v3:modes
        this._do(this._fx(this.m.open('pause')));
        break;
      case 'quick-two': this._quickTwo(); break;
      case 'remove': this._removePlayer(el.dataset.id); break;
      case 'page': this._cue('ui-tick'); this.ui.howto = (this.ui.howto + (+el.dataset.dir || 1) + HOWTO_PAGES) % HOWTO_PAGES; this._render(); break;
      case 'swing': this._swing(el.dataset.id || 'auto'); break;
      case 'swing-more': this._cue('ui-tick'); this._toggleSwing(); break;
      case 'sliders': this._toggleSwing(false); this.openSliders?.(); break;
      case 'data': this._toggleData(); break;
      case 'connect': this._do(this._fx(this.m.open('connect'))); break;        // SETTINGS > LAUNCH MONITOR: run the wizard again
      case 'connect-skip': this._connectDone(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ versus
  _openLobby() {
    const mu = this.matchUI;
    if (!mu) return;
    // the game's matches are friendly: no play-coin entry fees are offered (the engine keeps them)
    if (mu.pick) { mu.pick.stakes = null; try { mu._savePick?.(); } catch (_) { /* fine */ } }
    if (mu.lobbyOpen) return;
    // START must be live the moment the lobby is up: two players ready (made on the spot the
    // first time), a quick match, a random stage. Enter starts.
    const party = this._lobbyKind === 'party' && typeof mu.openPartyLobby === 'function';   // v3:modes PARTY: the same UI's lobby for two to four
    this._lobbyKind = null;
    Promise.resolve(party ? mu.openPartyLobby() : mu.openLobby()).then(async () => {
      if (!mu.lobbyOpen || mu.match) return;
      if ((mu.players || []).length < 2 && typeof mu._quickTwo === 'function') { try { await mu._quickTwo(); } catch (_) { /* the lobby offers it as a button */ } }
      if (mu.lobbyOpen && !mu.lobbyUi.picker) mu.screen?.querySelector?.('[data-mt="start"]:not([disabled])')?.focus({ preventScroll: true });
    }).catch(() => {});
  }

  // ------------------------------------------------------------ the launch-monitor wizard
  _connectScreen() {
    return `<section class="sc-connect">
      <!-- the connect stream's wizard (public/arcade/connect.js: new ConnectWizard({ root, fetchJson, audio, onDone })) mounts here -->
      <div class="sc-connect-mount" data-sc-mount="connect"></div>
      <button type="button" class="sc-btn sc-connect-skip" data-sc="connect-skip">SKIP FOR NOW ›</button>
    </section>`;
  }
  _mountConnect() {
    const el = this.layer.querySelector('[data-sc-mount="connect"]');
    const mod = this.connect.module;
    if (!el || !mod || this.connect.wizard) return;
    const Wizard = mod.ConnectWizard || (mod.default && mod.default.ConnectWizard) || mod.default;
    try {
      this.connect.wizard = new Wizard({ root: el, fetchJson: this.fetchJson, audio: this.audio, events: this.events, css: false, onDone: () => this._connectDone() }) || true;   // css: false, the shell links arcade/connect.css itself
    } catch (e) {
      console.warn('[shell] the connection wizard would not start', e);
      this._connectDone();
    }
  }
  _closeConnect() {
    const w = this.connect.wizard;
    this.connect.wizard = null;
    try { if (w && typeof w.dispose === 'function') w.dispose(); else if (w && typeof w.close === 'function') w.close(); } catch (_) { /* gone */ }
  }
  /** The wizard finished, or was skipped: it is not due again, and the screen under it (the main menu, or the settings) is back. */
  _connectDone() {
    this.connect.due = false;
    lsSet(LS.connectDone, '1');
    if (this.m.screen === 'connect') this._do(this._fx(this.m.back()));
  }
  /** Follow the match UI: its lobby is the VERSUS screen, a live match is the game, neither is the main menu. */
  _watchMatch() {
    const mu = this.matchUI;
    if (!mu || !mu.root || typeof MutationObserver !== 'function') return;
    const sync = () => {
      const live = !!mu.match;
      const lobby = !!mu.lobbyOpen;
      clearTimeout(this._leaveTimer);
      if (live && !lobby) {
        if (this.m.stack[0] !== 'game' || this.mode !== 'versus') { this.mode = 'versus'; this.m.go('game'); this._hideCard(); this._apply(); }
      } else if (lobby) {
        if (mu.pick && mu.pick.stakes) { mu.pick.stakes = null; try { mu._savePick?.(); } catch (_) { /* fine */ } }
        if (this.m.screen !== 'versus') { this.mode = null; this.m.go('versus'); this._apply(); }
      } else if (this.mode === 'versus' || this.m.screen === 'versus') {
        // neither: back to the main menu, unless a lobby or a match shows up in a moment (NEW MATCH, a rematch)
        this._leaveTimer = setTimeout(() => {
          if (mu.match || mu.lobbyOpen) return;
          if (this.mode === 'versus' || this.m.screen === 'versus') { this.mode = null; this.m.go('main'); this._apply(); }
        }, 350);
      }
    };
    this._matchObserver = new MutationObserver(sync);
    this._matchObserver.observe(mu.root, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
    this._syncMatch = sync;
    sync();
  }

  // ------------------------------------------------------------ solo and practice
  async _post(path, body) {
    const out = await this.fetchJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!out || out.ok === false) {
      this.ui.note = (out && out.error) || 'The game is not answering';
      this._cue('ui-error');
      this._render();
      return null;
    }
    return out;
  }
  async _startSolo(cfg) {
    if (this.ui.busy) return;
    this.ui.busy = true; this.ui.note = '';
    const p = this._soloPlayer();
    this._pendingPractice = null;
    const out = await this._post('/api/solo/start', { ...cfg, playerId: p ? p.id : undefined });
    this.ui.busy = false;
    if (out && out.run) this._onSolo(out.run);
  }
  async _startPractice(stageId) {
    if (this.ui.busy) return;
    this.ui.busy = true; this.ui.note = '';
    const game = practiceGame(this.ui.practiceGame);
    this._pendingPractice = game.mode ? { mode: game.mode } : null;
    const p = this._soloPlayer();
    const out = await this._post('/api/solo/start', { kind: 'free', stage: stageId, playerId: p ? p.id : undefined });
    this.ui.busy = false;
    if (out && out.run) this._onSolo(out.run);
  }

  /** The 'solo' event: the run as the server has it (null: none). */
  _onSolo(run) {
    const prev = this.run;
    const live = run && run.id && !run.aborted ? run : null;
    this.run = live;
    if (run && run.aborted && run.error) {
      // the stage would not load: back to the menu the game was picked from, with the reason on it (never a dead end)
      this.toast('Stage would not load', run.error);
      this._hideCard();
      this._pendingPractice = null;
      this.mode = null;
      this.ui.busy = false;
      this.m.go(run.kind === 'free' ? 'practice' : 'solo');
      this.ui.note = `THAT STAGE WOULD NOT LOAD: ${String(run.error).toUpperCase()}`;
      this._apply();
      return;
    }
    if (!live) {
      this._hideCard();
      if (this.mode === 'solo' || (this.mode === 'practice' && prev)) { this.mode = null; this.m.go('main'); this._apply(); this._refreshBests(); }
      return;
    }
    if (prev && prev.id === live.id && typeof prev.seq === 'number' && live.seq < prev.seq) { this.run = prev; return; }   // stale
    const mode = live.kind === 'free' ? 'practice' : 'solo';
    if (this.m.stack[0] !== 'game' || this.mode !== mode) { this.mode = mode; this.m.go('game'); this._apply(); }
    // a practice game asked for with the stage: start it once the stage is in the bay
    if (live.phase === 'play' && this._pendingPractice) {
      const pp = this._pendingPractice;
      this._pendingPractice = null;
      this.fetchJson('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: pp.mode }) });
    }
    this._renderHdr();
    this._syncCard(prev);
  }

  /** Show, or take down, the card of a finished stage / run: only once the ball has stopped and its banner has played. */
  _syncCard(prev) {
    const r = this.run;
    if (!r) return;
    const key = r.phase === 'stage-result' || r.phase === 'done' ? `${r.id}:${r.phase}:${r.index}:${r.stages[r.index].strokes}:${r.seq}` : null;
    if (!key) {
      this.ui.loading = r.phase === 'loading' && !!prev && prev.id === r.id;
      if (this.ui.cardKey || this.m.screen === 'result') this._hideCard();
      else this._renderOverlay();
      return;
    }
    if (this.ui.cardKey === key) return;
    this.ui.cardKey = key;
    clearInterval(this._cardWait);
    const show = () => {
      if (this.ui.cardKey !== key || !this.run) return;
      if (this.m.screen !== 'result') { this.m.open('result'); this.m.setCursor(0, 'result'); }
      this._cue(r.phase === 'done' ? 'lobby-open' : 'whoosh');
      this._apply();
      if (r.phase === 'done') this._refreshBests();
    };
    // the shot that ended it is still in the air: wait for it, then let its callout have the screen a moment
    const fresh = Date.now() - (this._shotAt || 0) < 30000;
    if (!fresh) { show(); return; }
    this._cardWait = setInterval(() => {
      if (this.isAnimating()) { this._stoppedAt = null; return; }
      this._stoppedAt = this._stoppedAt || Date.now();
      if (Date.now() - this._stoppedAt >= 2400) { clearInterval(this._cardWait); this._stoppedAt = null; show(); }
    }, 150);
  }
  _hideCard() {
    clearInterval(this._cardWait);
    this.ui.cardKey = null;
    if (this.m.screen === 'result') { this.m.go('game'); this._apply(); } else this._renderOverlay();
  }

  async _resultDo(id) {
    const r = this.run;
    if (!r || this.ui.busy) return;
    this.ui.busy = true;
    if (id === 'next') await this._post('/api/solo/next', {});
    else if (id === 'again') {
      const cfg = r.kind === 'tour' ? { kind: 'tour', length: r.stages.length } : { kind: r.kind, stage: r.stages[0].id };
      this.ui.busy = false;
      await this._startSolo(cfg);
    } else if (id === 'pick') {
      const kind = r.kind;
      await this._post('/api/solo/abort', {});
      this.run = null; this.mode = null; this._hideCard();
      this.m.go(kind === 'free' ? 'practice-stage' : 'solo-stage');
      this._apply();
    } else if (id === 'exit') await this._exitToMain();
    this.ui.busy = false;
  }

  async _pauseDo(it) {
    if (it.ask && this.ui.ask !== it.id) { this.ui.ask = it.id; this._render(); return; }
    this.ui.ask = null;
    const close = () => { if (this.m.screen === 'pause') { this.m.back(); this._apply(); } };
    switch (it.id) {
      case 'resume': this._cue('ui-back'); close(); break;
      case 'restart-stage': close(); await this._post('/api/solo/restart-stage', {}); break;
      case 'reset': close(); await this._post('/api/reset', {}); break;
      case 'restart-tour': { const n = this.run ? this.run.stages.length : undefined; close(); await this._startSolo({ kind: 'tour', length: n }); break; }
      case 'give-up': close(); this._shotAt = 0; await this._post('/api/solo/give-up', {}); break;
      case 'settings': this._do(this.m.open('settings')); break;
      case 'exit': await this._exitToMain(); break;
      default: break;
    }
  }
  async _exitToMain() {
    this._pendingPractice = null;
    this._toggleSwing(false);
    if (this.getState()?.practice) await this.fetchJson('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'end' }) });
    if (this.run) await this._post('/api/solo/abort', {});
    this.run = null;
    this.mode = null;
    this.ui.cardKey = null;
    clearInterval(this._cardWait);
    this.m.go('main');
    this._cue('ui-back');
    this._apply();
    this._refreshBests();
  }

  // ------------------------------------------------------------ players
  async _addPlayer(name) {
    if (!name) return;
    const out = await this._post('/api/players', { name });
    if (out) { this._cue('ui-confirm'); this.ui.note = ''; if (out.player && !this.players.some((p) => p.id === out.player.id)) this.players.push(out.player); this._render(); this.layer.querySelector('.sc-add input')?.focus(); }
  }
  async _renamePlayer(id, name) {
    if (!name) return;
    const out = await this._post('/api/players/update', { id, name });
    if (out) { this._cue('ui-confirm'); this.ui.playerOpen = null; const p = this.players.find((x) => x.id === id); if (p) p.name = name; this._render(); }
  }
  async _removePlayer(id) {
    if (this.ui.removeAsk !== id) { this.ui.removeAsk = id; this._cue('ui-tick'); this._render(); return; }
    const out = await this._post('/api/players/remove', { id });
    if (out) { this._cue('ui-back'); this.players = this.players.filter((p) => p.id !== id); this.ui.playerOpen = null; this.ui.removeAsk = null; this._render(); }
  }
  async _quickTwo() {
    for (const name of ['Player 1', 'Player 2']) {
      if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
      const out = await this._post('/api/players', { name });
      if (out && out.player && !this.players.some((p) => p.id === out.player.id)) this.players.push(out.player);
    }
    this._cue('ui-confirm');
    this._render();
  }

  // ------------------------------------------------------------ the test swing, the data panels
  _toggleData() {
    const on = this.doc.documentElement.classList.toggle('sc-data');
    lsSet(LS.data, on ? '1' : '0');
    this._cue('ui-tick');
    this._fitData();
  }
  /** The last-shot panel steps aside when the left column has no room for it (the app's own rule, run again when D shows it). */
  _fitData() {
    const panel = this.doc.getElementById('shotpanel'), card = this.doc.getElementById('shot-card');
    if (!panel || !card || !this.doc.documentElement.classList.contains('sc-data') || panel.classList.contains('hidden')) return;
    panel.classList.remove('no-room');
    if (panel.offsetTop + panel.offsetHeight > card.offsetTop - 8) panel.classList.add('no-room');
  }
  _toggleSwing(force) {
    const open = force == null ? !this.ui.swingOpen : !!force;
    if (open === this.ui.swingOpen) return;
    this.ui.swingOpen = open;
    this._renderSwing();
  }
  /** Hit a ball without a launch monitor: one of the preset swings (shell-core.js TEST_SWINGS). */
  _swing(id) {
    if (this.isAnimating()) return;
    const st = this.getState();
    if (!st || !st.loaded) return;
    // the smart swing plays the shot the lineup predicts for the club the game picked
    const plan = this.getPlan ? this.getPlan() : (typeof globalThis !== 'undefined' && globalThis.__birdie && globalThis.__birdie.lineup ? globalThis.__birdie.lineup.pred : null);
    const ball = testSwing(id, st, () => Math.random() * 2 - 1, plan);
    this.fetchJson('/api/test-shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ball) });
  }

  // ------------------------------------------------------------ drawing
  _markCursor() {
    const cur = this.m.cursor();
    for (const scope of [this.layer, this.overlay]) {
      scope.querySelectorAll(`[data-list="${this.m.screen}"] [data-i]`).forEach((el) => el.classList.toggle('sc-on', +el.dataset.i === cur));
      const on = scope.querySelector(`[data-list="${this.m.screen}"] [data-i].sc-on`);
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  _render() {
    if (!this.layer) return;
    const s = this.m.screen;
    const inGame = this.m.stack[0] === 'game';
    let html = '';
    if (!inGame || s === 'settings' || s === 'monitor' || s === 'credits' || s === 'connect') {
      const fn = { title: this._title, main: this._main, solo: this._solo, 'solo-stage': this._stagePick, practice: this._practice, 'practice-stage': this._stagePick,
        players: this._players, settings: this._settings, monitor: this._monitor, credits: this._credits, howto: this._howto, connect: this._connectScreen }[s];
      html = fn ? fn.call(this) : '';
    }
    if (s === 'connect' && this.connect.wizard && this.layer.querySelector('[data-sc-mount="connect"]')) { this._renderLm(); return; }   // the wizard owns its screen: never redraw under it
    const focus = this.doc.activeElement && this.layer.contains(this.doc.activeElement) ? this.doc.activeElement : null;
    const keep = focus && focus.tagName === 'INPUT' ? { form: focus.closest('form')?.dataset.form, value: focus.value, at: focus.selectionStart } : null;
    this.layer.innerHTML = html;
    this.layer.className = `sc-layer sc-s-${s}${inGame ? ' sc-over-game' : ''}`;
    if (keep && keep.form) {
      const again = this.layer.querySelector(`form[data-form="${keep.form}"] input`);
      if (again) { again.value = keep.value; again.focus(); try { again.setSelectionRange(keep.at, keep.at); } catch (_) { /* fine */ } }
    }
    if (s === 'monitor') this._mountForesight();
    if (s === 'connect') this._mountConnect();
    this._markCursor();
    this._renderLm();
    this._renderHdr();
    this._renderSwing();
    this._renderOverlay();
  }

  _wordmark(cls = '') {
    const [a, b] = PRODUCT.words;
    return `<span class="sc-wordmark ${cls}" aria-label="${esc(PRODUCT.name)}"><b class="sc-w1">${esc(a)}</b>${b ? `<i class="sc-wslash" aria-hidden="true"></i><b class="sc-w2">${esc(b)}</b>` : ''}</span>`;
  }
  _stageName() {
    const st = this.getState();
    return st && st.loaded ? String(st.courseName || '').split(',')[0] : '';
  }
  _hints(list) {
    return `<footer class="sc-hints">${list.map(([k, v]) => `<span><kbd>${esc(k)}</kbd>${esc(v)}</span>`).join('')}</footer>`;
  }
  _head(title, sub = '') {
    return `<header class="sc-head"><button type="button" class="sc-back" data-sc="back" aria-label="Back"><i aria-hidden="true">‹</i>BACK<kbd>ESC</kbd></button>
      <h2 class="sc-h ${String(title).length > 11 ? 'sc-h-long' : ''}">${esc(title)}</h2>${sub ? `<span class="sc-h-sub">${esc(sub)}</span>` : ''}</header>`;
  }
  _note() { return this.ui.note ? `<p class="sc-note" role="alert">${esc(this.ui.note)}</p>` : ''; }

  _title() {
    return `<section class="sc-title">
      <div class="sc-title-c">
        <span class="sc-kicker">${esc(PRODUCT.tagline)}</span>
        <h1 class="sc-title-w">${this._wordmark('sc-wm-xl')}</h1>
        <p class="sc-press"><span>PRESS ANY KEY</span><i>·</i><span>CLICK</span><i>·</i><span>OR HIT A BALL</span></p>
      </div>
      <footer class="sc-title-foot"><span>${PRODUCT.version ? `VERSION ${esc(PRODUCT.version)}` : ''}</span><span>FREE AND OPEN SOURCE</span></footer>
    </section>`;
  }

  _main() {
    const items = this._items('main');
    const stage = this._stageName();
    // v3:modes with the newer modes there are more ways of playing than one column holds: the games are
    // tiles in the first column, the rest (highlights, players, settings ...) a second column beside it.
    // The cursor still walks one list (down the games, then down the rest); left / right step across.
    const split = items.some((it) => it.mode);
    const btn = (it, i, big) => `<button type="button" class="sc-item sc-tone-${it.tone} ${big ? 'sc-big' : 'sc-small'}" data-i="${i}">
          <i class="sc-n">${i < 9 ? i + 1 : ''}</i><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></button>`;
    const list = split
      ? `<div class="sc-main-col sc-main-games">${items.map((it, i) => (it.game ? btn(it, i, true) : '')).join('')}</div>
        <div class="sc-main-col sc-main-more">${items.map((it, i) => (it.game ? '' : btn(it, i, false))).join('')}</div>`
      : items.map((it, i) => btn(it, i, i < 3)).join('');
    return `<section class="sc-main ${split ? 'sc-main-split' : ''}">
      <header class="sc-main-head">${this._wordmark('sc-wm-md')}<span class="sc-main-tag">PICK A GAME</span></header>
      <nav class="sc-list sc-main-list" data-list="main" aria-label="Main menu">
        ${list}
      </nav>
      ${this._hints([['↑ ↓', 'CHOOSE'], ...(split ? [['← →', 'ACROSS']] : []), ['ENTER', 'GO'], ['1 – ' + Math.min(9, items.length), 'JUMP'], ['ESC', 'TITLE']])}
    </section>
    ${stage ? `<aside class="sc-now"><span>ON SCREEN</span><b>${esc(stage.toUpperCase())}</b></aside>` : (this._loaded && !this.stages.length ? '<aside class="sc-now sc-warn"><span>NO STAGES INSTALLED</span><b>RUN: NPM RUN ARCADE:HOLES</b></aside>' : '')}`;
  }

  _solo() {
    const items = this._items('solo');
    const p = this._soloPlayer();
    return `<section class="sc-panel">
      ${this._head('SOLO', 'EVERY SHOT GRADED · A SCORE AGAINST PAR')}
      <div class="sc-list sc-col" data-list="solo">
        <button type="button" class="sc-item sc-row sc-player-row" data-i="0"><i class="sc-n">1</i><b>PLAYING AS</b>
          <span class="sc-val">${this.players.length > 1 ? '<em>‹</em>' : ''}${esc(p ? p.name.toUpperCase() : 'PLAYER 1')}${this.players.length > 1 ? '<em>›</em>' : ''}</span>
          <span>${this.players.length > 1 ? 'ENTER OR ← → CHANGES THE PLAYER' : this.players.length ? 'ADD MORE NAMES UNDER PLAYERS' : 'A GUEST · ADD YOUR NAME UNDER PLAYERS TO KEEP SCORES APART'}</span></button>
        ${items.slice(1).map((it, k) => `<button type="button" class="sc-item sc-row ${it.kind === 'tour' ? 'sc-tone-p1' : 'sc-tone-p2'}" data-i="${k + 1}" ${it.disabled ? 'disabled' : ''}>
          <i class="sc-n">${k + 2}</i><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></button>`).join('')}
      </div>
      ${this._note()}
      ${this._hints([['↑ ↓', 'CHOOSE'], ['ENTER', 'PLAY'], ['ESC', 'BACK']])}
    </section>`;
  }

  _practice() {
    const items = this._items('practice');
    return `<section class="sc-panel">
      ${this._head('PRACTICE', 'NO SCORE · NO PRESSURE')}
      <div class="sc-list sc-col" data-list="practice">
        ${items.map((it, i) => `<button type="button" class="sc-item sc-row sc-tone-p2" data-i="${i}" ${it.disabled ? 'disabled' : ''}><i class="sc-n">${i + 1}</i><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></button>`).join('')}
      </div>
      ${this._note()}
      ${this._hints([['↑ ↓', 'CHOOSE'], ['ENTER', 'PICK A STAGE'], ['ESC', 'BACK']])}
    </section>`;
  }

  _stagePick() {
    const s = this.m.screen;
    const list = this._stageList(s);
    const practice = s === 'practice-stage';
    const game = practiceGame(this.ui.practiceGame);
    const key = this._soloPlayer()?.id || '_guest';
    const card = (st, i) => {
      const t = themeOf(st);
      const best = !practice && this.bests.stages && this.bests.stages[st.id] ? this.bests.stages[st.id][key] : null;
      return `<button type="button" class="sc-stage ${st.arena ? 'sc-arena' : ''}" data-i="${i}" style="--ta:${t.a};--tb:${t.b};--tg:${t.glow}">
        ${silhouette(st.theme)}<i class="sc-stage-n">${st.arena ? 'ARENA' : esc(st.number || st.order || i + 1)}</i>
        <b>${esc(String(st.name || st.id).toUpperCase())}</b>
        <span>PAR ${esc(st.par)}${st.lengthYd ? ` · ${Math.round(st.lengthYd)} YD` : ''}</span>
        ${best ? `<em>BEST ${best.strokes}</em>` : ''}</button>`;
    };
    return `<section class="sc-panel sc-wide">
      ${this._head(practice ? game.label : 'SINGLE STAGE', practice ? 'PICK A STAGE' : 'PICK A STAGE · PLAY IT FOR A SCORE')}
      ${list.length ? `<div class="sc-list sc-grid" data-list="${s}">${list.map(card).join('')}</div>` : '<p class="sc-empty">NO STAGES INSTALLED</p>'}
      ${this._note()}
      ${this._hints([['← ↑ ↓ →', 'CHOOSE'], ['ENTER', 'PLAY'], ['ESC', 'BACK']])}
    </section>`;
  }

  _players() {
    const key = (p) => p.id;
    const full = String(this.stages.length);
    const row = (p, i) => {
      const pr = this.profiles[p.id] || null;
      const open = this.ui.playerOpen === p.id;
      const best = this.bests.tours && this.bests.tours[full] ? this.bests.tours[full][key(p)] : null;
      const rank = pr ? rankText(pr.rank) : '';
      const facts = [
        rank || 'NEW CHALLENGER',
        pr ? `${pr.trophies || 0} TROPHIES` : '0 TROPHIES',
        pr ? `${pr.wins || 0} W · ${pr.losses || 0} L` : '0 W · 0 L',
        pr && pr.bestStreak > 1 ? `BEST RUN ${pr.bestStreak}` : '',
        best ? `TOUR BEST ${relText(best.toPar)}` : '',
      ].filter(Boolean);
      return `<div class="sc-player ${open ? 'sc-open' : ''}">
        <button type="button" class="sc-item sc-row" data-i="${i}"><i class="sc-n">${i + 1}</i><b>${esc(p.name.toUpperCase())}</b><span>${facts.map(esc).join(' · ')}</span></button>
        ${open ? `<div class="sc-player-edit">
          <form class="sc-rename" data-form="rename" data-id="${esc(p.id)}"><input name="name" maxlength="24" value="${esc(p.name)}" autocomplete="off" aria-label="Player name"><button type="submit" class="sc-btn">RENAME</button></form>
          <button type="button" class="sc-btn sc-danger" data-sc="remove" data-id="${esc(p.id)}">${this.ui.removeAsk === p.id ? 'SURE? PRESS AGAIN' : 'REMOVE'}</button>
        </div>` : ''}
      </div>`;
    };
    const n = this.players.length;
    return `<section class="sc-panel">
      ${this._head('PLAYERS', n ? 'TROPHIES ARE WON IN VERSUS' : 'NOBODY HERE YET')}
      <div class="sc-list sc-col sc-players" data-list="players">
        ${n ? this.players.map(row).join('') : '<p class="sc-empty">ADD YOUR NAMES, SO THE GAME CAN KEEP YOUR RANK, TROPHIES AND BEST SCORES.</p>'}
        <div class="sc-item sc-row sc-add-row" data-i="${n}">
          <form class="sc-add" data-form="add"><input name="name" maxlength="24" placeholder="NEW PLAYER NAME" autocomplete="off" aria-label="New player name"><button type="submit" class="sc-btn sc-go">ADD PLAYER</button></form>
          ${n < 2 ? '<button type="button" class="sc-btn" data-sc="quick-two">ONE TAP: PLAYER 1 AND PLAYER 2</button>' : ''}
        </div>
      </div>
      ${this._note()}
      ${this._hints([['↑ ↓', 'CHOOSE'], ['ENTER', 'RENAME · REMOVE'], ['ESC', 'BACK']])}
    </section>`;
  }

  _settings() {
    const rows = this._settingsRows();
    return `<section class="sc-panel">
      ${this._head('SETTINGS')}
      <div class="sc-list sc-col sc-settings" data-list="settings">
        ${rows.map((r, i) => {
          let ctl;
          if (!r.options) ctl = `<span class="sc-val">${esc(r.value)}<em>›</em></span>`;
          else if (r.options.length > 5) {   // a long scale: a stepper with a meter, not eleven buttons
            const k = Math.max(0, r.options.findIndex(([v]) => v === r.value));
            ctl = `<span class="sc-step-ctl"><button type="button" data-row="${i}" data-opt="${esc(r.options[Math.max(0, k - 1)][0])}" tabindex="-1" aria-label="Less">‹</button>
              <i class="sc-meter" style="--f:${(k / (r.options.length - 1)).toFixed(3)}"></i><b>${esc(r.options[k][1])}</b>
              <button type="button" data-row="${i}" data-opt="${esc(r.options[Math.min(r.options.length - 1, k + 1)][0])}" tabindex="-1" aria-label="More">›</button></span>`;
          } else ctl = `<span class="sc-seg">${r.options.map(([v, l]) => `<button type="button" class="${v === r.value ? 'on' : ''}" data-row="${i}" data-opt="${esc(v)}" tabindex="-1">${esc(l)}</button>`).join('')}</span>`;
          return `<div class="sc-item sc-row sc-set" data-i="${i}" ${r.link ? `data-link="${r.link}"` : ''}>
            <span class="sc-set-l"><b>${esc(r.label)}</b>${r.hint ? `<em>${esc(r.hint)}</em>` : ''}</span>${ctl}</div>`;
        }).join('')}
      </div>
      ${this._hints([['↑ ↓', 'CHOOSE'], ['← →', 'CHANGE'], ['ESC', 'BACK']])}
    </section>`;
  }

  _monitor() {
    const port = (typeof globalThis !== 'undefined' && globalThis.__PRODUCT__ && globalThis.__PRODUCT__.ocPort) || 921;
    const guide = PRODUCT.url ? `<a href="${esc(PRODUCT.url)}#connect-your-launch-monitor" target="_blank" rel="noopener">${esc(PRODUCT.connectGuide)}</a>` : esc(PRODUCT.connectGuide);
    return `<section class="sc-panel sc-wide sc-text">
      ${this._head('LAUNCH MONITOR')}
      <div class="sc-doc sc-doc-2">
        ${this.connect.module ? '<div class="sc-doc-card sc-doc-setup"><button type="button" class="sc-btn sc-go sc-connect-run" data-sc="connect">SET UP MY LAUNCH MONITOR ›</button><p>Pick your launch monitor and the game walks you through connecting it, then checks a ball.</p></div>' : ''}
        <div class="sc-doc-card"><b>WHAT THE GAME LISTENS FOR</b>
          <p>The <strong>GSPro Open Connect</strong> protocol, on <strong>this PC</strong>, TCP port <strong>${esc(port)}</strong>. Any launch monitor whose connector software can send shots to GSPro can send them here.</p></div>
        <div class="sc-doc-card"><b>WHAT TO CHECK</b>
          <ol>
            <li>Close any other simulator that uses that port (GSPro itself, for one): only one program can listen on it.</li>
            <li>Start the connector software for your launch monitor and point it at this PC (address <strong>127.0.0.1</strong> when it runs on this computer), port <strong>${esc(port)}</strong>.</li>
            <li>The status in the corner turns green and says CONNECTED. Hit a ball.</li>
          </ol></div>
        <div class="sc-doc-card"><b>FORESIGHT GC OWNERS <em>EXPERIMENTAL</em></b>
          <p>Open your Foresight connector for GSPro: the game picks it up by itself.</p>
          <!-- the Foresight bridge's own status panel and its auto / on / off switch (public/arcade/foresight-panel.js, docs/foresight-bridge.md) mounts here -->
          <div class="sc-fb-mount" data-sc-mount="foresight"></div></div>
        <div class="sc-doc-card"><b>NO LAUNCH MONITOR?</b>
          <p>You can still try everything: in a game press <kbd>T</kbd> for a test swing.</p></div>
        <div class="sc-doc-card sc-doc-last"><p class="sc-doc-foot">Each launch monitor connects its own way: see ${guide}.</p></div>
      </div>
      ${this._hints([['ESC', 'BACK']])}
    </section>`;
  }
  /** The Foresight bridge's panel, when its module is there (the bridge stream's; absent: the mount point stays empty). */
  async _mountForesight() {
    const el = this.layer.querySelector('[data-sc-mount="foresight"]');
    if (!el) return;
    try { this._fbUnmount?.(); } catch (_) { /* gone */ }
    this._fbUnmount = null;
    try {
      this._fbModule = this._fbModule || await import('./foresight-panel.js');
      const mod = this._fbModule;
      const mount = mod.mountForesightPanel || mod.mountPanel || mod.mount || mod.default;
      if (typeof mount !== 'function' || !el.isConnected) return;
      const out = mount(el, { fetchJson: this.fetchJson, events: this.events, audio: this.audio });
      this._fbUnmount = out && typeof out.dispose === 'function' ? () => out.dispose() : (typeof out === 'function' ? out : null);
    } catch (_) { /* no bridge panel in this build: the help text stands on its own */ }
  }

  _credits() {
    const built = PRODUCT.builtOn.map((b) => `<li><strong>${esc(b.name)}</strong> by ${esc(b.by)}${b.licence ? ` (${esc(b.licence)})` : ''}<br><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.url)}</a></li>`).join('');
    return `<section class="sc-panel sc-wide sc-text">
      ${this._head('CREDITS')}
      <div class="sc-doc sc-doc-2">
        <div class="sc-doc-card sc-credit-top">${this._wordmark('sc-wm-sm')}<p>${esc(PRODUCT.tagline)}. Free and open source (${esc(PRODUCT.licence)}).${PRODUCT.url ? ` <a href="${esc(PRODUCT.url)}" target="_blank" rel="noopener">${esc(PRODUCT.url)}</a>` : ''}</p></div>
        <div class="sc-doc-card"><b>BUILT ON</b><ul>${built}</ul>
          <p>The golf underneath (the ball flight, the terrain, the launch-monitor link, the 3D course) is Open-Birdie, an open-source golf simulator.</p></div>
        <div class="sc-doc-card"><b>SOUND, VOICE AND 3D MODELS</b>
          <p>Every sound, announcer line and model is listed with its author and licence in the project's credits files:</p>
          <ul>${PRODUCT.creditsFiles.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul></div>
        <div class="sc-doc-card"><b>3D ENGINE</b><p>three.js (MIT).</p></div>
      </div>
      ${this._hints([['ESC', 'BACK']])}
    </section>`;
  }

  _howto() {
    const page = this.ui.howto;
    const balls = ((this.snap && this.snap.powerups) || []).filter((b) => b.kind !== 'trick').slice(0, 9);
    const tricks = ((this.snap && this.snap.powerups) || []).filter((b) => b.kind === 'trick');
    const ballCard = (b) => `<div class="sc-ball" style="--bc:${hex(b.color)}"><i>${esc(b.emoji || '●')}</i><b>${esc(String(b.name).toUpperCase())}</b><span>${esc(b.tagline || '')}</span></div>`;
    const pages = [
      { title: 'THE GAME', body: `<div class="sc-steps">
          <div class="sc-step"><i>1</i><b>HIT A REAL BALL</b><span>Your launch monitor reads the swing. The ball flies on the stage with the speed, launch and spin you gave it.</span></div>
          <div class="sc-step"><i>2</i><b>EVERY SHOT IS GRADED</b><span>PERFECT, GREAT, GOOD, OK, MISS. Good shots pay points and coins and build a streak; a streak multiplies everything.</span></div>
          <div class="sc-step"><i>3</i><b>HOLE OUT</b><span>Fewest strokes wins. Putting is easy by default: roll it at the hole and the game reads the break.</span></div>
        </div>` },
      { title: 'THE MODES', body: `<div class="sc-steps">
          <div class="sc-step sc-tone-duel"><i>VS</i><b>VERSUS</b><span>Two players take turns on one hole. Fewest strokes takes the hole; all square goes to sudden death, one ball each, closest to the pin. Quick match, best of 3, or a tournament.</span></div>
          <div class="sc-step sc-tone-p1"><i>1P</i><b>SOLO</b><span>The tour alone, stage after stage, for a total against par. Your best score is kept. Or any single stage.</span></div>
          <div class="sc-step sc-tone-p2"><i>∞</i><b>PRACTICE</b><span>Free play on any stage, closest to the pin, a putting challenge, up and down. Nothing counts.</span></div>
        </div>` },
      // v3:modes the newer games (docs/modes.md)
      { title: 'MORE GAMES', body: `<div class="sc-steps">
          <div class="sc-step sc-tone-party"><i>2–4</i><b>PARTY</b><span>Up to four on one bay. SKINS: the lowest score alone takes the hole, a tie carries it over. STROKE RACE: lowest total. ELIMINATION: the highest score on each hole is out. A player who can no longer matter to a hole picks up.</span></div>
          <div class="sc-step sc-tone-gold"><i>◎</i><b>BULLSEYE</b><span>Darts with a golf ball on the three arenas. Three balls a turn; the rings round the pin score 50, 25, 15, 10, 5. Play for a high score, or count down to exactly zero.</span></div>
          <div class="sc-step sc-tone-duel"><i>?!</i><b>TRICK SHOT DUEL</b><span>Hit any shot. The game calls what made it special (carry, bend, how close) and the other player must match it or take a letter. Spell the word and you lose.</span></div>
        </div>
        <p class="sc-lead sc-lead-2">HELP in a lobby is a handicap for one player: easy putting and a power-up, then a forward tee. A great shot is replayed from another camera (any key or a swing skips it), and HIGHLIGHTS keeps the best of the night.</p>` },
      { title: 'THE BALLS', body: `<p class="sc-lead">Streaks, level-ups and match chests earn power-up balls. Arm one before you swing: <kbd>B</kbd> opens the tray, a number key arms.</p>
        <div class="sc-balls">${balls.map(ballCard).join('') || '<p class="sc-empty">THE BALLS LOAD WITH THE GAME</p>'}</div>
        ${tricks.length ? `<p class="sc-lead sc-lead-2">In a match, TRICKS are played on your opponent's next shot: ${tricks.map((t) => esc(String(t.name).toUpperCase())).join(' · ')}.</p>` : ''}` },
      { title: 'THE KEYS', body: `<div class="sc-keys">${KEYS_HELP.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div>
        <p class="sc-lead sc-lead-2">No launch monitor? Press <kbd>T</kbd> in a game for a test swing: SMART SWING plays a sensible shot for wherever the ball lies.</p>` },
    ];
    const p = pages[page] || pages[0];
    return `<section class="sc-panel sc-wide sc-text">
      ${this._head('HOW TO PLAY', `${page + 1} OF ${pages.length} · ${p.title}`)}
      <div class="sc-howto">${p.body}</div>
      <nav class="sc-pager"><button type="button" class="sc-btn" data-sc="page" data-dir="-1">‹ BACK</button>
        ${pages.map((x, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('')}
        <button type="button" class="sc-btn sc-go" data-sc="page" data-dir="1">NEXT ›</button></nav>
      ${this._hints([['← →', 'PAGE'], ['ESC', 'BACK']])}
    </section>`;
  }

  // ---------- the monitor chip (the menus' corner; in play the top bar has its own)
  _lmText() {
    const lm = this.lm || {};
    if (!lm.connected) return 'WAITING FOR A LAUNCH MONITOR';
    const src = lm.source ? String(lm.source).replace(/[-_]/g, ' ').toUpperCase() : '';
    return `LAUNCH MONITOR CONNECTED${src ? ` · ${src}` : ''}`;
  }
  _renderLm() {
    if (!this.lmEl) return;
    const on = !!(this.lm && this.lm.connected);
    this.doc.documentElement.classList.toggle('sc-lm-on', on);
    this.lmEl.className = `sc-lm ${on ? 'sc-on' : ''}`;
    this.lmEl.innerHTML = `<i aria-hidden="true"></i><span>${esc(this._lmText())}</span>`;
    const t = this.doc.getElementById('lm-text');
    if (t) t.textContent = on ? `Monitor connected${this.lm.source ? ` · ${String(this.lm.source).replace(/[-_]/g, ' ')}` : ''}` : 'Monitor waiting';
  }

  // ---------- in play: the header
  _renderHdr() {
    if (!this.hdr) return;
    const inGame = this.m.stack[0] === 'game';
    if (!inGame || this.mode === 'versus' || !this.mode) { this.hdr.innerHTML = ''; this.hdr.classList.add('sc-hidden'); return; }
    this.hdr.classList.remove('sc-hidden');
    const st = this.getState() || {};
    const pr = st.practice || null;
    const v = soloHeaderView(this.run, st);
    const menu = '<button type="button" class="sc-hdr-menu" data-sc="menu" title="Menu (Esc)"><i aria-hidden="true"></i>MENU</button>';
    const cell = (kicker, name, cls = '') => `<span class="sc-hdr-stage ${cls}"><em>${esc(kicker)}</em><b>${esc(name)}</b></span>`;
    const fact = (label, value) => `<span class="sc-hdr-fact"><em>${esc(label)}</em><b>${esc(value)}</b></span>`;
    let body;
    if (pr) {
      body = cell(`PRACTICE · ${this._stageName().toUpperCase()}`, String(pr.label || '').toUpperCase());
    } else if (v) {
      const kick = this.run.kind === 'tour' ? `SOLO TOUR ${this.run.index + 1}/${this.run.stages.length} · PAR ${v.par}` : `${v.kind} · PAR ${v.par}`;
      body = cell(kick, v.stage, this.run.kind === 'free' ? '' : 'sc-solo')
        + fact(st.holed ? 'HOLED' : 'SHOT', st.holed ? v.strokes : v.shot)
        + (v.total != null ? fact('TOTAL', v.total) : '');
    } else {
      body = cell(`FREE PLAY · PAR ${st.par ?? '–'}`, this._stageName().toUpperCase())
        + fact(st.holed ? 'HOLED' : 'SHOT', st.holed ? st.strokes : (st.strokes || 0) + 1);
    }
    this.hdr.innerHTML = menu + body;
  }

  // ---------- in play: the test swing
  _renderSwing() {
    if (!this.swingBar) return;
    const inGame = this.m.stack[0] === 'game';
    const st = this.getState();
    const can = inGame && st && st.loaded && !(st.over && !st.practice) && !(st.holed && !st.practice) && (!this.run || this.run.phase === 'play' || !!st.practice);
    const show = can && (!this.lm.connected || this.ui.swingOpen);
    this.swingBar.classList.toggle('sc-hidden', !show);
    if (!show) { this.swingBar.innerHTML = ''; return; }
    const open = this.ui.swingOpen;
    this.swingBar.innerHTML = `
      ${open ? `<div class="sc-swing-pop" role="menu" aria-label="Test swings">
        <span class="sc-swing-h">TEST SWING · NO LAUNCH MONITOR NEEDED</span>
        ${TEST_SWINGS.map((s) => `<button type="button" class="sc-swing-b" data-sc="swing" data-id="${s.id}"><kbd>${s.key}</kbd><b>${esc(s.label)}</b><span>${esc(s.sub)}</span></button>`).join('')}
        <button type="button" class="sc-swing-b sc-swing-sl" data-sc="sliders"><b>SLIDERS…</b><span>SPEED · LAUNCH · SPIN</span></button>
      </div>` : ''}
      <button type="button" class="sc-swing-go" data-sc="swing" data-id="auto" title="Hit a sensible shot for this lie, without a launch monitor"><b>TEST SWING</b><span>NO MONITOR NEEDED</span></button>
      <button type="button" class="sc-swing-more ${open ? 'on' : ''}" data-sc="swing-more" aria-expanded="${open}" title="More test swings (T)"><i aria-hidden="true">${open ? '▾' : '▴'}</i><kbd>T</kbd></button>`;
  }

  // ---------- in play: the pause menu, the cards
  _renderOverlay() {
    if (!this.overlay) return;
    const s = this.m.screen;
    let html = '';
    if (s === 'pause') html = this._pause();
    else if (s === 'result' && this.run) html = this.run.phase === 'done' ? this._results() : this._stageCard();
    else if (this.m.stack[0] === 'game' && this.run && this.run.phase === 'loading' && this.ui.loading) html = '<div class="sc-loading"><span>' + (this.run.kind === 'tour' ? 'NEXT STAGE' : 'BACK ON THE TEE') + '</span><b>' + esc(String(this.run.stages[this.run.index].name).toUpperCase()) + '</b></div>';
    this.overlay.innerHTML = html;
    this.overlay.className = `sc-overlay ${html ? `sc-o-${s}` : 'sc-hidden'}`;
    this._markCursor();
  }

  _pause() {
    const items = this._pauseItems();
    const v = soloHeaderView(this.run, this.getState());
    const where = v ? `${v.kind} · ${v.stage}${v.total != null ? ` · TOTAL ${v.total}` : ''}` : `FREE PLAY · ${this._stageName().toUpperCase()}`;
    return `<div class="sc-scrim" data-sc="back"></div>
      <div class="sc-card sc-pause" role="dialog" aria-modal="true" aria-label="Menu">
        <span class="sc-card-k">${esc(where)}</span>
        <h2 class="sc-card-t">PAUSED</h2>
        <div class="sc-list sc-col" data-list="pause">
          ${items.map((it, i) => `<button type="button" class="sc-item sc-row ${it.id === 'exit' || it.id === 'give-up' || it.id === 'restart-tour' ? 'sc-warnable' : ''} ${this.ui.ask === it.id ? 'sc-asking' : ''}" data-i="${i}">
            <i class="sc-n">${i + 1}</i><b>${esc(this.ui.ask === it.id ? 'SURE? PRESS AGAIN' : it.label)}</b><span>${esc(it.sub)}</span></button>`).join('')}
        </div>
        <span class="sc-card-note">SWINGS STILL COUNT WHILE THIS IS OPEN · ESC TO RESUME</span>
      </div>`;
  }

  _stageCard() {
    const r = this.run;
    const s = r.stages[r.index];
    const items = this._resultItems();
    const tone = s.pickedUp ? 'bad' : s.toPar < 0 ? 'good' : s.toPar === 0 ? 'par' : 'over';
    const tour = r.kind === 'tour';
    return `<div class="sc-scrim"></div>
      <div class="sc-card sc-stagecard sc-t-${tone}" role="dialog" aria-modal="true" aria-label="Stage result">
        <span class="sc-card-k">${tour ? `STAGE ${r.index + 1} OF ${r.stages.length} · ` : ''}${esc(String(s.name).toUpperCase())} · PAR ${s.par}</span>
        <h2 class="sc-card-t sc-score">${esc(s.scoreName || '')}</h2>
        <div class="sc-facts">
          <div><em>STROKES</em><b>${s.strokes}</b></div>
          <div><em>POINTS</em><b>${Number(s.points || 0).toLocaleString('en-US')}</b></div>
          ${tour ? `<div class="sc-total"><em>TOUR TOTAL</em><b>${esc(r.totals.toParText)}</b></div>` : ''}
        </div>
        ${tour ? `<p class="sc-card-next">NEXT: <b>${esc(String(r.stages[r.index + 1]?.name || '').toUpperCase())}</b> · PAR ${r.stages[r.index + 1]?.par ?? ''}</p>` : ''}
        <div class="sc-list sc-btnrow" data-list="result">
          ${items.map((it, i) => `<button type="button" class="sc-btn sc-item ${i === 0 ? 'sc-go' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}
        </div>
      </div>`;
  }

  _results() {
    const r = this.run;
    const t = r.totals;
    const items = this._resultItems();
    const tour = r.kind === 'tour';
    const cell = (s) => {
      const cls = s.pickedUp ? 'bad' : s.toPar < 0 ? 'good' : s.toPar > 0 ? 'over' : 'par';
      return `<tr class="sc-r-${cls}"><td>${esc(String(s.name).toUpperCase())}</td><td>${s.par}</td><td><b>${s.strokes}</b></td><td>${esc(s.pickedUp ? 'PICKED UP' : s.scoreName)}</td><td>${Number(s.points || 0).toLocaleString('en-US')}</td></tr>`;
    };
    const best = r.best;
    const bestLine = r.newBest
      ? '<p class="sc-newbest">NEW BEST SCORE!</p>'
      : best ? `<p class="sc-best">BEST: ${esc(relText(best.toPar))} · ${best.strokes} STROKES</p>` : '';
    return `<div class="sc-scrim"></div>
      <div class="sc-card sc-results ${r.newBest ? 'sc-is-best' : ''}" role="dialog" aria-modal="true" aria-label="Results">
        <span class="sc-card-k">${tour ? `SOLO TOUR · ${r.stages.length} STAGES` : 'SOLO STAGE'} · ${esc(String(r.player.name).toUpperCase())}</span>
        <h2 class="sc-card-t">${tour ? 'TOUR COMPLETE' : esc(String(r.stages[0].name).toUpperCase())}</h2>
        <div class="sc-hero ${t.toPar < 0 ? 'sc-good' : t.toPar > 0 ? 'sc-over' : ''}"><b>${esc(t.toParText)}</b><span>${esc(parWords(t.toPar))}<em>${t.strokes} STROKES · PAR ${t.par} · ${Number(t.points || 0).toLocaleString('en-US')} POINTS</em></span></div>
        ${bestLine}
        <table class="sc-table"><thead><tr><th>STAGE</th><th>PAR</th><th>STROKES</th><th></th><th>POINTS</th></tr></thead><tbody>${r.stages.map(cell).join('')}</tbody></table>
        ${r.bestShots && r.bestShots.length ? `<div class="sc-shots"><em>BEST SHOTS</em>${r.bestShots.map((b) => `<span class="sc-shot sc-${esc(b.tone)}"><b>${esc(b.text)}</b>${esc(String(b.stageName).toUpperCase())}</span>`).join('')}</div>` : ''}
        <div class="sc-list sc-btnrow" data-list="result">
          ${items.map((it, i) => `<button type="button" class="sc-btn sc-item ${i === 0 ? 'sc-go' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}
        </div>
      </div>`;
  }
}

export default initShell;
