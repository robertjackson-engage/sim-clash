// v3:modes Instant replay, on the page (docs/modes.md "Instant replay and highlights").
//
// ReplayDirector plays a shot again from one of the alternate cameras of replay-core.js:
// it cuts to that camera (scene.playShot with a camera plan of its own), puts the REPLAY tag
// and the shot's title on screen, hides the play HUD under it, and ends when the path does,
// when somebody skips it (any key, a click, a swing the server dropped) or when a live ball
// arrives (cancel: the live shot takes the picture at once, nothing waits).
//
// It knows nothing about the game's flow: public/app.js decides WHEN a replay plays (after a
// notable shot of a match: once, by itself; in solo play: offered), holds the game's state
// back while it does, and puts the picture back afterwards.
//
// Sound: one guarded cue at the cut (the existing 'whoosh'); nothing loops, no shot sounds,
// no crowd. Ids this would like to have of its own: see docs/modes.md.
import { replayCameraPlan, replaySim, chooseReplayCamera, arrivalSim, REPLAY_CAMERA_LABELS, REPLAY_CAMERAS } from './replay-core.js';
import { slotColor, slotMark, esc } from './shell-core.js';

const SKIP_GRACE_MS = 350;   // a key that was already on its way down when the replay cut in is not a skip
let live = null;             // the director that is playing (the listeners below serve it)

// Registered when this module loads (before the match UI and the shell register theirs), on
// the capture phase: while a replay plays, any key or click is "skip" and nothing else.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  window.addEventListener('keydown', (e) => {
    if (!live || !live.active) return;
    const k = String(e.key || '');
    if (/^F\d+$/.test(k) || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock' || k === 'Tab' || e.ctrlKey || e.metaKey) return;
    eat(e);
    if (!e.repeat) live.skip('key');
  }, true);
  window.addEventListener('keyup', (e) => { if (live && live.active && !e.ctrlKey && !e.metaKey) e.stopImmediatePropagation(); }, true);
  for (const type of ['pointerdown', 'click']) {
    window.addEventListener(type, (e) => {
      if (!live || !live.active) return;
      eat(e);
      if (type === 'pointerdown') live.skip('click');
    }, true);
  }
}

export class ReplayDirector {
  /**
   * scene   the Scene (render/scene.js): playShot, stopShot, hAt, waterLevelAt, props, pinSim
   * audio   ArcadeAudio or null (guarded)
   */
  constructor({ scene, audio = null, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
    this.scene = scene;
    this.audio = audio;
    this.doc = doc;
    this.job = null;       // the replay that is playing: { token, startedAt, onEnd, plan, ... }
    this.count = 0;        // replays played (tests, the page's own checks)
    this.last = null;      // { camera, title, reason } of the last one
    this._build();
  }

  get active() { return !!this.job; }
  get camera() { return this.job ? this.job.camera : null; }

  _build() {
    const d = this.doc;
    if (!d || !d.body) return;
    if (!d.querySelector('link[data-rp-css]')) {
      const link = d.createElement('link');
      link.rel = 'stylesheet'; link.href = 'arcade/replay.css'; link.setAttribute('data-rp-css', '');
      d.head.appendChild(link);
    }
    this.root = d.createElement('div');
    this.root.className = 'rp-root rp-hidden';
    this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = `
      <i class="rp-bar rp-bar-top" aria-hidden="true"></i><i class="rp-bar rp-bar-bot" aria-hidden="true"></i>
      <i class="rp-flash" aria-hidden="true"></i>
      <div class="rp-tag"><i class="rp-dot" aria-hidden="true"></i><b>REPLAY</b><span class="rp-cam"></span></div>
      <div class="rp-title"><span class="rp-kicker"></span><b class="rp-what"></b><span class="rp-who"></span></div>
      <div class="rp-skip">ANY KEY · CLICK · OR SWING TO SKIP</div>`;
    d.body.appendChild(this.root);
  }

  _cue(name, opts) { try { this.audio?.cue?.(name, opts); } catch (_) { /* silent */ } }

  _show(job) {
    if (!this.root) return;
    const q = (s) => this.root.querySelector(s);
    q('.rp-cam').textContent = REPLAY_CAMERA_LABELS[job.camera] || '';
    q('.rp-kicker').textContent = job.kicker || '';
    q('.rp-what').textContent = job.title || '';
    const who = q('.rp-who');
    const slot = job.player && job.player.slot;
    who.innerHTML = `${job.player && job.player.name ? `<i class="rp-mark" style="color:${slot ? slotColor(slot) : 'inherit'}">${slot ? esc(slotMark(slot)) : ''}</i><em style="color:${slot ? slotColor(slot) : 'inherit'}">${esc(String(job.player.name).toUpperCase())}</em>` : ''}${job.sub ? `<span>${esc(job.sub)}</span>` : ''}`;
    this.root.classList.toggle('rp-kind-sotm', job.kind === 'sotm');
    this.root.classList.remove('rp-hidden', 'rp-out');
    void this.root.offsetWidth;   // restart the entrance
    this.root.classList.add('rp-in');
    this.doc.documentElement.classList.add('rp-on');
  }

  _hide() {
    if (!this.root) return;
    this.doc.documentElement.classList.remove('rp-on');
    this.root.classList.remove('rp-in');
    this.root.classList.add('rp-hidden');
  }

  /**
   * Play a shot again.
   *   job.raw        the server's sim { points:[{t,x,y,z}], flightTime, isPutt, events } (re-timed here: slow motion
   *                  only by the pin, no hit-stop), or job.sim: a sim already re-timed
   *   job.pin        { x, y } the cup
   *   job.launch     { totalSpin, spinAxis } (the ball's turn)
   *   job.camera     'greenside' | 'topdown' | 'reverse' | null (null: the director's choice for this shot)
   *   job.title, job.kicker, job.sub, job.player { name, slot }, job.kind ('instant' | 'reel' | 'sotm')
   *   job.ballSkin, job.trail   the ball as it was hit (scene.playShot's own options)
   *   onEnd(reason)  'done' the path ran out | 'skip' somebody skipped it | 'cancel' a live ball took over
   * -> true when it started (false: nothing to play, or the scene is not there).
   */
  play(job, { onEnd = null } = {}) {
    const sc = this.scene;
    if (!sc || !sc.geo || typeof sc.playShot !== 'function' || !job) return false;
    if (this.job) this._end('cancel');
    let sim = job.sim || null;
    const pin = job.pin ? (Array.isArray(job.pin) ? { x: job.pin[0], y: job.pin[1] } : { x: job.pin.x, y: job.pin.y }) : (sc.pinSim ? { ...sc.pinSim } : null);
    try { if (!sim && job.raw) sim = replaySim(job.raw, { pin }); } catch (_) { sim = null; }
    if (!sim || !Array.isArray(sim.points) || sim.points.length < 2) return false;
    // which camera: the one asked for, else the director's choice for this shot. The tripod by the green films the
    // arrival only (the last seconds of the flight, then everything): replay-core.js arrivalSim
    const holed = (sim.events || []).some((e) => e && e.type === 'holed');
    const kind = REPLAY_CAMERAS.includes(job.camera) ? job.camera : chooseReplayCamera(sim.points, { pin, flightTime: sim.flightTime, isPutt: !!sim.isPutt, holed, cup: sim.cup || null });
    if (kind === 'greenside') sim = arrivalSim(sim, { pin });
    const token = {};
    const run = { token, onEnd, startedAt: Date.now(), camera: null, title: job.title || 'REPLAY', kicker: job.kicker || '', sub: job.sub || '', player: job.player || null, kind: job.kind || 'instant' };
    const obstacles = sc.props && typeof sc.props.obstacles === 'function' ? sc.props.obstacles() : [];
    // the ground a camera may stand on: the land, or the water's surface over it
    const groundAt = (x, y) => { const h = sc.hAt(x, y); const w = typeof sc.waterLevelAt === 'function' ? sc.waterLevelAt(x, y) : h; return Number.isFinite(w) ? Math.max(h, w) : h; };
    const cameraPlan = (points, env) => {
      const plan = replayCameraPlan(points, { ...env, pin: pin || env.pin, groundAt, obstacles, kind });
      run.camera = plan ? plan.replay : null;
      return plan;
    };
    this.job = run;
    live = this;
    this.count++;
    sc.playShot(sim.points, sim.flightTime, () => { if (this.job === run) this._end('done'); }, {
      isPutt: !!sim.isPutt, events: sim.events,
      toPlayTime: sim.toPlayTime || null,   // (v3:gadgets: a gadget fires on the shot's own clock)
      spinRpm: job.launch?.totalSpin, spinAxisDeg: job.launch?.spinAxis,
      ballSkin: job.ballSkin || null,
      ...(job.trail ? { trail: true, trailColor: job.trail.color, trailHeat: job.trail.heat } : {}),
      cameraPlan,
    });
    this._show(run);
    this._cue('whoosh', { intensity: 0.5 });
    return true;
  }

  /** Somebody wants to move on (a key, a click, a swing): end it now. False when it had only just cut in. */
  skip(by = 'key') {
    const run = this.job;
    if (!run) return false;
    if (by !== 'swing' && Date.now() - run.startedAt < SKIP_GRACE_MS) return false;
    this._end('skip');
    return true;
  }

  /** A live ball is on its way: let go of the picture at once (the new shot takes the scene itself). */
  cancel() {
    if (!this.job) return false;
    this._end('cancel');
    return true;
  }

  _end(reason) {
    const run = this.job;
    if (!run) return;
    this.job = null;
    if (live === this) live = null;
    this.last = { camera: run.camera, title: run.title, reason, kind: run.kind };
    if (reason === 'skip') { try { this.scene.stopShot?.(); } catch (_) { /* gone */ } }
    this._hide();
    if (reason !== 'cancel') this._cue('whoosh', { intensity: 0.35 });
    try { run.onEnd?.(reason); } catch (e) { console.warn('[replay] onEnd', e); }
  }
}

/**
 * A highlight of the reel (lib/highlights.js recordOf, as the 'replay' event carries it) as a
 * job for ReplayDirector.play().
 */
export function jobOfHighlight(h, { camera = null, kind = 'reel' } = {}) {
  if (!h || !h.sim || !Array.isArray(h.sim.points)) return null;
  const points = h.sim.points.map((p) => (Array.isArray(p) ? { t: p[0], x: p[1], y: p[2], z: p[3] } : p)).filter((p) => p && Number.isFinite(p.t));
  if (points.length < 2) return null;
  const where = [h.stage && h.stage.name ? String(h.stage.name).toUpperCase() : '', h.holeNumber != null && h.game && h.game.kind === 'match' ? `HOLE ${h.holeNumber}` : ''].filter(Boolean).join(' · ');
  return {
    raw: { points, flightTime: h.sim.flightTime, isPutt: !!h.sim.isPutt, events: Array.isArray(h.sim.events) ? h.sim.events : [] },
    pin: h.hole && h.hole.pin ? { x: h.hole.pin[0], y: h.hole.pin[1] } : null,
    launch: h.launch || null, camera, kind,
    kicker: kind === 'sotm' || h.shotOfMatch ? 'SHOT OF THE MATCH' : 'HIGHLIGHT',
    title: h.title || 'REPLAY', sub: where, player: h.player || null,
    ballSkin: h.powerup || null,
  };
}

/** A live shot (as app.js plays it: re-timed, with simRaw beside it) as a job. */
export function jobOfShot(shot, { title = null, player = null, sub = '', ballSkin = null, pin = null } = {}) {
  if (!shot || !shot.sim) return null;
  return {
    ...(shot.simRaw ? { raw: shot.simRaw } : { sim: shot.sim }),
    pin, launch: shot.launch || null, camera: null, kind: 'instant',
    kicker: '', title: title || (shot.highlight && shot.highlight.title) || 'REPLAY', sub, player,
    ballSkin, trail: shot.trail || null,
  };
}

export default ReplayDirector;
