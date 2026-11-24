'use strict';
// Shared helpers for the detail-a stages (lagoon-island, canyon-run, lighthouse-point,
// volcano-drop): fast distance fields, terraced rock, and builders that mass props into
// vignettes and then keep only those that stand where a prop may stand. Not a hole file
// (it lives beside lib.js, outside holes/, so the catalogue does not take it for one).

const L = require('./lib');

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

// ---------------------------------------------------------------- distance fields

// signedDistance with a bounding-box early out: exact within `reach` metres of the polygon,
// and -(reach + 1) (far outside) beyond it. Height functions call this for every grid node.
function sdf(poly, reach = 60) {
  const b = L.bbox(poly);
  const far = -(reach + 1);
  return (x, y) => (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach ? far : L.signedDistance(x, y, poly));
}

// plateauWeight on an sdf: 1 inside, falling to 0 featherM outside.
const inside = (sd, featherM) => L.smoothstep(-featherM, 0, sd);

// ---------------------------------------------------------------- rock

// Strata: a rise of h metres becomes steps `step` high, each a tread and a riser. riser is
// the share of a step's run that the riser takes (small: sheer bands; 1: no terracing).
function terrace(h, step, riser = 0.3) {
  const k = Math.floor(h / step), f = h / step - k;
  return (k + L.smoothstep(0.5 - riser / 2, 0.5 + riser / 2, f)) * step;
}

// Piecewise-linear profile through [[t, v], ...] (t ascending), clamped at both ends.
function profile(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) return L.lerp(points[i - 1][1], points[i][1], (t - points[i - 1][0]) / (points[i][0] - points[i - 1][0]));
    }
    return points[points.length - 1][1];
  };
}

// Where along a polyline (0 at its start .. 1 at its end, by length) the nearest point to (x, y) lies.
function alongLine(line) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) { const len = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); seg.push({ at: total, len }); total += len; }
  return (x, y) => {
    let best = Infinity, where = 0;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][0], ay = line[i - 1][1], dx = line[i][0] - ax, dy = line[i][1] - ay;
      const s = seg[i - 1], t = s.len ? L.clamp(((x - ax) * dx + (y - ay) * dy) / (s.len * s.len), 0, 1) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) { best = d; where = (s.at + t * s.len) / total; }
    }
    return where;
  };
}

// The slope of a height function at a point (rise over run), by central differences.
function slopeOf(height, x, y, e = 2) {
  return Math.hypot(height(x + e, y) - height(x - e, y), height(x, y + e) - height(x, y - e)) / (2 * e);
}

// ---------------------------------------------------------------- props

const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });

// n props on a circle (or an arc a0..a1 degrees, counter-clockwise from east). face: 'in',
// 'out', a number (rotDeg) or 'spin' (seeded). h: a height or [lo, hi].
function ringOf(kind, cx, cy, r, n, { h = 5, face = 'spin', seed = 1, arc = null, jitter = 0 } = {}) {
  const rnd = L.mulberry32(seed);
  const out = [];
  const [a0, a1] = arc || [0, 360];
  for (let i = 0; i < n; i++) {
    const a = L.lerp(a0, a1, arc ? (n === 1 ? 0.5 : i / (n - 1)) : i / n) * RAD;
    const rr = r * (1 + (rnd() - 0.5) * 2 * jitter);
    const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    const hh = Array.isArray(h) ? L.lerp(h[0], h[1], rnd()) : h;
    const rot = face === 'in' ? L.facing(x, y, cx, cy) : face === 'out' ? L.facing(x, y, 2 * x - cx, 2 * y - cy) : face === 'spin' ? rnd() * 360 : face;
    out.push(P(kind, x, y, hh, rot));
  }
  return out;
}

// n props evenly along a line (both ends included). face: a number, 'spin', or [tx, ty] to look at.
function rowOf(kind, a, b, n, { h = 5, face = 'spin', seed = 1, jitter = 0 } = {}) {
  const rnd = L.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = L.lerp(a[0], b[0], t) + (rnd() - 0.5) * 2 * jitter, y = L.lerp(a[1], b[1], t) + (rnd() - 0.5) * 2 * jitter;
    const hh = Array.isArray(h) ? L.lerp(h[0], h[1], rnd()) : h;
    const rot = Array.isArray(face) ? L.facing(x, y, face[0], face[1]) : face === 'spin' ? rnd() * 360 : face;
    out.push(P(kind, x, y, hh, rot));
  }
  return out;
}

// n props scattered over a disc { x, y, r } (ry optional) or a polygon, at least minGap apart.
function scatter(kind, area, n, { h = 5, seed = 1, minGap = 4, face = 'spin', keep = null } = {}) {
  const rnd = L.mulberry32(seed);
  const poly = Array.isArray(area) ? area : null;
  const box = poly ? L.bbox(poly) : null;
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 60; tries++) {
    let x, y;
    if (poly) {
      x = L.lerp(box.minX, box.maxX, rnd()); y = L.lerp(box.minY, box.maxY, rnd());
      if (!L.pointInPoly(x, y, poly)) continue;
    } else {
      const a = rnd() * TAU, q = Math.sqrt(rnd());
      x = area.x + q * area.r * Math.cos(a); y = area.y + q * (area.ry || area.r) * Math.sin(a);
    }
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < minGap)) continue;
    if (keep && !keep(x, y)) continue;
    const hh = Array.isArray(h) ? L.lerp(h[0], h[1], rnd()) : h;
    out.push(P(kind, x, y, hh, Array.isArray(face) ? L.facing(x, y, face[0], face[1]) : face === 'spin' ? rnd() * 360 : face));
  }
  return out;
}

// Keep only the props that stand where validateCourse lets a prop stand: off every tee,
// green, fairway and bunker (a bridge only off greens and tees), clear of the straight line
// from the tee to the pin (8 m, 5 m for the slim kinds), and a crowd with its whole width on
// ground that `dry(x, y)` accepts (a crowd may not stand in water). Floating and flat kinds
// always pass. `also(p)` can refuse more. Returns the survivors, in order.
function clean(props, { surfaces, tee, pin, dry = null, also = null }) {
  const mown = surfaces.filter((s) => s.kind === 'tee' || s.kind === 'green' || s.kind === 'fairway' || s.kind === 'bunker')
    .map((s) => ({ kind: s.kind, poly: s.poly, box: L.bbox(s.poly) }));
  const on = (x, y, kinds) => mown.some((m) => kinds.includes(m.kind) && x >= m.box.minX && x <= m.box.maxX && y >= m.box.minY && y <= m.box.maxY && L.pointInPoly(x, y, m.poly));
  const drop = (p, why) => { if (process.env.DETAIL_DEBUG) console.log(`   dropped ${p.kind} (${p.x}, ${p.y}): ${why}`); return false; };
  return props.filter((p) => {
    if (L.FLOATING_PROP_KINDS.includes(p.kind) || L.FLAT_PROP_KINDS.includes(p.kind)) return true;
    if (also && !also(p)) return drop(p, 'also');
    if (L.SPAN_PROP_KINDS.includes(p.kind)) return !on(p.x, p.y, ['tee', 'green']);
    if (L.WIDE_PROP_KINDS.includes(p.kind)) {
      // its width runs across its facing: east-west at rotDeg 0
      const half = (L.WIDE_PROP_ASPECT * p.heightM) / 2 + 1, c = Math.cos(p.rotDeg * RAD), s = Math.sin(p.rotDeg * RAD);
      for (let k = -1; k <= 1; k += 0.125) {
        const x = p.x + k * half * c, y = p.y - k * half * s;
        if (on(x, y, ['tee', 'green', 'fairway', 'bunker']) || (dry && !dry(x, y))) return drop(p, 'crowd not on dry open ground');
        if (L.distToSegment(x, y, tee[0], tee[1], pin[0], pin[1]) < 10) return drop(p, 'crowd on the line');
      }
      return true;
    }
    if (on(p.x, p.y, ['tee', 'green', 'fairway', 'bunker'])) return drop(p, 'on mown ground or sand');
    return L.distToSegment(p.x, p.y, tee[0], tee[1], pin[0], pin[1]) >= (L.SLIM_PROP_KINDS.includes(p.kind) ? 5.5 : 8.5) || drop(p, 'on the line');
  });
}

// Keep the trees that stand on open ground: clearM off every mown surface, bunker and water
// polygon, where `ok(x, y)` agrees (height, slope, distance from a sea), and lineM off the
// straight line from the tee to the pin.
function cleanTrees(trees, { surfaces, tee, pin, clearM = 4, lineM = 0, ok = null }) {
  const polys = surfaces.filter((s) => s.kind !== 'rough').map((s) => ({ poly: s.poly, box: L.bbox(s.poly) }));
  return trees.filter(([x, y]) => {
    if (ok && !ok(x, y)) return false;
    if (lineM && L.distToSegment(x, y, tee[0], tee[1], pin[0], pin[1]) < lineM) return false;
    return !polys.some((m) => x >= m.box.minX - clearM && x <= m.box.maxX + clearM && y >= m.box.minY - clearM && y <= m.box.maxY + clearM && L.signedDistance(x, y, m.poly) > -clearM);
  });
}

module.exports = { TAU, RAD, sdf, inside, terrace, profile, alongLine, slopeOf, P, ringOf, rowOf, scatter, clean, cleanTrees };

// n points evenly along a polyline, pushed `offset` metres to the LEFT of its direction of
// travel (negative: to the right): for lining a path with torches, banners or palms.
function beside(line, n, offset = 0) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) { const len = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); seg.push(len); total += len; }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (n === 1 ? 0.5 : k / (n - 1)) * total, i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const a = line[i], b = line[i + 1], t = seg[i] ? d / seg[i] : 0;
    const tx = (b[0] - a[0]) / (seg[i] || 1), ty = (b[1] - a[1]) / (seg[i] || 1);
    out.push([L.lerp(a[0], b[0], t) - ty * offset, L.lerp(a[1], b[1], t) + tx * offset]);
  }
  return out;
}

module.exports.beside = beside;
