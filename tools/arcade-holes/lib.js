'use strict';
// Authoring helpers for hand-designed arcade holes (docs/arcade-holes.md).
//
// A hole is written as plain geometry in local metres (x east, y north): surface
// polygons, a routing line, a height function, trees and prop markers. assembleCourse()
// turns one or more of those "pieces" into the SAME course JSON lib/course.js parseOsm
// produces, so the game, the renderer and the cache treat it like any OSM course.
// validateCourse() checks it against what the loader really requires (it calls the
// loader's own makeSurfaceLookup / boundaryProblem / makeTerrain / sea finder), and
// writeCourse() publishes it into <dataDir>/courses/ atomically.
//
// Nothing here is used at runtime by the app; it only reads lib/ and public/render/.

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const courseLib = require(path.join(REPO, 'lib', 'course.js'));
const { normalizeCourseSource, courseCacheStem } = require(path.join(REPO, 'lib', 'course-identity.js'));
const { makeTerrain } = require(path.join(REPO, 'lib', 'elevation.js'));

const YD = 0.9144;                       // lib/physics.js YD
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
// lib/course.js: a ball is out of bounds once it is this far OUTSIDE course.boundary
// (not exported there, so mirrored; test/arcade-holes.test.js checks it still holds).
const BOUNDARY_BUFFER_M = 15;
// Synthetic identities. The loader only accepts OpenStreetMap ids (lib/course-identity.js),
// so arcade courses use node ids far above anything OSM has issued (~1.3e10 today).
const ARCADE_OSM_ID_BASE = 9_900_000_000_000;
const SURFACE_KINDS = Object.freeze(['green', 'fairway', 'tee', 'rough', 'bunker', 'water']);
// lib/course.js PRIORITY: where surfaces overlap, the first kind listed here is the one played.
const PLAY_PRIORITY = Object.freeze(['water', 'bunker', 'green', 'tee', 'fairway']);
// Every prop kind the look stream models (docs/dev/arcade-v2-contract.md, "Themes and props").
const PROP_KINDS = Object.freeze([
  'lighthouse', 'palm', 'volcano', 'rock-arch',
  'cactus', 'mesa', 'pine', 'snowman', 'cabin', 'ice-spire', 'lava-rock', 'lava-fall',
  'sakura-tree', 'torii', 'pagoda', 'stone-lantern', 'bridge', 'temple', 'idol',
  'pyramid', 'obelisk', 'sphinx', 'skyscraper', 'neon-sign', 'billboard',
  'grandstand', 'floodlight', 'target-ring', 'balloon', 'blimp',
  'windmill', 'shipwreck', 'crystal', 'torch', 'flag-banner',
  // second wave (detail pass): set pieces and life
  'waterfall', 'castle', 'dragon', 'giant-tree', 'ruins', 'jumbotron', 'fireworks', 'cloud', 'airship',
  'statue', 'fountain', 'tiki', 'hut', 'boat', 'gate', 'tower', 'rock-spire', 'launch-ramp', 'crowd', 'bird-flock',
]);
// Kinds whose heightM is not a height, and where they may be put:
//   target-ring  lies flat on the ground; heightM is its DIAMETER. The only prop allowed on
//                a green and on the line of play (rings are centred on a tiebreak pin).
//   bridge       spans along its rotDeg heading; heightM is its LENGTH. May cross water,
//                sand and fairway, and the line of play (it is a deck, not a wall).
//   balloon,     float (the look stream lifts them about 60 m and 120 m above their ground
//   blimp, ...   point), so what is under them does not matter. Second wave: fireworks, cloud,
//                airship, bird-flock.
//   crowd        a block of spectators heightM tall and FOUR TIMES AS WIDE (along the axis
//                across its facing: east-west at rotDeg 0). The whole width must be clear of
//                mown ground, sand and the line of play, and its feet must be dry.
const FLAT_PROP_KINDS = Object.freeze(['target-ring']);
const SPAN_PROP_KINDS = Object.freeze(['bridge']);
const FLOATING_PROP_KINDS = Object.freeze(['balloon', 'blimp', 'fireworks', 'cloud', 'airship', 'bird-flock']);
const WIDE_PROP_KINDS = Object.freeze(['crowd']);
const WIDE_PROP_ASPECT = 4;              // a crowd's width over its heightM
// Slim props that may stand a little closer to the tee-to-pin line than a building.
const SLIM_PROP_KINDS = Object.freeze(['palm', 'cactus', 'pine', 'sakura-tree', 'stone-lantern', 'torch', 'flag-banner', 'obelisk', 'floodlight', 'snowman', 'crystal', 'tiki']);

// Stage metadata (docs/dev/arcade-v2-contract.md section 1): what a hole file's `stage` may say.
const THEMES = Object.freeze(['tropical', 'canyon', 'links', 'volcano', 'alpine', 'sakura', 'jungle', 'desert', 'neon', 'stadium']);
const STAGE_ROLES = Object.freeze(['match', 'tiebreak']);
const TIMES_OF_DAY = Object.freeze(['day', 'golden', 'dusk', 'night']);
const CONDITIONS = Object.freeze(['calm', 'breezy', 'windy']);
const BLURB_MAX = 90;                    // characters: it is shown large on the stage intro
// A match stage's place in the running order: 1..9 are the Clash Tour, 10 and up are extra
// stages (shuffle and the quick-match picker draw from all of them). Numbers 21.. are the
// tiebreak arenas', so extras stop at 20.
const TOUR_STAGES = 9;
const MAX_MATCH_ORDER = 20;
const MAX_TIEBREAK_ORDER = 3;
// stage.freeBall: the ball every player's tee shot is played with, free, on a "rocket hole"
// (contract section 5). Ball ids only (lib/arcade.js POWERUPS, kind 'ball'); a test keeps
// this list in step with the arcade layer.
const FREE_BALLS = Object.freeze(['rocket', 'sticky', 'magnet', 'windcutter', 'laser', 'moonball', 'bouncy', 'fireball', 'ghost', 'skipper', 'yoyo', 'homing', 'titan', 'feather', 'gold']);
// stage.wind: { min, max } in mph, the range the server rolls a hole's wind from (contract
// section 5, "Wind per hole"). Optional: without it the range comes from `conditions`.
const WIND_MAX_MPH = 35;
// hole.routes: the ways to play a stage, shown on its intro (contract section 5, "Routes").
const ROUTE_IDS = Object.freeze(['safe', 'risky', 'rocket']);

// ---------------------------------------------------------------- numbers

// to a centimetre. "+ 0": never negative zero, which JSON writes as 0, so a built course
// would not read back from its file equal to itself
const round2 = (v) => Math.round(v * 100) / 100 + 0;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// 0 at a, 1 at b (a may be above b for a falling ramp); exactly 0 / 1 outside.
function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const yards = (m) => m / YD;
const metres = (yd) => yd * YD;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- polygons

function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}
const polygonArea = (poly) => Math.abs(signedArea(poly));
const ensureCCW = (poly) => (signedArea(poly) < 0 ? [...poly].reverse() : poly);

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(x, y, line) {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  return d;
}

function distToEdges(x, y, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}

// Metres to the polygon's edge: positive inside, negative outside.
function signedDistance(x, y, poly) {
  const d = distToEdges(x, y, poly);
  return pointInPoly(x, y, poly) ? d : -d;
}

function polylineLength(line) {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return len;
}

const translate = (points, dx, dy) => points.map(([x, y]) => [round2(x + dx), round2(y + dy)]);

// Grow (d > 0) or shrink (d < 0) a simple polygon by d metres: vertex-normal offset with
// the miter capped at 2|d|, as public/render/water-shore.js growPolygon does.
function offsetPolygon(poly, d) {
  const n = poly.length;
  const s = signedArea(poly) > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], c = poly[i], q = poly[(i + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    const n1 = [s * e1[1] / l1, -s * e1[0] / l1], n2 = [s * e2[1] / l2, -s * e2[0] / l2];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const k = Math.min(2, 1 / Math.max(0.2, mx * n1[0] + my * n1[1]));
    out.push([c[0] + mx * d * k, c[1] + my * d * k]);
  }
  return out;
}

// Chaikin corner cutting: rounds a hand-typed outline. Each pass doubles the points.
function smoothPolygon(poly, passes = 2) {
  let out = poly;
  for (let k = 0; k < passes; k++) {
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      next.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)], [lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
    }
    out = next;
  }
  return out;
}

// Round every corner of a hand-typed outline with an arc of about radiusM, leaving its
// straight edges where they were typed (smoothPolygon cuts a quarter off every edge, which
// moves the outline of a large shape a long way).
function roundCorners(poly, radiusM = 10, n = 5) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[(i + poly.length - 1) % poly.length], c = poly[i], q = poly[(i + 1) % poly.length];
    const l1 = Math.hypot(p[0] - c[0], p[1] - c[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const r = Math.min(radiusM, 0.45 * l1, 0.45 * l2);
    const a = [c[0] + (p[0] - c[0]) * r / l1, c[1] + (p[1] - c[1]) * r / l1], b = [c[0] + (q[0] - c[0]) * r / l2, c[1] + (q[1] - c[1]) * r / l2];
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;                    // a quadratic curve from a to b, pulled toward the corner
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return out;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// ---------------------------------------------------------------- shapes
// Every shape is a simple polygon [[x, y], ...], counter-clockwise, not closed.

function rect(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// Points on a circle from a0Deg to a1Deg (counter-clockwise when a1 > a0, else clockwise),
// both ends included: for composing coastlines and rims.
function arc(cx, cy, r, a0Deg, a1Deg, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0Deg, a1Deg, i / n) * RAD;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function ellipse(cx, cy, rx, ry = rx, { rotDeg = 0, n = 40 } = {}) {
  const c = Math.cos(rotDeg * RAD), s = Math.sin(rotDeg * RAD);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

// An ellipse with a smooth, seeded wobble (low harmonics only, so it never spikes):
// greens, bunkers, islands. wobble is the largest radial change as a fraction.
function blob(cx, cy, rx, ry = rx, { wobble = 0.1, seed = 1, rotDeg = 0, n = 48 } = {}) {
  const rnd = mulberry32(seed);
  const waves = [2, 3, 4, 5].map((k) => ({ k, amp: rnd() / k, phase: rnd() * TAU }));
  const total = waves.reduce((s, w) => s + w.amp, 0) || 1;
  const c = Math.cos(rotDeg * RAD), s = Math.sin(rotDeg * RAD);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let w = 0;
    for (const wave of waves) w += wave.amp * Math.sin(wave.k * a + wave.phase);
    const r = 1 + wobble * (w / total);
    const x = rx * r * Math.cos(a), y = ry * r * Math.sin(a);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

// A smooth curve through control points (uniform Catmull-Rom), one point about every
// stepM. Returns [{ x, y, t }] with t the control-point parameter (0 .. points.length - 1).
function spline(points, stepM = 6) {
  if (points.length < 2) throw new Error('spline needs at least two points');
  const at = (i) => points[clamp(i, 0, points.length - 1)];
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / stepM));
    for (let k = 0; k < n; k++) {
      const u = k / n, u2 = u * u, u3 = u2 * u;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]), t: i + u });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last[0], y: last[1], t: points.length - 1 });
  return out;
}

// A fairway: a ribbon along a line with rounded ends. width is metres, either one
// number, one per control point (interpolated along the curve), or a function of the
// distance fraction 0..1. Keep bends gentler than half the width or the inside edge folds.
function capsule(line, width, { stepM = 6, capN = 8 } = {}) {
  const pts = spline(line, stepM);
  const widthAt = (p, frac) => {
    if (typeof width === 'function') return width(frac);
    if (Array.isArray(width)) {
      const i = Math.min(width.length - 2, Math.floor(p.t));
      return lerp(width[i], width[i + 1], p.t - i);
    }
    return width;
  };
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  const left = [], right = [];
  let first = null, last = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
    const half = widthAt(pts[i], cum[i] / total) / 2;
    left.push([pts[i].x - ty * half, pts[i].y + tx * half]);
    right.push([pts[i].x + ty * half, pts[i].y - tx * half]);
    const end = { x: pts[i].x, y: pts[i].y, tx, ty, half };
    if (i === 0) first = end;
    last = end;
  }
  const cap = (e, sign) => {
    const out = [];
    for (let k = 1; k < capN; k++) {
      const a = (k / capN) * Math.PI;
      // from the left edge, round the end, to the right edge (sign 1: far end; -1: near end)
      const nx = -e.ty * sign, ny = e.tx * sign, fx = e.tx * sign, fy = e.ty * sign;
      out.push([e.x + e.half * (nx * Math.cos(a) + fx * Math.sin(a)), e.y + e.half * (ny * Math.cos(a) + fy * Math.sin(a))]);
    }
    return out;
  };
  return ensureCCW([...left, ...cap(last, 1), ...right.reverse(), ...cap(first, -1)]);
}

// How far the polygon's edge is from `center` in each direction: a function of the angle
// (radians). For star-shaped outlines seen from the centre (islands, lagoons).
function radiusOf(poly, center) {
  const [cx, cy] = center;
  return (theta) => {
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let best = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0] - cx, ay = poly[j][1] - cy, bx = poly[i][0] - cx, by = poly[i][1] - cy;
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (ax * ey - ay * ex) / den;       // along the ray
      const u = (ax * dy - ay * dx) / den;       // along the edge
      if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    return best;
  };
}

// A ring (moat, beach, collar) as `pieces` simple wedge polygons that share edges: the
// course format has no polygons with holes. rInner / rOuter: metres, or a function of the
// angle in radians (see radiusOf).
function ring(cx, cy, rInner, rOuter, { pieces = 4, n = 48 } = {}) {
  const ri = typeof rInner === 'function' ? rInner : () => rInner;
  const ro = typeof rOuter === 'function' ? rOuter : () => rOuter;
  const per = Math.max(2, Math.ceil(n / pieces));
  const out = [];
  for (let p = 0; p < pieces; p++) {
    const inner = [], outer = [];
    for (let k = 0; k <= per; k++) {
      const a = ((p + k / per) / pieces) * TAU;
      inner.push([cx + ri(a) * Math.cos(a), cy + ri(a) * Math.sin(a)]);
      outer.push([cx + ro(a) * Math.cos(a), cy + ro(a) * Math.sin(a)]);
    }
    out.push(ensureCCW([...outer, ...inner.reverse()]));
  }
  return out;
}

// ---------------------------------------------------------------- height building blocks
// Pure functions of (x, y), for a hole's height(x, y).

// Seeded value noise (fractal): (x, y) -> about -1 .. 1. scaleM is the size of the
// largest features. Integer hashing only, so every machine builds the same course.
function fbm({ seed = 1, scaleM = 60, octaves = 3, gain = 0.5 } = {}) {
  const hash = (ix, iy) => {
    let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967295;
  };
  const value = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), sx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy) * 2 - 1;
  };
  let norm = 0;
  for (let o = 0, a = 1; o < octaves; o++, a *= gain) norm += a;
  return (x, y) => {
    let sum = 0, amp = 1, f = 1 / scaleM;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value(x * f + o * 17.3, y * f - o * 9.1);
      amp *= gain; f *= 2;
    }
    return sum / norm;
  };
}

// A smooth mound with COMPACT support: 1 at the centre, exactly 0 from the ellipse
// (rx, ry) outward, so flat ground (a sea) round it stays exactly flat.
function bump(x, y, cx, cy, rx, ry = rx, rotDeg = 0) {
  let dx = x - cx, dy = y - cy;
  if (rotDeg) {
    const c = Math.cos(-rotDeg * RAD), s = Math.sin(-rotDeg * RAD);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  }
  const q = (dx / rx) ** 2 + (dy / ry) ** 2;
  return q >= 1 ? 0 : (1 - q) * (1 - q);
}

// 1 inside a polygon, falling smoothly to exactly 0 featherM outside it (featherM > 0),
// or rising from 0 at the edge to 1 featherM inside it (featherM < 0).
function plateauWeight(x, y, poly, featherM = 6) {
  const sd = signedDistance(x, y, poly);
  return featherM >= 0 ? smoothstep(-featherM, 0, sd) : smoothstep(0, -featherM, sd);
}

// A tilted plane: `level` at `about`, rising slopeX per metre east and slopeY per metre north.
const plane = (level, about, slopeX = 0, slopeY = 0) => (x, y) => level + slopeX * (x - about[0]) + slopeY * (y - about[1]);

// ---- big relief (the extreme stages: buttes, calderas, mountains)

// signedDistance for a polygon that is asked about from all over a large grid: exact within
// reachM of the polygon's bounding box, -Infinity beyond it (so "is it within reachM?" tests
// stay right and the far field costs nothing).
function nearField(poly, reachM = 0) {
  const b = bbox(poly);
  return (x, y) => (x < b.minX - reachM || x > b.maxX + reachM || y < b.minY - reachM || y > b.maxY + reachM ? -Infinity : signedDistance(x, y, poly));
}

// Ridged noise: 0 .. 1 with sharp crests (ridgelines, arêtes, the lips of rock bands).
function ridged({ seed = 1, scaleM = 120, octaves = 3, gain = 0.5 } = {}) {
  const layers = [];
  for (let o = 0, amp = 1, sc = scaleM; o < octaves; o++, amp *= gain, sc /= 2) layers.push({ n: fbm({ seed: seed + o * 101, scaleM: sc, octaves: 1 }), amp });
  const norm = layers.reduce((t, l) => t + l.amp, 0);
  return (x, y) => {
    let sum = 0;
    for (const l of layers) { const v = 1 - Math.abs(l.n(x, y)); sum += l.amp * v * v; }
    return sum / norm;
  };
}

// Rock bands: a height pulled toward benches stepM apart (sharp 0: unchanged, 1: all but
// level benches with risers between). On a steep face this cuts the strata of a canyon wall.
function strata(h, stepM = 6, sharp = 0.7) {
  const k = h / stepM, base = Math.floor(k), f = k - base;
  return (base + lerp(f, smoothstep(0.5 - 0.5 * (1 - sharp) - 0.18, 0.5 + 0.5 * (1 - sharp) + 0.18, f), sharp)) * stepM;
}

/**
 * Stacked plateaus with cliffs between them: a butte, a terraced mountain, a caldera shelf.
 * list: [{ poly, level (a number or a plane()), cliffM }] from the lowest tier to the highest;
 * each is flat inside its polygon and falls to whatever lies below over cliffM outside it.
 * warp: (x, y) -> [dx, dy] metres, bends every outline the same way (ragged rock edges);
 * keep mown ground further inside a tier than the warp can reach.
 * -> { apply(x, y, h) -> h, cliff(x, y) -> 0..1 (1 half way down a cliff face), on(x, y) -> the
 *      index of the highest tier the point is on (-1: none) }
 */
function tiers(list, { warp = null } = {}) {
  const fields = list.map((t) => ({ ...t, sd: nearField(t.poly, t.cliffM + 8), lv: typeof t.level === 'function' ? t.level : () => t.level }));
  const at = (x, y) => (warp ? (([dx, dy]) => [x + dx, y + dy])(warp(x, y)) : [x, y]);
  return {
    apply(x, y, h) {
      const [wx, wy] = at(x, y);
      for (const t of fields) {
        const w = smoothstep(-t.cliffM, 0, t.sd(wx, wy));
        if (w) h = lerp(h, t.lv(x, y), w);
      }
      return h;
    },
    cliff(x, y) {
      const [wx, wy] = at(x, y);
      let c = 0;
      for (const t of fields) {
        const w = smoothstep(-t.cliffM, 0, t.sd(wx, wy));
        c = w >= 1 ? 0 : Math.max(c, 4 * w * (1 - w));
      }
      return c;
    },
    on(x, y) {
      const [wx, wy] = at(x, y);
      let top = -1;
      fields.forEach((t, i) => { if (t.sd(wx, wy) >= 0) top = i; });
      return top;
    },
  };
}

// How far (x, y) is from the nearest of some polygons, as a 0..1 mask: 0 on them and within
// nearM, 1 from farM outward. For keeping noise and rocks off mown ground.
function awayFrom(polys, nearM = 4, farM = 14) {
  const fields = polys.map((p) => nearField(p, farM));
  return (x, y) => {
    let d = Infinity;
    for (const sd of fields) { const v = -sd(x, y); if (v < d) d = v; if (d <= nearM) return 0; }
    return smoothstep(nearM, farM, d);
  };
}

// ---------------------------------------------------------------- heightfield

function gaussianBlur(src, nx, ny, sigma) {
  const radius = Math.max(1, Math.round(3 * sigma));
  const kernel = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); kernel.push(w); sum += w; }
  const tmp = new Float64Array(nx * ny), out = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += src[j * nx + clamp(i + k, 0, nx - 1)] * kernel[k + radius];
    tmp[j * nx + i] = s / sum;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += tmp[clamp(j + k, 0, ny - 1) * nx + i] * kernel[k + radius];
    out[j * nx + i] = s / sum;
  }
  return out;
}

// A height grid over a rectangle of local metres. Start it from a function (fill) or
// sculpt it step by step (hill, valley, ridge, plateau, noise, smooth); toElevation()
// is the `course.elevation` object lib/elevation.js makeTerrain reads.
class Heightfield {
  constructor({ minX, minY, maxX, maxY, cellM = 2 }) {
    if (!(maxX > minX) || !(maxY > minY) || !(cellM > 0)) throw new Error('Heightfield needs a positive extent and cell size');
    this.minX = minX; this.minY = minY; this.cellM = cellM;
    this.nx = Math.floor((maxX - minX) / cellM) + 1;
    this.ny = Math.floor((maxY - minY) / cellM) + 1;
    this.h = new Float64Array(this.nx * this.ny);
  }

  get maxX() { return this.minX + (this.nx - 1) * this.cellM; }
  get maxY() { return this.minY + (this.ny - 1) * this.cellM; }

  // fn(x, y, currentHeight) -> new height, for every node
  apply(fn) {
    for (let j = 0; j < this.ny; j++) {
      const y = this.minY + j * this.cellM;
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        this.h[k] = fn(this.minX + i * this.cellM, y, this.h[k]);
      }
    }
    return this;
  }

  fill(fn) { return this.apply(typeof fn === 'function' ? (x, y) => fn(x, y) : () => fn); }
  add(fn) { return this.apply((x, y, h) => h + fn(x, y)); }

  // a mound h metres high (h < 0: a hollow) with radii rx, ry
  hill({ x, y, rx, ry = rx, h, rotDeg = 0 }) { return this.add((px, py) => h * bump(px, py, x, y, rx, ry, rotDeg)); }
  valley(spec) { return this.hill({ ...spec, h: -Math.abs(spec.h) }); }

  // a bank h metres high along a line (h < 0: a canyon), fading out widthM / 2 either side
  ridge({ line, widthM, h }) {
    return this.add((px, py) => {
      const q = (distToPolyline(px, py, line) / (widthM / 2)) ** 2;
      return q >= 1 ? 0 : h * (1 - q) * (1 - q);
    });
  }

  // flatten a polygon to `level` (a number or a plane()), blending back to the
  // surrounding ground over featherM outside it
  plateau({ poly, level, featherM = 6 }) {
    const lv = typeof level === 'function' ? level : () => level;
    return this.apply((px, py, h) => {
      const w = plateauWeight(px, py, poly, featherM);
      return w ? lerp(h, lv(px, py), w) : h;
    });
  }

  noise({ amp = 1, scaleM = 60, octaves = 3, seed = 1 } = {}) {
    const n = fbm({ seed, scaleM, octaves });
    return this.add((px, py) => amp * n(px, py));
  }

  // gaussian smoothing, sigmaM metres; nodes for which keep(x, y, h) is true are left
  // exactly as they were (water that must stay level, a shaped green)
  smooth(sigmaM, { keep = null } = {}) {
    const blurred = gaussianBlur(this.h, this.nx, this.ny, sigmaM / this.cellM);
    return this.apply((px, py, h) => {
      if (keep && keep(px, py, h)) return h;
      const i = Math.round((px - this.minX) / this.cellM), j = Math.round((py - this.minY) / this.cellM);
      return blurred[j * this.nx + i];
    });
  }

  toElevation({ baseM = 0 } = {}) {
    const heights = new Array(this.h.length);
    for (let k = 0; k < heights.length; k++) {
      if (!Number.isFinite(this.h[k])) throw new Error(`Heightfield has a non-finite height at node ${k}`);
      heights[k] = round2(this.h[k]) + 0;   // + 0: no negative zero in the JSON
    }
    return { minX: this.minX, minY: this.minY, cellM: this.cellM, nx: this.nx, ny: this.ny, baseM, heights };
  }

  // { h(x, y), grad(x, y) } exactly as the game's physics samples the finished grid
  sampler() { return makeTerrain(this.toElevation(), [], { smooth: true }); }
}

// ---------------------------------------------------------------- trees and props

// Trees over a polygon on a jittered grid, about one per spacing x spacing metres.
// avoid: polygons to keep clear of (by clearM); keep(x, y): any other condition.
function scatterTrees(poly, { spacing = 12, jitter = 0.45, seed = 1, avoid = [], clearM = 3, keep = null } = {}) {
  const rnd = mulberry32(seed);
  const b = bbox(poly);
  const out = [];
  for (let y = b.minY; y <= b.maxY; y += spacing) {
    for (let x = b.minX; x <= b.maxX; x += spacing) {
      const px = x + (rnd() - 0.5) * 2 * jitter * spacing, py = y + (rnd() - 0.5) * 2 * jitter * spacing;
      if (!pointInPoly(px, py, poly)) continue;
      if (avoid.some((a) => signedDistance(px, py, a) > -clearM)) continue;
      if (keep && !keep(px, py)) continue;
      out.push([round2(px), round2(py)]);
    }
  }
  return out;
}

// A loose clump of `count` trees within radius of a point, at least minGap apart.
function clusterTrees(cx, cy, { count = 6, radius = 14, seed = 1, minGap = 4, keep = null } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * radius;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (out.some((t) => Math.hypot(t[0] - x, t[1] - y) < minGap)) continue;
    if (keep && !keep(x, y)) continue;
    out.push([round2(x), round2(y)]);
  }
  return out;
}

// A hero prop marker for the props layer (public/render/props.js reads course.props):
// scenery only, no collision. heightM is the real-world height of the model.
function prop(kind, x, y, { heightM, rotDeg = 0, id = null } = {}) {
  return { id, kind, x: round2(x), y: round2(y), rotDeg: round2(rotDeg), heightM: round2(heightM) };
}

// The two ends of a wide prop (a crowd): WIDE_PROP_ASPECT x heightM across, along the axis
// across its facing. rotDeg turns a model clockwise seen from above, so east at rotDeg 0
// becomes (cos, -sin).
function widePropSpan(p) {
  const half = (WIDE_PROP_ASPECT * p.heightM) / 2;
  const c = Math.cos((p.rotDeg || 0) * RAD), s = Math.sin((p.rotDeg || 0) * RAD);
  return [[p.x - half * c, p.y + half * s], [p.x + half * c, p.y - half * s]];
}

// the least distance from segment a-b to segment c-d (sampled every metre along a-b)
function segmentsDistance(a, b, c, d) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  let best = Infinity;
  for (let k = 0; k <= n; k++) best = Math.min(best, distToSegment(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), c[0], c[1], d[0], d[1]));
  return best;
}

// rotDeg for a prop at (x, y) whose front should face (tx, ty): a grandstand facing the
// green, a billboard facing the tee. rotDeg turns a model clockwise seen from above and a
// model's front is glTF +Z, which is south at rotDeg 0 (public/render/props.js).
function facing(x, y, tx, ty) {
  const bearing = Math.atan2(tx - x, ty - y) / RAD;          // compass: 0 north, 90 east
  return round2(((bearing - 180) % 360 + 360) % 360);
}

// ---------------------------------------------------------------- course assembly

/**
 * Check a hole file's `stage` and fill in its defaults. Throws an Error naming everything
 * that is wrong with it; returns { number, role, order, name, theme, origin, conditions,
 * baseM, timeOfDay, blurb, difficulty, freeBall, wind } (conditions, freeBall and wind null
 * when the hole asks for none).
 */
function normalizeStage(stage, id = 'stage') {
  const problems = [];
  const s = stage && typeof stage === 'object' ? stage : {};
  if (!stage || typeof stage !== 'object') problems.push('stage must be an object');
  else {
    if (!Number.isInteger(s.number) || s.number < 1 || s.number > 99) problems.push('number must be an integer 1..99');
    if (!STAGE_ROLES.includes(s.role)) problems.push(`role must be one of ${STAGE_ROLES.join(', ')}`);
    if (!Number.isInteger(s.order) || s.order < 1 || s.order > (s.role === 'tiebreak' ? MAX_TIEBREAK_ORDER : MAX_MATCH_ORDER)) problems.push(`order must be 1..${MAX_MATCH_ORDER} for a match stage (1..${TOUR_STAGES} the tour, above that extra stages), 1..${MAX_TIEBREAK_ORDER} for a tiebreak`);
    if (typeof s.name !== 'string' || !s.name.trim()) problems.push('name is missing');
    if (!THEMES.includes(s.theme)) problems.push(`theme must be one of ${THEMES.join(', ')}`);
    if (!s.origin || !Number.isFinite(s.origin.lat) || !Number.isFinite(s.origin.lon) || Math.abs(s.origin.lat) > 90 || Math.abs(s.origin.lon) > 180) problems.push('origin needs a finite { lat, lon }');
    if (s.conditions != null && !CONDITIONS.includes(s.conditions)) problems.push(`conditions must be one of ${CONDITIONS.join(', ')}`);
    if (s.baseM != null && !Number.isFinite(s.baseM)) problems.push('baseM must be a number');
    if (s.timeOfDay != null && !TIMES_OF_DAY.includes(s.timeOfDay)) problems.push(`timeOfDay must be one of ${TIMES_OF_DAY.join(', ')}`);
    if (typeof s.blurb !== 'string' || !s.blurb.trim() || s.blurb.length >= BLURB_MAX) problems.push(`blurb must be a line of under ${BLURB_MAX} characters`);
    if (![1, 2, 3].includes(s.difficulty)) problems.push('difficulty must be 1, 2 or 3');
    if (s.wind != null && !(typeof s.wind === 'object' && Number.isFinite(s.wind.min) && Number.isFinite(s.wind.max) &&
        s.wind.min >= 0 && s.wind.min <= s.wind.max && s.wind.max <= WIND_MAX_MPH)) problems.push(`wind must be { min, max } in mph with 0 <= min <= max <= ${WIND_MAX_MPH}`);
    if (s.freeBall != null && !FREE_BALLS.includes(s.freeBall)) problems.push(`freeBall must be a ball id (one of ${FREE_BALLS.join(', ')})`);
  }
  if (problems.length) throw new Error(`${id}: stage: ${problems.join('; ')}`);
  return {
    number: s.number, role: s.role, order: s.order, name: s.name.trim(), theme: s.theme,
    origin: { lat: s.origin.lat, lon: s.origin.lon },
    conditions: s.conditions || null, baseM: s.baseM || 0,
    timeOfDay: s.timeOfDay || 'day', blurb: s.blurb.trim(), difficulty: s.difficulty,
    freeBall: s.freeBall || null,
    wind: s.wind ? { min: s.wind.min, max: s.wind.max } : null,
  };
}

/**
 * Check a hole's `routes` (the ways to play it: contract section 5) and tidy them. Throws
 * an Error naming everything that is wrong; returns [{ id, name, note }] (null for none).
 * needAll: a match stage that documents its routes must have a safe, a risky and a rocket one.
 */
function normalizeRoutes(routes, id = 'hole', { needAll = false } = {}) {
  if (routes == null) return null;
  const problems = [];
  if (!Array.isArray(routes) || !routes.length) problems.push('routes must be a non-empty array of { id, name, note }');
  else {
    for (const [i, r] of routes.entries()) {
      if (!r || typeof r !== 'object') { problems.push(`route ${i + 1} must be { id, name, note }`); continue; }
      if (!ROUTE_IDS.includes(r.id)) problems.push(`route ${i + 1}: id must be one of ${ROUTE_IDS.join(', ')}`);
      if (typeof r.name !== 'string' || !r.name.trim()) problems.push(`route ${i + 1}: name is missing`);
      if (typeof r.note !== 'string' || !r.note.trim()) problems.push(`route ${i + 1}: note is missing`);
    }
    if (needAll) for (const want of ROUTE_IDS) if (!routes.some((r) => r && r.id === want)) problems.push(`there is no '${want}' route`);
  }
  if (problems.length) throw new Error(`${id}: routes: ${problems.join('; ')}`);
  return routes.map((r) => ({ id: r.id, name: r.name.trim(), note: r.note.trim() }));
}

function arcadeSource(n) {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) throw new Error('arcade course number must be 1..999999');
  return normalizeCourseSource({ osmType: 'node', osmId: ARCADE_OSM_ID_BASE + n });
}

// A piece's tree is [x, y] or [x, y, heightM, crownRadiusM]; unsized trees get a
// repeatable size of their own (9-16 m tall, crown 2.8-5 m).
function sizedTree(t, dx, dy, i) {
  const rnd = mulberry32(Math.round(t[0] * 31 + t[1] * 17) + i * 7919);
  const h = Number.isFinite(t[2]) ? t[2] : 9 + rnd() * 7;
  const r = Number.isFinite(t[3]) ? t[3] : 2.8 + rnd() * 2.2;
  return [round2(t[0] + dx), round2(t[1] + dy), round2(h), round2(r)];
}

function placePiece(piece, dx, dy, dz, ref) {
  const move = (p) => [round2(p[0] + dx), round2(p[1] + dy)];
  const line = piece.hole.line.map(move);
  const routes = normalizeRoutes(piece.hole.routes, piece.id);
  const used = new Set();
  const props = (piece.props || []).map((p, i) => {
    let id = `${piece.id}/${p.id || `${p.kind}-${i + 1}`}`;
    while (used.has(id)) id += '+';
    used.add(id);
    return { id, kind: p.kind, x: round2(p.x + dx), y: round2(p.y + dy), rotDeg: p.rotDeg || 0, heightM: p.heightM };
  });
  return {
    id: piece.id, dx, dy, dz,
    extent: { minX: piece.extent.minX + dx, minY: piece.extent.minY + dy, maxX: piece.extent.maxX + dx, maxY: piece.extent.maxY + dy },
    height: piece.height,
    surfaces: piece.surfaces.map((s) => ({ kind: s.kind, poly: s.poly.map(move) })),
    hole: {
      ref,
      par: piece.hole.par,
      name: piece.hole.name,
      tee: line[0],
      pin: line[line.length - 1],
      line,
      lengthYd: Math.round(polylineLength(line) / YD),
      ...(piece.hole.note ? { note: piece.hole.note } : {}),
      ...(piece.hole.greenNote ? { greenNote: piece.hole.greenNote } : {}),
      ...(routes ? { routes } : {}),
    },
    trees: (piece.trees || []).map((t, i) => sizedTree(t, dx, dy, i)),
    woods: (piece.woods || []).map((w) => w.map(move)),
    props,
    obLine: piece.obLine ? piece.obLine.map(move) : null,
    probes: (piece.probes || []).map((p) => ({ at: move(p.at), kind: p.kind, what: `${piece.id}: ${p.what || p.kind}` })),
    sea: Boolean(piece.sea),
  };
}

/**
 * Build a course from hole pieces.
 * @param {object} o
 *   id        slug ('lagoon-island'); number: 1..999999, its synthetic OSM node id offset
 *   name      what the course picker shows
 *   origin    { lat, lon }: sun, sky and map position only. Keep it over open ocean so
 *             no background download can ever find real buildings or lakes there.
 *   pieces    [{ piece, dx, dy, dz }]: holes in play order, each moved by (dx, dy) metres
 *             and raised by dz
 *   cellM     height grid spacing (2 m for one hole; 3 m keeps a multi-hole file small)
 *   base      (x, y) -> height of the ground between pieces (several pieces only); each
 *             piece blends into it over blendM inside its own extent
 *   extent    the height grid's rectangle (default: the pieces' extents together)
 *   sea       expect the renderer / physics to find a sea in the terrain (default: any piece's)
 *   stage     a hole file's `stage` (normalizeStage): makes this a format 2 stage course,
 *             with theme, role, order, timeOfDay, blurb and difficulty in course.arcade
 *             (and freeBall, on a rocket hole, and wind, when the hole has its own range)
 * @returns {{ course, expect }} expect: what validateCourse should confirm
 */
function assembleCourse({ id, number, name, origin, pieces, cellM = 2, base = null, blendM = 30, extent = null, baseM = 0, sea = null, conditions = null, stage = null }) {
  if (!pieces || !pieces.length) throw new Error('assembleCourse needs at least one piece');
  const placed = pieces.map(({ piece, dx = 0, dy = 0, dz = 0 }, i) => placePiece(piece, dx, dy, dz, i + 1));
  const ext = extent || placed.reduce((e, p) => ({
    minX: Math.min(e.minX, p.extent.minX), minY: Math.min(e.minY, p.extent.minY),
    maxX: Math.max(e.maxX, p.extent.maxX), maxY: Math.max(e.maxY, p.extent.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const hf = new Heightfield({ ...ext, cellM });
  hf.fill((x, y) => {
    let h = base ? base(x, y) : null;
    for (const p of placed) {
      const inset = Math.min(x - p.extent.minX, p.extent.maxX - x, y - p.extent.minY, p.extent.maxY - y);
      if (inset < 0) continue;
      const own = p.height(x - p.dx, y - p.dy) + p.dz;
      h = h === null ? own : (base ? lerp(h, own, smoothstep(0, blendM, inset)) : h);
    }
    return h === null ? 0 : h;
  });

  // The OB line is where a ball IS out; the loader calls a ball out BOUNDARY_BUFFER_M
  // beyond course.boundary, so the boundary is the OB line drawn in by that much.
  const obLines = placed.map((p) => p.obLine).filter(Boolean);
  const obLine = obLines.length === 1 ? obLines[0] : (obLines.length ? convexHull(obLines.flat()) : null);
  const boundary = obLine ? offsetPolygon(ensureCCW(obLine), -BOUNDARY_BUFFER_M).map(([x, y]) => [round2(x), round2(y)]) : null;

  const course = {
    version: courseLib.CACHE_VERSION,
    name,
    source: { ...arcadeSource(number) },
    origin: { lat: origin.lat, lon: origin.lon },
    surfaces: placed.flatMap((p) => p.surfaces),
    boundary,
    holes: placed.map((p) => p.hole),
    trees: placed.flatMap((p) => p.trees.map(([x, y]) => [x, y])),
    woods: placed.flatMap((p) => p.woods),
    elevation: hf.toElevation({ baseM }),
    // Scenery layers (lib/course-enrichment.js) marked as already looked for and empty,
    // so the background enricher never goes to the network for a made-up place.
    buildings: [],
    scenery: { water: [] },
    // The same trees with a height and a crown radius, in the shape canopy height data
    // has ([x, y, heightM, crownRadiusM]). The renderer and the tree obstacles prefer
    // these to the bare points above, and a course WITH canopy trees gets no invented
    // "horizon band" of trees round its edge (which would stand in the sea here).
    canopy: { source: 'arcade', trees: placed.flatMap((p) => p.trees) },
    enrichment: { aerial: { status: 'none', at: '2999-01-01T00:00:00.000Z' } },
    // Hero set pieces for the props layer; ignored by everything else.
    props: placed.flatMap((p) => p.props),
    // A stage (one hole, one world) is format 2 and says how it looks and where it comes in
    // the tour; a plain course of several holes (Arcade Classics) stays format 1.
    arcade: {
      id,
      formatVersion: stage ? 2 : 1,
      generator: 'tools/arcade-holes',
      holes: placed.map((p) => p.id),
      ...(stage ? {
        theme: stage.theme, role: stage.role, order: stage.order,
        timeOfDay: stage.timeOfDay || 'day', blurb: stage.blurb, difficulty: stage.difficulty,
      } : {}),
      ...(conditions ? { conditions } : {}),
      // a rocket hole: every player's tee shot is played with this ball, free
      ...(stage && stage.freeBall ? { freeBall: stage.freeBall } : {}),
      // the hole's own wind range in mph (the server rolls a speed inside it for every hole)
      ...(stage && stage.wind ? { wind: { min: stage.wind.min, max: stage.wind.max } } : {}),
    },
  };
  const expect = {
    sea: sea === null ? placed.some((p) => p.sea) : Boolean(sea),
    // a hole's own out-of-bounds line is not the line of a course of several holes
    probes: placed.flatMap((p) => p.probes).filter((probe) => placed.length === 1 || probe.kind !== 'ob'),
  };
  return { course, expect };
}

// ---------------------------------------------------------------- validation

let seaLib;
function loadSeaLib() {
  if (seaLib !== undefined) return seaLib;
  try {
    seaLib = {
      ...require(path.join(REPO, 'public', 'render', 'sea.js')),
      ...require(path.join(REPO, 'public', 'render', 'grid-repair.js')),
    };
  } catch (_) {
    seaLib = null;   // Node without require(esm): lib/course.js cannot find the sea either
  }
  return seaLib;
}

// The sea the renderer draws and lib/course.js plays as water, found the same way
// (lib/course.js courseSea). undefined: this Node cannot load the sea finder.
function findCourseSea(course) {
  const lib = loadSeaLib();
  if (!lib) return undefined;
  const ponds = course.surfaces.filter((s) => s.kind === 'water').map(({ poly }) => ({ poly, ...bbox(poly) }));
  const grid = lib.repairGridEdges(course.elevation).grid;
  return lib.findSea(grid, { ponds, play: lib.playPoints(course.surfaces) }) || null;
}

class ArcadeCourseError extends Error {
  constructor(name, problems) {
    super(`${name}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
    this.name = 'ArcadeCourseError';
    this.problems = problems;
  }
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isRing = (p) => Array.isArray(p) && p.length >= 3 && p.every(isPoint);

/**
 * Check a course against what the loader, the game and the renderer require. Throws an
 * ArcadeCourseError listing every problem; returns { warnings, stats } when it is sound.
 * expect: { sea, probes: [{ at: [x, y], kind, what }] } from assembleCourse.
 */
function validateCourse(course, { expect = null, maxGreenSlope = 0.03, maxFairwaySlope = 0.2 } = {}) {
  const problems = [], warnings = [];
  const bad = (m) => problems.push(m);
  const name = course && course.name ? course.name : '(unnamed course)';
  const fail = () => { throw new ArcadeCourseError(name, problems); };

  if (!course || typeof course !== 'object') { bad('not an object'); fail(); }
  if (!courseLib.isCurrentCourseCache(course)) bad(`not a current cache file: version must be ${courseLib.CACHE_VERSION} and holes non-empty`);
  if (typeof course.name !== 'string' || !course.name.trim()) bad('name is missing');
  let source = null;
  try { source = normalizeCourseSource(course.source); }
  catch (e) { bad(`source is not a loadable identity ({ osmType, osmId }): ${e.message}`); }
  if (!course.origin || !Number.isFinite(course.origin.lat) || !Number.isFinite(course.origin.lon) ||
      Math.abs(course.origin.lat) > 90 || Math.abs(course.origin.lon) > 180) bad('origin needs a finite lat / lon');

  if (!Array.isArray(course.surfaces) || !course.surfaces.length) bad('surfaces is empty');
  for (const [i, s] of (course.surfaces || []).entries()) {
    if (!s || !isRing(s.poly)) { bad(`surface ${i} (${s && s.kind}) is not a polygon of 3+ finite points`); continue; }
    if (!SURFACE_KINDS.includes(s.kind)) {
      warnings.push(`surface ${i} has kind '${s.kind}', which neither the game nor the renderer knows` +
        (s.kind === 'ob' ? ' (out of bounds comes from course.boundary only)' : ''));
    }
    if (polygonArea(s.poly) < 1) bad(`surface ${i} (${s.kind}) has no area`);
  }
  for (const key of ['trees', 'woods']) if (!Array.isArray(course[key])) bad(`${key} must be an array`);
  for (const [i, t] of (course.trees || []).entries()) if (!isPoint(t)) bad(`tree ${i} is not [x, y]`);
  for (const [i, w] of (course.woods || []).entries()) if (!isRing(w)) bad(`wood ${i} is not a polygon`);

  const el = course.elevation;
  const gridOk = el && Number.isInteger(el.nx) && Number.isInteger(el.ny) && el.nx >= 2 && el.ny >= 2 &&
    el.cellM > 0 && Number.isFinite(el.minX) && Number.isFinite(el.minY) && Number.isFinite(el.baseM) &&
    Array.isArray(el.heights) && el.heights.length === el.nx * el.ny && el.heights.every(Number.isFinite);
  if (!gridOk) bad('elevation is not a complete grid { minX, minY, cellM, nx, ny, baseM, heights[nx * ny] }');

  if (!Array.isArray(course.holes) || !course.holes.length) bad('holes is empty');
  for (const h of course.holes || []) {
    const label = `hole ${h && h.ref}`;
    if (!h || !isPoint(h.tee) || !isPoint(h.pin)) { bad(`${label}: tee and pin must be [x, y]`); continue; }
    if (!Number.isInteger(h.ref)) bad(`${label}: ref must be an integer`);
    if (![3, 4, 5].includes(h.par)) bad(`${label}: par must be 3, 4 or 5`);
    if (!Array.isArray(h.line) || h.line.length < 2 || !h.line.every(isPoint)) { bad(`${label}: line needs 2+ points`); continue; }
    const a = h.line[0], z = h.line[h.line.length - 1];
    if (a[0] !== h.tee[0] || a[1] !== h.tee[1] || z[0] !== h.pin[0] || z[1] !== h.pin[1]) bad(`${label}: line must run from the tee to the pin`);
    if (h.lengthYd !== Math.round(polylineLength(h.line) / YD)) bad(`${label}: lengthYd must be the line's length in yards`);
    // the ways to play it: a match stage that documents them has a safe, a risky and a rocket one
    if (h.routes !== undefined) {
      const isMatchStage = Boolean(course.arcade && course.arcade.formatVersion >= 2 && course.arcade.role === 'match');
      try { normalizeRoutes(h.routes, label, { needAll: isMatchStage }); } catch (e) { bad(e.message); }
    }
  }
  if (course.arcade && course.arcade.wind !== undefined) {
    const w = course.arcade.wind;
    if (!(w && Number.isFinite(w.min) && Number.isFinite(w.max) && w.min >= 0 && w.min <= w.max && w.max <= WIND_MAX_MPH)) bad(`arcade.wind must be { min, max } in mph with 0 <= min <= max <= ${WIND_MAX_MPH}`);
  }
  if (course.arcade && course.arcade.freeBall !== undefined && !FREE_BALLS.includes(course.arcade.freeBall)) bad(`arcade.freeBall '${course.arcade.freeBall}' is not a ball id`);

  if (course.props !== undefined) {
    if (!Array.isArray(course.props)) bad('props must be an array');
    const ids = new Set();
    for (const [i, p] of (course.props || []).entries()) {
      if (!p || typeof p.id !== 'string' || !p.id || typeof p.kind !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
          !Number.isFinite(p.rotDeg) || !(p.heightM > 0)) { bad(`prop ${i} must be { id, kind, x, y, rotDeg, heightM }`); continue; }
      if (ids.has(p.id)) bad(`prop id ${p.id} is used twice`);
      ids.add(p.id);
      if (!PROP_KINDS.includes(p.kind)) warnings.push(`prop ${p.id} has kind '${p.kind}', which has no model yet`);
    }
  }
  if (problems.length) fail();

  // ---- the loader's own view of the course
  const quiet = console.warn;
  let surfaceAt, boundaryIssue;
  try {
    console.warn = () => {};
    surfaceAt = courseLib.makeSurfaceLookup(course);
    boundaryIssue = courseLib.boundaryProblem(course);
  } finally { console.warn = quiet; }
  if (boundaryIssue) bad(`boundary would be ignored for out of bounds: ${boundaryIssue}`);
  if (!course.boundary) warnings.push('no boundary: nothing is ever out of bounds');

  const terrain = makeTerrain(el, el.patches || [], { smooth: true });
  const slope = (x, y) => { const g = terrain.grad(x, y); return Math.hypot(g.dx, g.dy); };
  const inGrid = (x, y) => x >= el.minX && x <= el.minX + (el.nx - 1) * el.cellM && y >= el.minY && y <= el.minY + (el.ny - 1) * el.cellM;
  for (const [i, s] of course.surfaces.entries()) {
    if (!s.poly.every(([x, y]) => inGrid(x, y))) bad(`surface ${i} (${s.kind}) reaches outside the elevation grid`);
  }
  // every node of the polygon's interior, on a 2 m lattice
  const interior = (poly, step = 2) => {
    const b = bbox(poly), out = [];
    for (let y = b.minY + step / 2; y < b.maxY; y += step) for (let x = b.minX + step / 2; x < b.maxX; x += step) if (pointInPoly(x, y, poly)) out.push([x, y]);
    return out;
  };
  const median = (v) => { const s = [...v].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

  const stats = { holes: [], sea: null, nodes: el.nx * el.ny };
  const greens = course.surfaces.filter((s) => s.kind === 'green');
  const mown = [];   // { box, low }: every tee, fairway and green with its lowest point
  for (const s of course.surfaces) {
    if (s.kind !== 'green' && s.kind !== 'tee' && s.kind !== 'fairway') continue;
    // only the ground that really plays as this surface (a bunker or water over it wins)
    const pts = interior(s.poly).filter(([x, y]) => surfaceAt(x, y) === s.kind);
    let steepest = 0, where = null, low = Infinity;
    for (const [x, y] of pts) {
      low = Math.min(low, terrain.h(x, y));
      const g = slope(x, y);
      if (g > steepest) { steepest = g; where = [x, y]; }
    }
    mown.push({ box: bbox(s.poly), low });
    const limit = s.kind === 'green' ? maxGreenSlope : s.kind === 'fairway' ? maxFairwaySlope : Infinity;
    if (steepest > limit) bad(`a ${s.kind} slopes ${(steepest * 100).toFixed(1)} % at (${where[0]}, ${where[1]}) (limit ${(limit * 100).toFixed(1)} %)`);
  }
  // water lies below the mown ground round it (within 60 m)
  for (const [i, s] of course.surfaces.entries()) {
    if (s.kind !== 'water') continue;
    const level = median(interior(s.poly).map(([x, y]) => terrain.h(x, y)));
    const b = bbox(s.poly);
    for (const m of mown) {
      const near = m.box.minX <= b.maxX + 60 && m.box.maxX >= b.minX - 60 && m.box.minY <= b.maxY + 60 && m.box.maxY >= b.minY - 60;
      if (near && !(level < m.low)) bad(`water surface ${i} (level ${level.toFixed(2)} m) does not lie below the mown ground beside it (${m.low.toFixed(2)} m)`);
    }
  }

  for (const h of course.holes) {
    const label = `hole ${h.ref} (${h.name || 'unnamed'})`;
    const atPin = surfaceAt(h.pin[0], h.pin[1]), atTee = surfaceAt(h.tee[0], h.tee[1]);
    if (atPin !== 'green') bad(`${label}: the pin is on '${atPin}', not a green`);
    if (atTee !== 'tee' && atTee !== 'fairway') bad(`${label}: the tee is on '${atTee}', not a tee or fairway`);
    for (let d = 0, len = polylineLength(h.line); d <= len; d += 2) {
      // walk the routing line
      let left = d, p = h.line[0];
      for (let i = 1; i < h.line.length; i++) {
        const seg = Math.hypot(h.line[i][0] - h.line[i - 1][0], h.line[i][1] - h.line[i - 1][1]);
        if (left <= seg || i === h.line.length - 1) { const t = seg ? Math.min(1, left / seg) : 0; p = [lerp(h.line[i - 1][0], h.line[i][0], t), lerp(h.line[i - 1][1], h.line[i][1], t)]; break; }
        left -= seg;
      }
      if (!Number.isFinite(terrain.h(p[0], p[1]))) { bad(`${label}: the terrain is not finite along the line`); break; }
    }
    const green = greens.find((g) => pointInPoly(h.pin[0], h.pin[1], g.poly));
    const gb = green ? bbox(green.poly) : null;
    stats.holes.push({
      ref: h.ref, name: h.name, par: h.par, lengthYd: h.lengthYd,
      directYd: Math.round(Math.hypot(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) / YD),
      teeHeightM: round2(terrain.h(h.tee[0], h.tee[1])), pinHeightM: round2(terrain.h(h.pin[0], h.pin[1])),
      greenM: gb ? [round2(gb.maxX - gb.minX), round2(gb.maxY - gb.minY)] : null,
      greenSlopePct: green ? round2(100 * interior(green.poly).reduce((m, [x, y]) => Math.max(m, slope(x, y)), 0)) : null,
    });
  }

  const sea = findCourseSea(course);
  if (sea === undefined) warnings.push('this Node cannot load public/render/sea.js (needs require(esm), Node 22.12+): sea not checked');
  else {
    stats.sea = sea ? { level: round2(sea.level), frac: round2(sea.frac) } : null;
    if (expect && expect.sea && !sea) bad('the hole is designed with a sea, but the sea finder (public/render/sea.js findSea) finds none in the terrain');
    if (expect && expect.sea === false && sea) bad(`the sea finder sees a sea at ${sea.level.toFixed(2)} m covering ${(sea.frac * 100).toFixed(0)} % of the grid; none is intended`);
  }
  // props are scenery: never on a green or a tee, never in the direct line of play
  // (a target-ring lies flat round a pin, a bridge is a deck over whatever it spans, and
  // balloons and blimps float far above the ground: see the notes at PROP_KINDS)
  for (const p of course.props || []) {
    if (FLOATING_PROP_KINDS.includes(p.kind) || FLAT_PROP_KINDS.includes(p.kind)) continue;
    const on = surfaceAt(p.x, p.y);
    if (on === 'green' || on === 'tee') bad(`prop ${p.id} stands on a ${on}`);
    if (SPAN_PROP_KINDS.includes(p.kind)) continue;
    if (WIDE_PROP_KINDS.includes(p.kind)) {
      // a crowd: every part of its width on dry open ground, clear of the line of play
      const [a, b] = widePropSpan(p);
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      const under = new Set();
      for (let k = 0; k <= n; k++) under.add(surfaceAt(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)));
      const wrong = [...under].filter((kind) => kind !== 'rough' && kind !== 'ob');
      if (wrong.length) bad(`prop ${p.id} (a crowd ${round2(WIDE_PROP_ASPECT * p.heightM)} m wide) reaches onto ${wrong.join(' and ')}`);
      for (const h of course.holes) {
        if (segmentsDistance(a, b, h.tee, h.pin) < 8) bad(`prop ${p.id} stands in hole ${h.ref}'s line from the tee to the pin`);
      }
      continue;
    }
    // rough, out of bounds or water (a wreck in the bay, rocks in the lava: a ball there is
    // gone anyway); never a fairway or a bunker, where a ball could lie inside the model
    if (on === 'fairway' || on === 'bunker') bad(`prop ${p.id} stands on ${on}, not on open ground`);
    for (const h of course.holes) {
      const reach = SLIM_PROP_KINDS.includes(p.kind) ? 5 : 8;
      if (distToSegment(p.x, p.y, h.tee[0], h.tee[1], h.pin[0], h.pin[1]) < reach) bad(`prop ${p.id} stands in hole ${h.ref}'s line from the tee to the pin`);
    }
  }
  for (const probe of (expect && expect.probes) || []) {
    const got = surfaceAt(probe.at[0], probe.at[1]);
    if (got !== probe.kind && !(sea === undefined && probe.kind === 'water')) bad(`${probe.what}: (${probe.at[0]}, ${probe.at[1]}) plays as '${got}', expected '${probe.kind}'`);
  }

  if (problems.length) fail();
  return { warnings, stats, courseId: source.courseId };
}

/**
 * Validate a course and publish it to <dataDir>/courses/<cache stem>.json, the name the
 * loader, the course cache and the scenery enricher all key on (osm-node-<id>.json).
 * Atomic: written beside the target and renamed over it.
 */
function writeCourse(course, dataDir, { expect = null } = {}) {
  const report = validateCourse(course, { expect });
  const dir = path.join(dataDir, 'courses');
  fs.mkdirSync(dir, { recursive: true });
  const file = `${courseCacheStem(course.source)}.json`;
  const bytes = Buffer.from(JSON.stringify(course));
  courseLib.atomicWriteOwned(path.join(dir, file), bytes);
  return { file, path: path.join(dir, file), bytes: bytes.length, ...report };
}

module.exports = {
  YD, BOUNDARY_BUFFER_M, ARCADE_OSM_ID_BASE, SURFACE_KINDS, PLAY_PRIORITY, PROP_KINDS,
  FLAT_PROP_KINDS, SPAN_PROP_KINDS, FLOATING_PROP_KINDS, SLIM_PROP_KINDS, WIDE_PROP_KINDS, WIDE_PROP_ASPECT,
  THEMES, STAGE_ROLES, TIMES_OF_DAY, CONDITIONS, BLURB_MAX, TOUR_STAGES, MAX_MATCH_ORDER, MAX_TIEBREAK_ORDER, FREE_BALLS, ROUTE_IDS, WIND_MAX_MPH,
  // numbers
  round2, lerp, clamp, smoothstep, yards, metres, mulberry32,
  // polygons
  signedArea, polygonArea, ensureCCW, centroid, bbox, pointInPoly, distToSegment, distToPolyline, distToEdges,
  signedDistance, polylineLength, translate, offsetPolygon, smoothPolygon, roundCorners, convexHull,
  // shapes
  rect, arc, ellipse, blob, spline, capsule, radiusOf, ring,
  // heights
  fbm, bump, plateauWeight, plane, Heightfield, nearField, ridged, strata, tiers, awayFrom,
  // trees and props
  scatterTrees, clusterTrees, prop, facing, widePropSpan,
  // courses
  arcadeSource, normalizeStage, normalizeRoutes, assembleCourse, findCourseSea, validateCourse, writeCourse, ArcadeCourseError,
};
