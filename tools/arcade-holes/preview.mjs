#!/usr/bin/env node
// Top-down map of each arcade course as the GAME sees it (surface under every metre,
// shaded by the terrain), for checking a design without starting the app:
//   node tools/arcade-holes/preview.mjs [--out <dir>] [--only <id>] [--scale <px per m>]
// Writes <dir>/<id>.png (default dir: <repo>/.shots/arcade-holes, which git ignores).
// Every course in the catalogue is drawn: each stage (holes/*.js with a `stage`) and
// Arcade Classics. A hole file that fails to load or build is named and skipped (exit 1).
// Black line: the hole's routing. White dot: tee. Red dot: pin. Dark dots: trees.
// Magenta squares: props (those beyond the map edge are not drawn); hollow squares float
// (balloon, blimp, fireworks, cloud, airship, bird-flock); a target-ring is drawn as its
// circle, a bridge as its span, a crowd as its width. Contours every 2 m, or every 10 m on a
// course with more than 60 m of relief (the extreme stages), where higher ground is also lighter.
// v3:gadgets Gadgets (docs/gadgets.md) are drawn in their own colours: a ring as a yellow bar
// across the flight with a tick the way it faces, a pad orange, a strip cyan with its arrow, a
// fan pale blue, a geyser red, bumpers and rails pink, a backboard and a breakable white (the
// breakable doubled), a funnel violet, ice white-blue, mud brown, a warp purple with a line to
// its exit, coins gold dots, a multiplier ring green.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { COURSES, FAILED, buildCourse } = require('./courses.js');
const { FLAT_PROP_KINDS, SPAN_PROP_KINDS, FLOATING_PROP_KINDS, WIDE_PROP_KINDS, widePropSpan } = require('./lib.js');
const { makeSurfaceLookup } = require('../../lib/course.js');
const { makeTerrain } = require('../../lib/elevation.js');
const gadgetLib = require('../../lib/gadgets.js');   // v3:gadgets

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outDir = path.resolve(flag('--out') || path.join(here, '..', '..', '.shots', 'arcade-holes'));
const only = flag('--only');
const scale = Number(flag('--scale')) || 1.5;

const COLORS = {
  water: [52, 128, 190], green: [120, 205, 95], fairway: [78, 160, 70], tee: [150, 215, 130],
  bunker: [226, 205, 150], rough: [58, 112, 56], ob: [120, 104, 88],
};

fs.mkdirSync(outDir, { recursive: true });
let failed = false;
for (const f of FAILED) {
  if (only && f.id !== only) continue;
  failed = true;
  console.error(`FAILED  ${f.id}: ${f.error.message}`);
}
if (only && !COURSES.some((c) => c.id === only) && !failed) {
  console.error(`No arcade course '${only}' (have: ${COURSES.map((c) => c.id).join(', ')})`);
  process.exit(1);
}
for (const spec of COURSES) {
  if (only && spec.id !== only) continue;
  let course;
  try { ({ course } = buildCourse(spec.id)); }
  catch (error) { failed = true; console.error(`FAILED  ${spec.id}: ${error.message}`); continue; }
  const el = course.elevation;
  const surfaceAt = makeSurfaceLookup(course);
  const terrain = makeTerrain(el);
  const widthM = (el.nx - 1) * el.cellM, heightM = (el.ny - 1) * el.cellM;
  const W = Math.round(widthM * scale), H = Math.round(heightM * scale);
  const png = new PNG({ width: W, height: H });
  const toPx = (x, y) => [Math.round((x - el.minX) * scale), Math.round(H - 1 - (y - el.minY) * scale)];
  const put = (px, py, [r, g, b]) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const k = (py * W + px) * 4;
    png.data[k] = r; png.data[k + 1] = g; png.data[k + 2] = b; png.data[k + 3] = 255;
  };
  let lo = Infinity, hi = -Infinity;
  for (const h of el.heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
  const big = hi - lo > 60, step = big ? 10 : 2;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = el.minX + px / scale, y = el.minY + (H - 1 - py) / scale;
      const kind = surfaceAt(x, y);
      const g = terrain.grad(x, y);
      // light from the north-west (softer on big relief, where slopes are steep everywhere);
      // a contour tint every `step` metres
      const h = terrain.h(x, y);
      const lit = (-g.dx + g.dy) / Math.SQRT2;
      const shade = big ? Math.max(0.55, Math.min(1.3, 0.8 + 0.35 * Math.tanh(lit) + 0.4 * (h - lo) / (hi - lo))) : Math.max(0.45, Math.min(1.35, 1 + 1.6 * lit));
      const contour = Math.abs(h / step - Math.round(h / step)) < (big ? 0.03 : 0.04) && kind !== 'water' ? 0.88 : 1;
      put(px, py, (COLORS[kind] || [255, 0, 255]).map((c) => Math.max(0, Math.min(255, c * shade * contour))));
    }
  }
  const dot = (x, y, r, color) => {
    const [cx, cy] = toPx(x, y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(cx + dx, cy + dy, color);
  };
  for (const [x, y] of course.trees) dot(x, y, 2, [20, 60, 25]);
  const MAGENTA = [230, 40, 200];
  for (const p of course.props || []) {
    const [cx, cy] = toPx(p.x, p.y);
    if (FLAT_PROP_KINDS.includes(p.kind)) {
      // heightM is the ring's diameter
      const r = p.heightM / 2, n = Math.max(24, Math.ceil(2 * Math.PI * r * scale));
      for (let k = 0; k < n; k++) { const a = (k / n) * 2 * Math.PI; const [px, py] = toPx(p.x + r * Math.cos(a), p.y + r * Math.sin(a)); put(px, py, MAGENTA); }
    } else if (SPAN_PROP_KINDS.includes(p.kind)) {
      // heightM is the span, along the rotDeg heading (0 north, clockwise)
      const hx = Math.sin(p.rotDeg * Math.PI / 180), hy = Math.cos(p.rotDeg * Math.PI / 180), n = Math.ceil(p.heightM * scale);
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * p.heightM;
        const [px, py] = toPx(p.x + hx * t, p.y + hy * t);
        for (let d = -1; d <= 1; d++) { put(px + d, py, MAGENTA); put(px, py + d, MAGENTA); }
      }
    } else if (WIDE_PROP_KINDS.includes(p.kind)) {
      // four times as wide as it is tall, across its facing
      const [a, b] = widePropSpan(p), n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * scale);
      for (let k = 0; k <= n; k++) { const [px, py] = toPx(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); for (let d = -1; d <= 1; d++) { put(px + d, py, MAGENTA); put(px, py + d, MAGENTA); } }
    } else {
      const hollow = FLOATING_PROP_KINDS.includes(p.kind);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!hollow || Math.max(Math.abs(dx), Math.abs(dy)) === 3) put(cx + dx, cy + dy, MAGENTA);
    }
  }
  // v3:gadgets
  const GADGET_COLORS = {
    ring: [255, 225, 40], pad: [255, 140, 30], strip: [40, 235, 235], fan: [170, 215, 255], geyser: [255, 60, 40], bumper: [255, 120, 200],
    rail: [255, 120, 200], backboard: [250, 250, 250], funnel: [190, 120, 255], ice: [215, 240, 255], mud: [120, 78, 40],
    warp: [170, 60, 255], 'warp-exit': [170, 60, 255], breakable: [255, 255, 255], coins: [255, 200, 0], zone: [90, 255, 120],
  };
  const stroke = (a, b, color, wide = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * scale));
    for (let k = 0; k <= n; k++) {
      const [px, py] = toPx(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
      for (let dy = -wide; dy <= wide; dy++) for (let dx = -wide; dx <= wide; dx++) put(px + dx, py + dy, color);
    }
  };
  const gadgetById = new Map((course.gadgets || []).map((g) => [g.id, g]));
  for (const g of course.gadgets || []) {
    const color = GADGET_COLORS[g.kind] || MAGENTA;
    if (g.kind === 'coins') { for (const p of g.points) dot(p[0], p[1], 2, color); continue; }
    const o = gadgetLib.outline(g, 36);
    const pts = o.closed ? [...o.points, o.points[0]] : o.points;
    for (let i = 1; i < pts.length; i++) stroke(pts[i - 1], pts[i], color, g.kind === 'breakable' || g.kind === 'ring' ? 2 : 1);
    if (Number.isFinite(g.heading) && g.kind !== 'backboard' && g.kind !== 'breakable') {
      // the way it faces, throws or blows
      const len = g.kind === 'strip' || g.kind === 'fan' ? g.size[1] / 2 : Math.max(6, (g.radius || 4) * 1.5);
      const hx = Math.sin(g.heading * Math.PI / 180), hy = Math.cos(g.heading * Math.PI / 180);
      stroke([g.x, g.y], [g.x + hx * len, g.y + hy * len], color);
      dot(g.x + hx * len, g.y + hy * len, 2, color);
    }
    if (g.kind === 'warp') { const e = gadgetById.get(g.pair); if (e) stroke([g.x, g.y], [e.x, e.y], color, 0); }
    if (g.kind === 'warp-exit') dot(g.x, g.y, 3, color);
  }
  for (const hole of course.holes) {
    for (let i = 1; i < hole.line.length; i++) {
      const [ax, ay] = hole.line[i - 1], [bx, by] = hole.line[i];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * scale);
      for (let k = 0; k <= n; k++) { const [px, py] = toPx(ax + (bx - ax) * k / n, ay + (by - ay) * k / n); put(px, py, [0, 0, 0]); }
    }
    dot(hole.tee[0], hole.tee[1], 3, [255, 255, 255]);
    dot(hole.pin[0], hole.pin[1], 3, [230, 30, 30]);
  }
  const file = path.join(outDir, `${spec.id}.png`);
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log(`${file}  (${W} x ${H} px, ${scale} px per metre)`);
}
process.exit(failed ? 1 : 0);
