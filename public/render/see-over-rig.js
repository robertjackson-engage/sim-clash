// v2:seeover The see-over address camera at work in the scene (arcade only: scene.seeOver.enable).
// see-over.js works out WHERE to stand; this glides the scene's address camera there, and
// does what goes with it:
//   - PASS-THROUGH: the trees (trees.js setFadeLine) and the props (props.js setSeeThrough)
//     standing between the camera and the ball, or over the first 30 m of the shot, are
//     drawn as ghosts; they stand solid again once the shot is away;
//   - FLY-UP: when no pose behind the ball sees the target (a mesa wall, a wood too tall to
//     look over) the camera rises by itself to the view from above and holds there for the
//     swing; the same view on demand (setAbove / toggleAbove: the V key and the VIEW FROM
//     ABOVE button, public/arcade/seeover.js), back down on release or a second press;
//   - the line is drawn through what still hides it (lineup-fx.js setXray), the target
//     carries a beacon, the pin one too when ground hides it, and a target that is off the
//     frame or behind ground gets a marker pinned to the frame ("PIN 142 YD · +50 M ↑").
// Nothing here waits for anything: a shot struck mid-glide hands the camera over to the
// ball cam from wherever it is, with the speed it has (camVel -> flight-camera.js).
import * as THREE from 'three';
import { SEE_OVER, seeOverPose, aboveView, crownField, sightClear, pinToFrame, markerText, ballNdcAbove } from './see-over.js';
import { isPlayFraming } from './framing.js';
import { isNearGreen } from '../map-frame.mjs';

const D2R = Math.PI / 180;
const YD = 0.9144;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wrap180 = (a) => a - 360 * Math.round(a / 360);
const V = (x, y, z) => new THREE.Vector3(x, z, -y);   // sim -> three

export const RIG = Object.freeze({
  omega: 7,              // rad/s: the glide (critically damped: nine tenths of the way in 0.55 s, at rest in a second)
  omegaFly: 4.2,         // ...and between standing and the view from above, a hundred metres away: up in a second and a half
  flyS: 2.6,             // (for this long after the change)
  aimRestS: 0.35,        // the camera changes between standing and the view from above only once the aim has rested this long
  woodM: Object.freeze([30, 14]),   // a line under trees for this many metres is a wood: fly up (and come back down under the second)
  holdS: 0.35,           // the V key held longer than this is a peek: back down on release (a tap toggles)
  checkS: 0.15,          // what is hidden by ground is looked at this often
  liveAfterS: 8,         // back at address with no shot lined up for this long: the camera is ours again anyway
  beaconPerM: 0.22, beaconM: Object.freeze([22, 70]),   // a beacon's height: this much of its distance, between these
  targetColor: 0xffd23a, pinColor: 0xff5a3c,
});

const CSS = `
.so-mark { position: absolute; left: 0; top: 0; z-index: 6; pointer-events: none; white-space: nowrap;
  font: 800 15px/1 system-ui, 'Segoe UI', sans-serif; letter-spacing: 0.04em; color: #fff; padding: 8px 12px 7px;
  border-radius: 10px; background: rgba(14, 16, 20, 0.82); border: 2px solid #ffd23a; box-shadow: 0 3px 14px rgba(0, 0, 0, 0.5);
  font-variant-numeric: tabular-nums; }
.so-mark.pin { border-color: #ff5a3c; }
.so-mark::after { content: ''; position: absolute; left: 50%; top: 100%; margin-left: -7px; border: 7px solid transparent; border-top-color: #ffd23a; }
.so-mark.pin::after { border-top-color: #ff5a3c; }
.so-mark.top::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #ffd23a; }
.so-mark.pin.top::after { border-bottom-color: #ff5a3c; }
.so-mark.left::after, .so-mark.right::after, .so-mark.bottom::after { display: none; }
`;

export class SeeOverRig {
  constructor(scene) {
    this.scene = scene;
    this.on = false;
    this.mode = 'stand';        // 'stand' | 'above': where the camera is going
    this.manual = null;         // the player's own choice for this lie ('above' | 'stand'), over the camera's
    this.hidden = false;        // no pose behind the ball sees the target
    this.onState = null;        // ({ above, auto, hidden }) => void: the HUD's button
    this.s = null;              // the glide: { d, zr, pitch, zoom, yaw } and their speeds
    this.stand = null; this.abv = null;   // the poses last worked out (see-over.js)
    this._vel = { x: 0, y: 0, z: 0 };
    this._marks = null;
    this.live = true;           // false from a shot being struck until the next lie is lined up (the picture holds on the finished shot)
    this.safeBottom = 0;        // the share of the frame's height the HUD covers at the bottom, where the ball is (setSafeBottom)
    this._line = null;
  }

  // The HUD's dock covers the bottom of the screen: the address view keeps the ball above it.
  // frac: the covered share of the frame's height at its middle (public/arcade/seeover.js measures it).
  setSafeBottom(frac) {
    const f = Math.round(clamp(Number(frac) || 0, 0, 0.6) * 200) / 200;
    if (f !== this.safeBottom) { this.safeBottom = f; this._key = null; }
  }

  // the line of the pass-through this frame (scene._frame hands it to props.js setSeeThrough), or null
  passLine() { return this.on ? this._line : null; }

  // A shot is struck (scene.playShot): from here the camera is the ball cam's, then the
  // scene's own return to the ball. The see-over pose waits for the next lie to be lined up
  // (a prediction drawn: onLineup): in a match the picture holds on the finished shot for
  // a couple of seconds first (app.js), and nothing of ours moves the camera under it.
  onShot() { this.live = false; this._liveAt = null; }

  // On for the arcade; off, the address camera and the trees are exactly the plain simulator's.
  enable(on) {
    on = !!on;
    if (on === this.on) return;
    this.on = on;
    const sc = this.scene;
    sc.lineupFx?.setXray(on);
    if (sc._lineupPred) sc.setLineup(sc._lineupPred);   // redrawn with (or without) its x-ray copy
    if (!on) {
      this._line = null;
      sc._treeField?.setFadeLine(null);
      sc.lineupFx?.setBeacons([]);
      this._showMarks(null);
      this.mode = 'stand'; this.manual = null; this.s = null; this._key = null; this._ball = null;
    }
    this._tell();
  }

  get above() { return this.mode === 'above'; }

  // The view from above, on demand: true flies up, false comes back down to the ball; for
  // this lie only (the next ball starts from the camera's own choice again).
  setAbove(on) {
    if (!this.on) return false;
    this.manual = on ? 'above' : 'stand';
    this._aimAt = -1e9;   // at once: this is the player's own move
    this._key = null;
    return this.manual === 'above';
  }

  toggleAbove() { return this.setAbove(!(this.manual ? this.manual === 'above' : this.mode === 'above')); }

  // the address camera's velocity now (sim m/s): the ball cam carries it into the shot
  camVel() { return this.on ? { ...this._vel } : null; }

  _tell() {
    const st = { on: this.on, above: this.on && this.mode === 'above', auto: this.on && this.mode === 'above' && this.manual !== 'above', hidden: this.on && this.hidden };
    const k = `${st.on}|${st.above}|${st.auto}|${st.hidden}`;
    if (k === this._told) return;
    this._told = k;
    this.onState?.(st);
  }

  // what stands on the course for this lie: the trees, and the props tall enough to hide anything
  _crownField() {
    const sc = this.scene;
    const trees = sc._allTreeSpots || sc._placedTrees || null;
    const pv = (sc.props?.version || 0) + 1e6 * (sc.gadgets?.version || 0);   // v3:gadgets (and the gadgets)
    if (this._crowns && this._crownTrees === trees && this._crownProps === pv) return this._crowns;
    this._crownTrees = trees; this._crownProps = pv;
    const list = [];
    for (const t of trees || []) {
      if (!Number.isFinite(t?.x) || !Number.isFinite(t?.y)) continue;
      const g = sc.hAt(t.x, t.y), s = t.s || 1;
      list.push({ x: t.x, y: t.y, r: t.r || 4.5 * s, top: g + (t.h || 14 * s), base: g });
    }
    for (const b of sc.props?.blockers?.(sc.ballSim) || []) list.push(b);
    for (const b of sc.gadgets?.blockers?.(sc.ballSim) || []) list.push(b);   // v3:gadgets a wall, a backboard, a cannon stand in the view like a prop
    this._crowns = crownField(list);
    return this._crowns;
  }

  // What must be seen from this lie along this aim: where the club in hand lands and stops
  // (the prediction, turned with the aim until the next one arrives), two points of the
  // first part of its flight, and the pin when it is within reach. Without a prediction, the pin.
  _targets() {
    const sc = this.scene, b = sc.ballSim, pin = sc.pinSim;
    const pinD = Math.hypot(pin.x - b.x, pin.y - b.y);
    const p = sc._lineupPred;
    const out = { targets: [], far: [], primary: null, pinD };
    if (p && !p.isPutt && Array.isArray(p.path) && p.path.length > 1 && (p.land || p.rest)) {
      const a = ((sc.aimDeg - (sc._lineupAim ?? sc.aimDeg)) || 0) * D2R, c = Math.cos(a), s = Math.sin(a), o = p.path[0];
      const turn = (q) => ({ x: b.x + (q.x - o.x) * c + (q.y - o.y) * s, y: b.y - (q.x - o.x) * s + (q.y - o.y) * c });
      const land = p.land ? turn(p.land) : null, rest = p.rest ? turn(p.rest) : null;
      if (land) out.targets.push(land);
      if (rest) out.targets.push(rest);
      out.primary = rest || land;
      const ft = p.flightTime || 0;
      for (const f of [0.15, 0.35]) {
        const q = p.path.find((k) => k.t >= f * ft);
        if (ft > 0.8 && q && Number.isFinite(q.z)) out.targets.push({ ...turn(q), z: q.z, air: true });
      }
      const reach = (p.totalYd || 0) * YD;
      if (pinD <= reach * 1.08 + 12) out.targets.push({ x: pin.x, y: pin.y, must: false });
      out.far.push(out.primary);
    } else {
      const m = Math.min(pinD, 230), az = sc.aimDeg * D2R;
      out.primary = pinD <= 230 ? { x: pin.x, y: pin.y } : { x: b.x + Math.sin(az) * m, y: b.y + Math.cos(az) * m };
      out.targets.push(out.primary);
    }
    if (pinD < 420) out.far.push({ x: pin.x, y: pin.y });
    return out;
  }

  _solve(az) {
    const sc = this.scene, groundAt = (x, y) => sc.hAt(x, y), crowns = this._crownField();
    const t = this._targets();
    this.primary = t.primary;
    this.stand = seeOverPose({
      ball: sc.ballSim, azDeg: az, targets: t.targets, pin: sc.pinSim, groundAt, crowns,
      base: { dist: sc.orbit.dist, height: sc.orbit.height }, fovDeg: sc._baseFov, zoom0: sc._addressZoom || 1,
      ballNdc: ballNdcAbove(this.safeBottom),
    });
    const woodAt = this.mode === 'above' && this.manual !== 'above' ? RIG.woodM[1] : RIG.woodM[0];
    this.hidden = !this.stand.visible || this.stand.woodedM > woodAt;
    this.abv = this.hidden || this.manual === 'above' || this.mode === 'above'
      ? aboveView({ ball: sc.ballSim, azDeg: az, far: t.far, groundAt, crowns, fovDeg: sc._baseFov, ballNdc: ballNdcAbove(this.safeBottom) }) : null;
  }

  // scene._idleTargets, after the plain address camera's targets are set: the pose that sees, glided to.
  idleTargets(snap = false) {
    const sc = this.scene;
    if (!this.on || !sc.geo || !sc.ballSim) return;
    const now = sc._frameNow ?? 0;
    if (!this.live) {
      // back at address with nothing lined up yet: the plain camera, as ever (and if nothing
      // ever is lined up, a hole that is over, ours again after a while)
      this._liveAt ??= now;
      if (now - this._liveAt < RIG.liveAfterS && now >= this._liveAt) { this._t = null; this._ball = null; this._fromPlain = true; return; }
      this.live = true;
    }
    const dt = this._t == null ? 0 : clamp(now - this._t, 0, 0.05);
    this._t = now;
    const b = sc.ballSim, bz = sc.hAt(b.x, b.y);
    const az = sc.aimDeg + sc.orbit.yaw;
    // a new lie (or a new course): the camera's own choice again, and no glide of ours (the scene's own return to address is the move)
    if (!this._ball || this._geo !== sc.geo || Math.hypot(b.x - this._ball.x, b.y - this._ball.y) > 0.75) {
      this._ball = { x: b.x, y: b.y }; this._geo = sc.geo;
      this.manual = null; this.mode = 'stand'; this._key = null; this._aimAt = -1e9;
      this._lieAt = now;
      if (this._fromPlain && !snap && this.s) {
        // ours again after a shot: the glide starts from the plain camera the scene has been holding
        const bz0 = sc.hAt(b.x, b.y);
        Object.assign(this.s, { d: sc.orbit.dist, zr: sc.camPosT.y - bz0, pitch: Math.atan2(sc.camPosT.y - sc.lookT.y, 80), zoom: sc._addressZoom || 1, yaw: 0, v: {} });
      } else snap = true;
      this._fromPlain = false;
    }
    const key = [b.x.toFixed(2), b.y.toFixed(2), az.toFixed(2), sc.orbit.dist.toFixed(1), sc.orbit.height.toFixed(1),
      sc.pinSim.x.toFixed(1), sc.pinSim.y.toFixed(1), this._predRev || 0, sc.props?.version || 0, this.manual || '', (sc._addressZoom || 1).toFixed(3), this.safeBottom].join('|');
    if (key !== this._key) {
      if (this._az != null && Math.abs(wrap180(az - this._az)) > 1e-6 && !snap) this._aimAt = now;
      this._az = az;
      this._key = key;
      this._solve(az);
    }
    // standing, or up: the player's choice, else up only when nothing behind the ball sees the target
    // (by itself only once the shot is lined up: with no prediction drawn the target is a guess, and the camera does not fly up on a guess)
    const sure = !!sc._lineupPred;
    const want = this.manual || (this.hidden && sure && this.abv && this.abv.visible ? 'above' : 'stand');
    if (want !== this.mode && (snap || this.manual || now - (this._aimAt ?? -1e9) >= RIG.aimRestS)) {
      this.mode = want;
      if (!snap) this._flyAt = now;
      if (want === 'above' && !this.abv) this._key = null;   // worked out next frame
      else this._solve(az);   // (the wood's own hysteresis follows the mode)
    }
    const pose = this.mode === 'above' && this.abv ? this.abv : this.stand;
    const goal = { d: pose.d, zr: pose.z - bz, pitch: pose.pitch, zoom: pose.zoom, yaw: pose.above ? wrap180(pose.azDeg - az) : 0 };
    const s = (this.s ||= { v: {} });
    for (const k of ['d', 'zr', 'pitch', 'zoom', 'yaw']) {
      if (snap || s[k] == null || !(dt > 0)) { if (snap || s[k] == null) { s[k] = goal[k]; s.v[k] = 0; } continue; }
      const w = this._flyAt != null && now >= this._flyAt && now - this._flyAt < RIG.flyS ? RIG.omegaFly : RIG.omega;
      s.v[k] = (s.v[k] || 0) + (w * w * (goal[k] - s[k]) - 2 * w * (s.v[k] || 0)) * dt;
      s[k] += s.v[k] * dt;
    }
    const a = (az + s.yaw) * D2R, ux = Math.sin(a), uy = Math.cos(a);
    const cx = b.x - ux * s.d, cy = b.y - uy * s.d;
    const cz = Math.max(sc.hAt(cx, cy) + SEE_OVER.clearM, bz + s.zr);
    // on the way (the camera rises faster than it pitches): the ball never drops out of the bottom of the frame
    const lowest = Math.atan2(cz - bz, s.d) - Math.atan(Math.min(0.9, ballNdcAbove(this.safeBottom) + 0.12) * Math.tan((sc._baseFov / 2) * D2R) / Math.max(1, s.zoom));
    if (s.pitch < lowest) { s.pitch = lowest; s.v.pitch = Math.max(0, s.v.pitch || 0); }
    sc.camPosT.copy(V(cx, cy, cz));
    sc.lookT.copy(V(cx + ux * 80, cy + uy * 80, cz - Math.tan(s.pitch) * 80));
    sc._addressZoom = s.zoom;
    this._tell();
  }

  // a new prediction is drawn (scene.setLineup): what must be seen may have moved; and the
  // next lie is being lined up, so the address camera is ours again
  onLineup(pred) {
    this._predRev = (this._predRev || 0) + 1;
    if (pred) this.live = true;
  }

  // scene._frame, once the camera is placed: the pass-through, the beacons, the markers.
  frame(dt) {
    const sc = this.scene;
    if (!this.on) return;
    const cp = sc.camera.position, cam = { x: cp.x, y: -cp.z, z: cp.y };
    // how fast the camera is moving (averaged over a few frames)
    if (this._last && dt > 1e-4) {
      const k = Math.min(1, dt / 0.05);
      for (const ax of ['x', 'y', 'z']) this._vel[ax] += ((cam[ax] - this._last[ax]) / dt - this._vel[ax]) * k;
    } else if (!(dt > 1e-4)) this._vel = { x: 0, y: 0, z: 0 };
    this._last = cam;
    const play = this.live && !!sc.geo && !!sc.ballSim && isPlayFraming(sc.camMode, sc.anim);
    if (!play) {
      // a shot is away (or a flyover, the free camera): everything stands solid again, nothing of ours is drawn
      this._line = null;
      sc._treeField?.setFadeLine(null);
      sc.lineupFx?.setBeacons([]);
      this._showMarks(null);
      return;
    }
    const b = sc.ballSim, bz = sc.hAt(b.x, b.y);
    const hx = b.x - cam.x, hy = b.y - cam.y, d = Math.hypot(hx, hy);
    // pass-through: along the line from the camera through the ball and aheadM on; not from
    // high above (nothing stands between a camera overhead and the ball but leaves)
    let line = null;
    if (d > 2 && Math.atan2(cam.z - bz, d) < 55 * D2R) {
      const ux = hx / d, uy = hy / d, ahead = SEE_OVER.fadeAheadM;
      line = { x: cam.x, y: cam.y, ux, uy, d, aheadM: ahead, camZ: cam.z, ballZ: bz, endZ: sc.hAt(b.x + ux * ahead, b.y + uy * ahead) };
    }
    this._line = line;   // (the props: scene._frame, props.js setSeeThrough)
    sc._treeField?.setFadeLine(line ? { x: line.x, z: -line.y, ux: line.ux, uz: -line.uy, d: line.d, len: line.d + line.aheadM, camY: line.camZ, ballY: line.ballZ, endY: line.endZ } : null);

    // what the ground hides from where the camera is now (looked at a few times a second)
    const now = sc._frameNow ?? 0, pin = sc.pinSim, p = sc._lineupPred;
    const pinD = Math.hypot(pin.x - b.x, pin.y - b.y);
    const full = !!p && !p.isPutt && !isNearGreen(pinD / YD, false) && !!p.rest;
    const tgt = full ? p.rest : null;   // the crosshair the lineup draws (lineup-fx.js)
    if (this._seenAt == null || now < this._seenAt || now - this._seenAt >= RIG.checkS) {
      this._seenAt = now;
      const g = (x, y) => sc.hAt(x, y);
      this._pinHid = !sightClear(cam, { x: pin.x, y: pin.y, z: g(pin.x, pin.y) + 1.2 }, g, 0.15);
      this._tgtHid = !!tgt && !sightClear(cam, { x: tgt.x, y: tgt.y, z: g(tgt.x, tgt.y) + 0.6 }, g, 0.15);
    }
    const beacons = [];
    const tall = (m) => clamp(RIG.beaconPerM * m, RIG.beaconM[0], RIG.beaconM[1]);
    if (tgt) beacons.push({ x: tgt.x, y: tgt.y, heightM: tall(Math.hypot(tgt.x - b.x, tgt.y - b.y)), color: RIG.targetColor });
    if (this._pinHid && pinD > 12) beacons.push({ x: pin.x, y: pin.y, heightM: tall(pinD), color: RIG.pinColor });
    sc.lineupFx?.setBeacons(beacons);

    // markers: for a target that is off the frame or behind ground
    const marks = [];
    const add = (cls, name, q, hid) => {
      const gz = sc.hAt(q.x, q.y);
      const v = V(q.x, q.y, gz + 1).project(sc.camera);
      const w = sc.container.clientWidth, h = sc.container.clientHeight;
      const at = pinToFrame({ x: v.x, y: v.y, depth: v.z < 1 ? 1 : -1 }, w, h);
      if (!hid && !at.edge) return;
      marks.push({ cls, text: markerText(name, Math.hypot(q.x - b.x, q.y - b.y), gz - bz), x: at.x, y: at.edge ? at.y : Math.max(84, at.y - 40), edge: at.edge });
    };
    if (tgt) add('target', 'TARGET', tgt, this._tgtHid);
    if (pinD > 12) add('pin', 'PIN', pin, this._pinHid);
    if (marks.length === 2 && Math.abs(marks[0].x - marks[1].x) < 230 && Math.abs(marks[0].y - marks[1].y) < 38) marks[1].y = Math.max(46, marks[0].y - 40);
    this._showMarks(marks);
  }

  _showMarks(marks) {
    const sc = this.scene;
    if (!marks || !marks.length) {
      if (this._marks) for (const el of Object.values(this._marks)) el.style.display = 'none';
      return;
    }
    if (!this._marks) {
      if (typeof document === 'undefined' || !sc.markerLayer) return;
      if (!document.getElementById('so-style')) {
        const st = Object.assign(document.createElement('style'), { id: 'so-style', textContent: CSS });
        document.head.appendChild(st);
      }
      this._marks = {};
      for (const cls of ['target', 'pin']) {
        const el = Object.assign(document.createElement('div'), { className: `so-mark ${cls}` });
        el.style.display = 'none';
        sc.markerLayer.appendChild(el);
        this._marks[cls] = el;
      }
    }
    for (const [cls, el] of Object.entries(this._marks)) {
      const m = marks.find((k) => k.cls === cls);
      if (!m) { el.style.display = 'none'; continue; }
      if (el.textContent !== m.text) el.textContent = m.text;
      el.className = `so-mark ${cls}${m.edge ? ` ${m.edge}` : ''}`;
      el.style.display = '';
      el.style.transform = `translate(-50%,-100%) translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
    }
  }
}
