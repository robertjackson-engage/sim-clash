// Course gadgets, the client's pure part (v3:gadgets; docs/gadgets.md). No three.js here:
// the look table, the reaction timeline of a shot, a geyser's cycle in playback time, the
// camera's obstacle lists, the map shapes and the HUD's summary. public/render/gadgets.js
// draws them; public/aim-map.js, the stage intro and the tests read this file directly.
//
// The data is lib/gadgets.js's (course.gadgets, as /api/course-geometry sends it): x east,
// y north, z up, headings compass degrees (0 north, 90 east). Every contact of a shot is a
// { type: 'gadget', id, kind, t, x, y, z, effect } in shot.sim.events, in playback time.

const RAD = Math.PI / 180;

// How each kind reads: its name on the HUD, a two-colour scheme (CSS hex) and the glyph of
// its map icon and beacon.
export const GADGET_LOOK = Object.freeze({
  ring: { label: 'Boost ring', short: 'BOOST', color: '#ffb21f', glow: '#ff7a1a', glyph: 'ring' },
  pad: { label: 'Bounce pad', short: 'PAD', color: '#ff4fd8', glow: '#ff9bf0', glyph: 'pad' },
  strip: { label: 'Speed strip', short: 'SPEED', color: '#27e0ff', glow: '#9ff3ff', glyph: 'chevron' },
  fan: { label: 'Wind tunnel', short: 'FAN', color: '#9fe8ff', glow: '#ffffff', glyph: 'fan' },
  geyser: { label: 'Geyser', short: 'GEYSER', color: '#6fd2ff', glow: '#e8fbff', glyph: 'geyser' },
  bumper: { label: 'Bumper', short: 'BUMPER', color: '#ff3b5c', glow: '#ffd21f', glyph: 'bumper' },
  rail: { label: 'Rail', short: 'RAIL', color: '#ff3b5c', glow: '#ffd21f', glyph: 'rail' },
  backboard: { label: 'Backboard', short: 'BOARD', color: '#e9f1ff', glow: '#ff5a2a', glyph: 'board' },
  funnel: { label: 'Funnel', short: 'FUNNEL', color: '#b48cff', glow: '#e3d4ff', glyph: 'funnel' },
  ice: { label: 'Ice patch', short: 'ICE', color: '#bfeaff', glow: '#ffffff', glyph: 'ice' },
  mud: { label: 'Sticky mud', short: 'MUD', color: '#8a5a33', glow: '#c8935a', glyph: 'mud' },
  warp: { label: 'Warp', short: 'WARP', color: '#35e06a', glow: '#b6ffcb', glyph: 'warp' },
  'warp-exit': { label: 'Warp exit', short: 'EXIT', color: '#35e06a', glow: '#b6ffcb', glyph: 'warp' },
  breakable: { label: 'Breakable', short: 'SMASH', color: '#ff8a3c', glow: '#ffe08a', glyph: 'wall' },
  coins: { label: 'Coin trail', short: 'COINS', color: '#ffd21f', glow: '#fff3a8', glyph: 'coin' },
  zone: { label: 'Multiplier', short: 'MULTI', color: '#7dff5a', glow: '#eaffb0', glyph: 'zone' },
});
export const GADGET_KINDS = Object.freeze(Object.keys(GADGET_LOOK));
const BREAK_NAMES = Object.freeze({ wall: 'Wall', crate: 'Crates', 'ice-wall': 'Ice wall', snowman: 'Snowman', pinata: 'Pinata' });

// The standing kinds a camera must not fly through and the pass-through view fades.
const TALL = Object.freeze(new Set(['bumper', 'rail', 'backboard', 'breakable', 'fan', 'warp', 'warp-exit', 'geyser', 'ring']));

// ---------------------------------------------------------------- audio
// The cue a contact asks for (the names the sound stream records; none exists yet and a
// missing one is silent). Null: nothing to play.
export const GADGET_CUES = Object.freeze(['gadget-ring', 'gadget-pad', 'gadget-bumper', 'gadget-break', 'gadget-coin', 'gadget-warp', 'gadget-geyser', 'gadget-strip', 'gadget-fan', 'gadget-zone', 'gadget-thud']);
export const COIN_CUE_GAP_MS = 80;
export function cueFor(ev) {
  if (!ev || typeof ev !== 'object') return null;
  switch (ev.kind) {
    case 'ring': return 'gadget-ring';
    case 'pad': return 'gadget-pad';
    case 'bumper': case 'rail': return 'gadget-bumper';
    case 'breakable': return ev.effect === 'smash' ? 'gadget-break' : 'gadget-thud';
    case 'backboard': case 'mud': return 'gadget-thud';
    case 'coins': return 'gadget-coin';
    case 'warp': case 'warp-exit': return 'gadget-warp';
    case 'geyser': return 'gadget-geyser';
    case 'strip': return 'gadget-strip';
    case 'fan': return 'gadget-fan';
    case 'zone': return 'gadget-zone';
    default: return null;   // ice, a funnel: no sound of their own
  }
}
// How hard a cue is played, 0..1 (a full trail and a smash are the loud ones).
export function cueIntensity(ev) {
  if (!ev) return 0.7;
  if (ev.kind === 'coins') return ev.effect === 'full' ? 1 : 0.55;
  if (ev.kind === 'breakable') return ev.effect === 'smash' ? 1 : 0.7;
  if (ev.kind === 'zone') return ev.mult === 3 ? 1 : 0.8;
  if (ev.kind === 'warp-exit') return 0.9;
  return 0.8;
}
/**
 * A gate that lets a coin cue through at most once every COIN_CUE_GAP_MS (a trail of seven
 * coins taken in a third of a second is three or four chimes, not a chord). Every other cue
 * passes; a full trail's always does.
 * @returns {(ev, nowMs) => string | null} the cue to play now, or null
 */
export function cueGate(gapMs = COIN_CUE_GAP_MS) {
  let last = -Infinity;
  return (ev, nowMs) => {
    const name = cueFor(ev);
    if (!name) return null;
    if (name !== 'gadget-coin' || ev.effect === 'full') { if (name === 'gadget-coin') last = nowMs; return name; }
    if (nowMs - last < gapMs) return null;
    last = nowMs;
    return name;
  };
}

// ---------------------------------------------------------------- a shot's reactions
/**
 * The gadget contacts of a shot in the order they play: [{ t, id, kind, effect, x, y, z, ev }]
 * (ev: the event as it came, with its extras). Events without a time or an id are dropped.
 */
export function gadgetTimeline(events) {
  const out = [];
  for (const [i, e] of (Array.isArray(events) ? events : []).entries()) {
    if (!e || e.type !== 'gadget' || typeof e.id !== 'string' || !Number.isFinite(e.t)) continue;
    out.push({ t: e.t, i, id: e.id, kind: e.kind, effect: e.effect, x: +e.x || 0, y: +e.y || 0, z: +e.z || 0, ev: e });
  }
  return out.sort((a, b) => a.t - b.t || a.i - b.i);
}

/** The stretches of a shot the ball is inside a warp: [{ t0, t1, from, to }] (playback time). */
export function warpWindows(timeline) {
  const out = [];
  for (const r of timeline || []) {
    if (r.kind !== 'warp' || r.effect !== 'in') continue;
    const exit = timeline.find((q) => q.kind === 'warp-exit' && q.effect === 'out' && q.t >= r.t && (q.ev.from === r.id || q.id === r.ev.to));
    out.push({ t0: r.t, t1: exit ? exit.t : r.t + 0.7, from: r.id, to: exit ? exit.id : (r.ev.to || null) });
  }
  return out;
}
export const ballHiddenAt = (windows, t) => (windows || []).some((w) => t >= w.t0 && t < w.t1);

/**
 * A geyser's eruptions during a shot, in playback time. It fires in SHOT time at
 * offset + k * cycle for `burst` seconds, from the shot's time zero; toPlayTime (arcade/feel.js
 * warpShot: slow motion and fast-forward re-time the picture, never the shot) maps that onto
 * the clock the picture plays on. Stops at the end of the shot (playDur).
 * @returns {Array<{ t0, t1 }>}
 */
export function geyserWindows(g, { toPlayTime = null, playDur = Infinity } = {}) {
  const out = [];
  const cycle = Number(g && g.cycle), burst = Number(g && g.burst), offset = Number(g && g.offset) || 0;
  if (!(cycle > 0) || !(burst > 0)) return out;
  const map = typeof toPlayTime === 'function' ? toPlayTime : (t) => t;
  for (let k = 0; k < 64; k++) {
    const s0 = offset + k * cycle;
    const t0 = map(s0), t1 = map(s0 + burst);
    if (!(t0 < playDur - 1e-6) || !(t1 > t0)) break;   // past the shot's end (toPlayTime holds at its last sample)
    out.push({ t0, t1: Math.min(t1, playDur) });
  }
  return out;
}

/**
 * What a geyser is doing at playback time t: { on, k, pressure }. on: erupting, k 0..1
 * through the eruption; pressure 0..1: how near the next eruption is (it climbs over the
 * quiet part of the cycle, so the vent visibly builds before it fires). With no windows
 * (no shot in the air) it simmers: pressure 0.15.
 */
export function geyserState(windows, t) {
  if (!windows || !windows.length || !Number.isFinite(t)) return { on: false, k: 0, pressure: 0.15 };
  let prevEnd = 0;
  for (const w of windows) {
    if (t >= w.t0 && t < w.t1) return { on: true, k: (t - w.t0) / (w.t1 - w.t0), pressure: 1 };
    if (t < w.t0) return { on: false, k: 0, pressure: Math.max(0.15, Math.min(1, (t - prevEnd) / Math.max(1e-6, w.t0 - prevEnd))) };
    prevEnd = w.t1;
  }
  return { on: false, k: 0, pressure: 0.15 };
}

// ---------------------------------------------------------------- shapes
const dirOf = (deg) => ({ x: Math.sin((deg || 0) * RAD), y: Math.cos((deg || 0) * RAD) });

/** The circle a gadget stands or acts in, on the map: { x, y, r } (lib/gadgets.js footprint). */
export function gadgetFootprint(g) {
  if (Array.isArray(g.points) && g.points.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of g.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 + (g.radius || g.reach || 0) };
  }
  if (Array.isArray(g.size)) {
    const thin = g.kind === 'backboard' || g.kind === 'breakable';
    return { x: g.x, y: g.y, r: Math.hypot(g.size[0], thin ? 1.5 : g.size[1]) / 2 };
  }
  return { x: g.x, y: g.y, r: g.radius || 1.5 };
}

/**
 * A gadget's outline on the ground, for the map: { closed, points: [[x, y], ...] }. A ring,
 * a wall and a backboard are the line they stand on; a rail and a coin trail their own line.
 */
export function gadgetOutline(g, n = 24) {
  if (Array.isArray(g.points)) return { closed: false, points: g.points.map((p) => [p[0], p[1]]) };
  const d = dirOf(g.heading), rt = { x: d.y, y: -d.x };
  const across = (h) => ({ closed: false, points: [[g.x - rt.x * h, g.y - rt.y * h], [g.x + rt.x * h, g.y + rt.y * h]] });
  if (g.kind === 'ring') return across(g.radius || 6);
  if (Array.isArray(g.size) && (g.kind === 'backboard' || g.kind === 'breakable')) return across(g.size[0] / 2);
  if (Array.isArray(g.size)) {
    const w = g.size[0] / 2, l = g.size[1] / 2;
    return { closed: true, points: [[-w, -l], [w, -l], [w, l], [-w, l]].map(([a, b]) => [g.x + rt.x * a + d.x * b, g.y + rt.y * a + d.y * b]) };
  }
  const r = g.radius || 1.5, pts = [];
  for (let k = 0; k < n; k++) pts.push([g.x + r * Math.cos((k / n) * 2 * Math.PI), g.y + r * Math.sin((k / n) * 2 * Math.PI)]);
  return { closed: true, points: pts };
}

// how tall a standing gadget is drawn (m above its base), and where its base is
function standing(g, hAt) {
  const ground = hAt(g.x, g.y);
  switch (g.kind) {
    case 'bumper': return { base: ground, top: ground + (g.height || 3.5) + 1 };
    case 'rail': return { base: ground, top: ground + (g.height || 1.6) };
    case 'backboard': return { base: ground, top: ground + g.size[1] + 0.6 };
    case 'breakable': {
      if (Array.isArray(g.size)) { const foot = Number.isFinite(g.z) ? g.z : ground; return { base: foot, top: foot + g.size[1] }; }   // (a wall may hang in the air)
      const base = Number.isFinite(g.z) ? g.z : ground;
      return { base, top: base + (g.height || 4) };
    }
    case 'fan': { const base = Number.isFinite(g.z) ? g.z : ground; return { base, top: base + Math.min(g.size[2], 14) }; }
    case 'warp': case 'warp-exit': { const z = Number.isFinite(g.z) ? g.z : ground; return { base: Math.min(z, ground), top: Math.max(z, ground) + (g.radius || 3) + 2.5 }; }
    case 'ring': return { base: g.z - g.radius, top: g.z + g.radius };
    case 'geyser': return { base: ground, top: ground + 2 };
    default: return null;
  }
}

/**
 * Every gadget that stands or hangs, as upright cylinders [{ id, x, y, r, base, top }]
 * (course metres), in the shape of PropsLayer.obstacles(): for a camera that flies by
 * itself. A wall is a row of them along its width, a rail one a stretch of its line, a ring
 * the pieces of its rim (marked `hoop`: the hole through it is open).
 */
export function gadgetObstacles(gadgets, hAt) {
  const out = [];
  for (const g of gadgets || []) {
    if (!g || !TALL.has(g.kind)) continue;
    const s = standing(g, hAt);
    if (!s) continue;
    if (g.kind === 'rail') {
      for (let i = 0; i + 1 < g.points.length; i++) {
        const [ax, ay] = g.points[i], [bx, by] = g.points[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
        for (let k = 0; k <= n; k++) { const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n, z = hAt(x, y); out.push({ id: g.id, x, y, r: (g.radius || 0.7) + 0.5, base: z, top: z + (g.height || 1.6) }); }
      }
      continue;
    }
    const wide = g.kind === 'ring' ? g.radius : Array.isArray(g.size) && (g.kind === 'backboard' || g.kind === 'breakable') ? g.size[0] / 2 : 0;
    if (wide > 1.5) {
      const d = dirOf(g.heading), rt = { x: d.y, y: -d.x };
      const r = g.kind === 'ring' ? 1.5 : 1.2, n = Math.max(1, Math.ceil(wide / 2.5));
      for (let k = -n; k <= n; k++) {
        const u = (wide * k) / n;
        // a ring is a hoop: its rim is in the way, the hole through it is not
        if (g.kind === 'ring') {
          const half = Math.sqrt(Math.max(0, g.radius * g.radius - u * u));
          if (Math.abs(k) === n) out.push({ id: g.id, x: g.x + rt.x * u, y: g.y + rt.y * u, r, base: g.z - 1.5, top: g.z + 1.5, hoop: true });
          else { out.push({ id: g.id, x: g.x + rt.x * u, y: g.y + rt.y * u, r, base: g.z + half - 1.2, top: g.z + half + 1.2, hoop: true }); out.push({ id: g.id, x: g.x + rt.x * u, y: g.y + rt.y * u, r, base: g.z - half - 1.2, top: g.z - half + 1.2, hoop: true }); }
        } else out.push({ id: g.id, x: g.x + rt.x * u, y: g.y + rt.y * u, r, base: s.base, top: s.top });
      }
      continue;
    }
    const f = gadgetFootprint(g);
    out.push({ id: g.id, x: g.x, y: g.y, r: g.kind === 'fan' ? Math.min(g.size[0], 12) / 2 : g.kind === 'geyser' ? g.radius : Math.max(1, Math.min(f.r, 6)), base: s.base, top: s.top });
  }
  return out;
}

/**
 * What stands on the course for the address camera (see-over.js crownField), in the shape of
 * PropsLayer.blockers(): discs { x, y, r, top, base, solid } for every gadget at least minH
 * tall that stands on the ground. A ring in the air hides nothing and is left out.
 */
export function gadgetBlockers(gadgets, hAt, minH = 2.5) {
  const out = [];
  for (const o of gadgetObstacles((gadgets || []).filter((g) => g && g.kind !== 'ring' && g.kind !== 'geyser'), hAt)) {
    if (o.top - o.base < minH) continue;
    out.push({ x: o.x, y: o.y, r: o.r, top: o.top, base: o.base, solid: true });
  }
  return out;
}

/**
 * The highest gadget top over (x, y), or -Infinity in the open: the height a ball cam must
 * stay above there. A ring's rim (`hoop`) is left out: a hoop is flown THROUGH, and a ceiling
 * over it would lift the camera out of the very thing the ball is going through.
 */
export function gadgetCeiling(obstacles, marginM = 1.5) {
  const list = (obstacles || []).filter((o) => !o.hoop);
  if (!list.length) return null;
  return (x, y) => {
    let top = -Infinity;
    for (const o of list) {
      const ex = x - o.x, ey = y - o.y, r = o.r + marginM;
      if (ex * ex + ey * ey <= r * r && o.top > top) top = o.top;
    }
    return top;
  };
}

// ---------------------------------------------------------------- the HUD
/**
 * The gadgets of a stage as the HUD lists them: [{ kind, label, short, color, count, note }]
 * in the order a player meets the kinds (a warp and its exit are one; a wall says its speed).
 */
export function gadgetSummary(gadgets) {
  const rows = new Map();
  for (const g of Array.isArray(gadgets) ? gadgets : []) {
    if (!g || !GADGET_LOOK[g.kind] || g.kind === 'warp-exit') continue;
    const look = GADGET_LOOK[g.kind];
    let key = g.kind, label = look.label, note = '';
    if (g.kind === 'breakable') {
      label = BREAK_NAMES[g.style] || look.label;
      note = Number.isFinite(g.breakMph) ? `${Math.round(g.breakMph)} mph` : '';
      key = `breakable:${g.style || 'wall'}:${note}`;
    } else if (g.kind === 'zone') { note = `x${g.mult === 3 ? 3 : 2}`; key = `zone:${note}`; }
    else if (g.kind === 'warp') { label = g.style === 'cannon' ? 'Cannon' : 'Warp pipe'; key = `warp:${g.style || 'pipe'}`; }
    const row = rows.get(key) || { kind: g.kind, label, short: look.short, color: look.color, count: 0, note };
    row.count++;
    rows.set(key, row);
  }
  return [...rows.values()];
}
/** One line for a chip: "Boost ring · Wall 150 mph · 2 Bumpers". */
export function gadgetSummaryText(gadgets) {
  return gadgetSummary(gadgets).map((r) => `${r.count > 1 ? `${r.count} ` : ''}${r.label}${r.count > 1 && !/s$/.test(r.label) ? 's' : ''}${r.note ? ` ${r.note}` : ''}`).join(' · ');
}

// How thick a ring's rim is drawn (m): thicker the farther it hangs from the tee, so a hoop
// 250 m out still reads as a hoop.
export const ringTubeM = (distM) => Math.max(0.45, Math.min(1.6, 0.45 + (Number(distM) || 0) / 260));
// The scale of an accent (a beacon, a number) by its distance from the tee.
export const farScale = (distM) => Math.max(1, Math.min(2.4, 1 + (Number(distM) || 0) / 240));

// ---------------------------------------------------------------- glyphs
/**
 * A kind's glyph on a 2D canvas (the map icons, the legend, the beacons over the gadgets):
 * drawn about (cx, cy) inside a square of side 2 s, in one colour. Canvas calls only.
 */
export function drawGadgetGlyph(ctx, glyph, cx, cy, s, color = '#ffffff') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.26); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = (pts, close = false) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s))); if (close) ctx.closePath(); };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2); };
  switch (glyph) {
    case 'ring': circle(0, 0, 0.72); ctx.stroke(); line([[-0.22, 0.12], [0, -0.18], [0.22, 0.12]]); ctx.stroke(); break;
    case 'pad': line([[-0.8, 0.62], [0.8, 0.62]]); ctx.stroke(); line([[0, 0.3], [0, -0.75]]); ctx.stroke(); line([[-0.38, -0.36], [0, -0.78], [0.38, -0.36]]); ctx.stroke(); break;
    case 'chevron': line([[-0.6, 0.15], [0, -0.45], [0.6, 0.15]]); ctx.stroke(); line([[-0.6, 0.72], [0, 0.12], [0.6, 0.72]]); ctx.stroke(); break;
    case 'fan':
      for (let k = 0; k < 3; k++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.ellipse(0, -0.44 * s, 0.2 * s, 0.42 * s, 0.35, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'geyser': line([[-0.3, 0.8], [0, -0.85], [0.3, 0.8]], true); ctx.fill(); circle(-0.6, -0.2, 0.12); ctx.fill(); circle(0.62, -0.38, 0.12); ctx.fill(); break;
    case 'bumper': circle(0, 0, 0.74); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; circle(0, 0, 0.44); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; circle(0, 0, 0.2); ctx.fill(); break;
    case 'rail': ctx.beginPath(); ctx.moveTo(-0.8 * s, 0.4 * s); ctx.bezierCurveTo(-0.3 * s, -0.9 * s, 0.3 * s, 0.9 * s, 0.8 * s, -0.4 * s); ctx.stroke(); break;
    case 'board': ctx.strokeRect(-0.74 * s, -0.56 * s, 1.48 * s, 1.0 * s); ctx.strokeRect(-0.26 * s, -0.12 * s, 0.52 * s, 0.4 * s); line([[0, 0.44], [0, 0.85]]); ctx.stroke(); break;
    case 'funnel': line([[-0.8, -0.6], [0.8, -0.6], [0.16, 0.2], [0.16, 0.8], [-0.16, 0.8], [-0.16, 0.2]], true); ctx.fill(); break;
    case 'ice':
      for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI / 3); line([[0, -0.8], [0, 0.8]]); ctx.stroke(); }
      break;
    case 'mud': ctx.beginPath(); ctx.ellipse(0, 0.25 * s, 0.82 * s, 0.4 * s, 0, 0, Math.PI * 2); ctx.fill(); circle(-0.3, -0.38, 0.17); ctx.fill(); circle(0.36, -0.52, 0.12); ctx.fill(); break;
    case 'warp': ctx.fillRect(-0.74 * s, -0.8 * s, 1.48 * s, 0.5 * s); ctx.fillRect(-0.54 * s, -0.3 * s, 1.08 * s, 1.1 * s); break;
    case 'wall':
      ctx.lineWidth = Math.max(1, s * 0.16);
      ctx.strokeRect(-0.8 * s, -0.6 * s, 1.6 * s, 1.2 * s);
      line([[-0.8, 0], [0.8, 0]]); ctx.stroke(); line([[0, -0.6], [0, 0]]); ctx.stroke(); line([[-0.4, 0], [-0.4, 0.6]]); ctx.stroke(); line([[0.4, 0], [0.4, 0.6]]); ctx.stroke();
      break;
    case 'coin': circle(0, 0, 0.74); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(-0.09 * s, -0.42 * s, 0.18 * s, 0.84 * s); ctx.globalCompositeOperation = 'source-over'; break;
    case 'zone': circle(0, 0, 0.78); ctx.stroke(); line([[-0.3, -0.3], [0.3, 0.3]]); ctx.stroke(); line([[0.3, -0.3], [-0.3, 0.3]]); ctx.stroke(); break;
    default: circle(0, 0, 0.5); ctx.fill(); break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the lineup
/**
 * The gadgets a shot along an aim line could meet (lib/gadgets.js gadgetsAhead, for the map
 * when the server's prediction is not in yet): those within halfWidthM of the line and no
 * farther than reachM along it, nearest first: [{ id, kind, short, distYd, offlineYd }].
 */
export function gadgetsNearLine(gadgets, from, aimDeg, { reachM = 400, halfWidthM = 30 } = {}) {
  const out = [];
  if (!from || !Number.isFinite(aimDeg)) return out;
  const dx = Math.sin(aimDeg * RAD), dy = Math.cos(aimDeg * RAD);
  for (const g of Array.isArray(gadgets) ? gadgets : []) {
    if (!g || !GADGET_LOOK[g.kind] || g.kind === 'warp-exit') continue;
    const f = gadgetFootprint(g);
    const al = (f.x - from.x) * dx + (f.y - from.y) * dy, lat = (f.x - from.x) * dy - (f.y - from.y) * dx;
    if (al < 2 - f.r || al > reachM + f.r || Math.abs(lat) > halfWidthM + f.r) continue;
    out.push({ id: g.id, kind: g.kind, short: GADGET_LOOK[g.kind].short, distYd: Math.round(al / 0.9144), offlineYd: Math.round(lat / 0.9144) });
  }
  return out.sort((a, b) => a.distYd - b.distYd);
}

/**
 * What the lineup shows about gadgets for the club in hand: the ones the predicted shot
 * MEETS (the server's prediction says so: pred.gadgets.hits; its path already shows what
 * they do), and the others near the aim line (the server's pred.gadgets.ahead, else worked
 * out here). Rows { id, kind, short, distYd, hit }, nearest first. Empty with no gadgets.
 */
export function lineupGadgets(gadgets, pred, from, aimDeg) {
  if (!Array.isArray(gadgets) || !gadgets.length) return [];
  const rows = [], seen = new Set();
  const pg = pred && pred.gadgets ? pred.gadgets : null;
  for (const h of (pg && Array.isArray(pg.hits) ? pg.hits : [])) {
    if (!h || seen.has(h.id) || !GADGET_LOOK[h.kind] || h.kind === 'warp-exit') continue;
    seen.add(h.id);
    const d = from ? Math.hypot(h.x - from.x, h.y - from.y) / 0.9144 : 0;
    rows.push({ id: h.id, kind: h.kind, short: GADGET_LOOK[h.kind].short, distYd: Math.round(d), hit: true });
  }
  const reachM = pred && Number.isFinite(pred.totalYd) ? pred.totalYd * 0.9144 * 1.15 + 20 : 400;
  const ahead = pg && Array.isArray(pg.ahead) ? pg.ahead : gadgetsNearLine(gadgets, from, aimDeg, { reachM, halfWidthM: 25 });
  for (const a of ahead) {
    if (!a || seen.has(a.id) || !GADGET_LOOK[a.kind]) continue;
    seen.add(a.id);
    rows.push({ id: a.id, kind: a.kind, short: GADGET_LOOK[a.kind].short, distYd: Math.round(a.distYd), hit: false });
  }
  return rows.sort((p, q) => p.distYd - q.distYd);
}
