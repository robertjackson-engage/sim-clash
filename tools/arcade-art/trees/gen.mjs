// The arcade trees' models, grown in code. Pure (no three, no DOM, no files): build.mjs
// writes what this makes to public/arcade/trees/<species>.glb, and the tests grow the same
// models in Node.
//
// Four ways a tree is put together, each a function of a parameter set:
//
//   lobed    a trunk with root flare, limbs that each carry a LOBE of the crown, and the
//            lobe's leaf cards (two crossed cards a cluster) on its shell. A crown is a
//            handful of lobes with sky between them, never one lump: kapok, strangler fig,
//            jungle and sea-almond broadleaves, acacia, juniper, cherry, maple, the cloud
//            pine, the wind-bent pine, the clipped street tree.
//   rosette  a stem with a crown of long leaves at its top, each a curved strip: coconut,
//            date and fan palms, banana, tree fern.
//   conifer  a leader with whorls of boughs that droop and curl: spruce, fir, bare larch.
//   snag     a dead tree: a broken bole, a few limbs, twigs.
//
// A model is built at its species' reference height (metres, y up, the trunk's foot at the
// origin) and scaled per tree in the game. See public/render/tree-glb.js for the vertex
// layout; LOD_KEEP for how the far levels are cut.
import { LEAF_TILES, LEAF_GRID, BARK_COLUMNS } from './textures.mjs';

// the share of a model's leaf cards each level of detail keeps (the game fades cards out by
// rank as a tree recedes, so the switch from one level to the next is never a pop)
export const LOD_KEEP = Object.freeze([1, 0.42, 0.15]);
const LOD_CUT_MARGIN = 1.08;   // a level's index holds the cards up to this x its keep (tree-models.js cardVisible)

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const UP = [0, 1, 0];
const GOLDEN = 2.399963;
const bez = (a, c, b, t) => lerp3(lerp3(a, c, t), lerp3(c, b, t), t);
// a point on the unit sphere, i of n, evenly spread (a Fibonacci spiral), y from yLo to yHi
const fib = (i, n, yLo = -1, yHi = 1, turn = 0) => { const y = lerp(yLo, yHi, (i + 0.5) / n), rr = Math.sqrt(Math.max(0, 1 - y * y)), a = i * GOLDEN + turn; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; };
const pick = (r, list) => { let t = r() * list.reduce((s, e) => s + e[1], 0); for (const e of list) { t -= e[1]; if (t <= 0) return e[0]; } return list[list.length - 1][0]; };

export function tileRect(tile) {
  const i = LEAF_TILES.indexOf(tile);
  if (i < 0) throw new Error(`no leaf tile "${tile}"`);
  const [GX, GY] = LEAF_GRID, c = i % GX, row = Math.floor(i / GX), pad = 14 / 512;   // the picture's own margin in its tile (textures.mjs)
  // (s, t) in the tile, t = 0 at the BOTTOM of its picture, to atlas uv (v up)
  return (s, t) => [(c + pad + (1 - 2 * pad) * s) / GX, 1 - (row + 1 - pad - (1 - 2 * pad) * t) / GY];
}

// ---------------------------------------------------------------- the mesh being built
export class Model {
  constructor(seed) {
    this.r = rng(seed);
    this.pos = []; this.nor = []; this.uv = []; this.data = []; this.tint = []; this.wind = []; this.piv = [];
    this.bark = [[], [], []];
    this.units = [];
    this.trunkPath = null;
    this.leafStats = [];   // [x, y, z] of every crown card corner (for the crown's measured size)
  }
  get count() { return this.pos.length / 3; }
  v(p, n, uv, data, tint, wind, piv = null) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    this.data.push(data[0], data[1], data[2], data[3]);
    this.tint.push(tint[0], tint[1], tint[2], tint[3] ?? 0);
    this.wind.push(wind[0], wind[1], wind[2], wind[3]);
    if (piv) this.piv.push(p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]); else this.piv.push(0, 0, 0);
    return this.count - 1;
  }

  // A tube swept along path [{ p, r }]: bark. lods: which levels of detail draw it.
  // ring(theta, i): a multiplier on the radius round the section (root flare, a buttress).
  tube(path, { sides = 6, lods = [0, 1], col = 0, tint = [1, 1, 1], ao = null, sway = null, phase = 0, ring = null, cap = false, vScale = 3, frame0 = null, snow = 0.5 } = {}) {
    const n = path.length;
    if (n < 2) return;
    const tan = path.map((_, i) => norm(sub(path[Math.min(n - 1, i + 1)].p, path[Math.max(0, i - 1)].p)));
    let nr = frame0 ? norm(sub(frame0, mul(tan[0], dot(frame0, tan[0])))) : norm(cross(tan[0], Math.abs(tan[0][1]) > 0.9 ? [1, 0, 0] : UP));
    const uRep = Math.max(1, Math.round((2 * Math.PI * path[0].r) / 1.5));
    const colN = (typeof col === 'string' ? BARK_COLUMNS.indexOf(col) : col);
    const rows = [];
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) { nr = norm(sub(nr, mul(tan[i], dot(nr, tan[i])))); along += len(sub(path[i].p, path[i - 1].p)); }
      const bi = cross(tan[i], nr);
      const row = [];
      for (let k = 0; k <= sides; k++) {
        const th = (k / sides) * Math.PI * 2;
        const dir = add(mul(nr, Math.cos(th)), mul(bi, Math.sin(th)));
        const p = add(path[i].p, mul(dir, path[i].r * (ring ? ring(th, i, path[i]) : 1)));
        row.push(this.v(p, dir, [(k / sides) * uRep, along / vScale], [ao ? ao(p, i) : 1, sway ? sway(i / (n - 1), p) : 0, 0, 0], [tint[0], tint[1], tint[2], colN], [phase, 0, 0, snow]));
      }
      rows.push(row);
    }
    const out = [];
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
      out.push(a, b, c, a, c, d);
    }
    if (cap) {
      const e = path[n - 1], tip = this.v(add(e.p, mul(tan[n - 1], e.r * 0.5)), tan[n - 1], [0.5, along / vScale], [ao ? ao(e.p, n - 1) : 1, sway ? sway(1, e.p) : 0, 0, 0], [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8, colN], [phase, 0, 0, snow]);
      for (let k = 0; k < sides; k++) out.push(rows[n - 1][k], rows[n - 1][k + 1], tip);
    }
    for (const l of lods) this.bark[l].push(...out);
  }

  // The trunk: drawn full at the two near levels and as a four-sided post at the far one.
  trunk(path, o = {}) {
    this.trunkPath = path;
    this.tube(path, { ...o, lods: [0, 1] });
    const far = path.filter((_, i) => i % 2 === 0 || i === path.length - 1);
    this.tube(far, { ...o, sides: Math.min(4, o.sides || 6), lods: [2], ring: null });
  }

  // One leaf card: a quad, centre c, half-extents right / up, drawn with `tile`.
  // o: { pivot, group, late, normal(p), ao(p), tint, sway(p), flutter, phase, grow, snow, flip, hang, crown,
  //      cup, out }. cup > 0 makes it a shallow tent of four triangles, its middle pushed `cup` x
  // its half-size toward `out`: a cluster with depth from the side, never a line.
  quad(c, right, up, tile, o = {}) {
    const rect = tileRect(tile);
    const idx = [];
    const fl = o.flip ? -1 : 1;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    if (o.cup) corners.push([0, 0]);
    let bulge = [0, 0, 0];
    if (o.cup) { let n = norm(cross(right, up)); if (o.out && dot(n, o.out) < 0) n = mul(n, -1); bulge = mul(n, o.cup * len(right)); }
    for (const [sx, sy] of corners) {
      const mid = sx === 0 && sy === 0;
      const p = mid ? add(c, bulge) : [c[0] + right[0] * sx + up[0] * sy - bulge[0] * 0.5, c[1] + right[1] * sx + up[1] * sy - bulge[1] * 0.5, c[2] + right[2] * sx + up[2] * sy - bulge[2] * 0.5];
      const fluW = typeof o.flutter === 'function' ? o.flutter(sx, sy) : (o.flutter ?? 1);
      idx.push(this.v(p, o.normal ? o.normal(p) : norm(cross(right, up)), rect(0.5 + 0.5 * sx * fl, 0.5 + 0.5 * sy),
        [o.ao ? o.ao(p) : 1, typeof o.sway === 'function' ? o.sway(p, sx, sy) : (o.sway ?? 0.5), fluW, 1], [...(o.tint || [1, 1, 1]), 0], [o.phase ?? 0, 0, o.grow ?? 1, o.snow ?? 0.6], o.pivot || c));
      if (o.crown !== false && !mid) this.leafStats.push(p);
    }
    const u = { tris: o.cup ? [idx[0], idx[1], idx[4], idx[1], idx[2], idx[4], idx[2], idx[3], idx[4], idx[3], idx[0], idx[4]] : [idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]], verts: idx, group: o.group ?? 0, late: !!o.late };
    this.units.push(u);
    return u;
  }

  // A long leaf (frond, bough, banana leaf): a strip along `pts`, `cols` vertices across
  // (3 = folded about its midrib: fold > 0 droops the edges, < 0 lifts them).
  // side(i): the across vector (unit) at point i; half(i): half-width there.
  strip(pts, tile, { side, half, fold = 0, roll = 0, group = 0, late = false, normal = null, ao = null, tint = [1, 1, 1], sway = null, flutter = null, phase = 0, grow = 0.3, snow = 0.7, pivot = null, flip = false, crown = true, v0 = 0, v1 = 1 } = {}) {
    const rect = tileRect(tile);
    const n = pts.length, rows = [];
    const piv = pivot || pts[0];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
      let sd = side(i, tan);
      const hw = half(i, s), fo = typeof fold === 'function' ? fold(s) : fold;
      if (roll) { const ro = typeof roll === 'function' ? roll(s) : roll, up0 = norm(cross(sd, tan)); sd = norm(add(mul(sd, Math.cos(ro)), mul(up0, Math.sin(ro)))); }
      const nn = norm(cross(sd, tan));   // the strip's own up
      const row = [];
      for (const k of [-1, 0, 1]) {
        const p = add(add(pts[i], mul(sd, hw * k * (1 - 0.25 * fo * fo))), mul(nn, -Math.abs(k) * fo * hw));
        const gn = norm(add(nn, mul(sd, k * fo * 0.8)));
        row.push(this.v(p, normal ? normal(p, gn, s) : gn, rect(0.5 + 0.5 * k * (flip ? -1 : 1), lerp(v0, v1, s)),
          [ao ? ao(p, s, k) : 1, sway ? sway(s, p) : s, flutter ? flutter(s, k) : s * (0.35 + 0.65 * Math.abs(k)), 1], [...tint, 0], [phase, 0, grow, snow], piv));
        if (crown) this.leafStats.push(p);
      }
      rows.push(row);
    }
    const tris = [], verts = rows.flat();
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < 2; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
      tris.push(a, b, c, a, c, d);
    }
    const u = { tris, verts, group, late };
    this.units.push(u);
    return u;
  }

  // A small solid lump (a coconut, a bunch of dates): bark-kind, its own colour.
  blob(c, rad, tint, { col = 'smooth', lods = [0, 1], ao = 0.9, sway = 0, phase = 0 } = {}) {
    const colN = BARK_COLUMNS.indexOf(col);
    const ids = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]].map((d) => this.v(add(c, mul(d, rad)), d, [0.5 + d[0] * 0.2, 0.2 + d[1] * 0.1], [ao * (0.8 + 0.2 * d[1]), sway, 0, 0], [tint[0], tint[1], tint[2], colN], [phase, 0, 0, 0.3]));
    const f = [[0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4], [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1]];
    for (const l of lods) for (const t of f) this.bark[l].push(ids[t[0]], ids[t[1]], ids[t[2]]);
  }

  // Rank the leaf cards (which drop out first as the tree recedes), cut the three index
  // buffers, measure the model. Cards are ranked round-robin over their groups (a lobe, a
  // whorl), so what a far tree keeps is spread over the whole crown.
  finish(meta) {
    const r = this.r;
    const groups = new Map();
    for (const u of this.units) { const k = `${u.late ? 1 : 0}:${u.group}`; (groups.get(k) || groups.set(k, []).get(k)).push(u); }
    const order = [];
    for (const late of [0, 1]) {
      const lists = [...groups.entries()].filter(([k]) => k.startsWith(`${late}:`)).map(([, l]) => { const a = l.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; });
      for (let i = lists.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lists[i], lists[j]] = [lists[j], lists[i]]; }
      for (let depth = 0, more = true; more; depth++) { more = false; for (const l of lists) if (depth < l.length) { order.push(l[depth]); more = true; } }
    }
    const N = order.length;
    order.forEach((u, i) => { const rank = (i + 0.5) / N; for (const vi of u.verts) this.wind[vi * 4 + 1] = rank; u.rank = rank; });
    const lods = LOD_KEEP.map((keep, l) => {
      const idx = this.bark[l].slice();
      for (const u of order) if (l === 0 || u.rank < keep * LOD_CUT_MARGIN) idx.push(...u.tris);
      return Uint32Array.from(idx);
    });
    const q8 = (arr, scale = 1) => Uint8Array.from(arr, (v) => Math.round(255 * clamp(v * scale)));
    const tint = new Uint8Array(this.tint.length);
    for (let i = 0; i < this.tint.length; i += 4) { for (let k = 0; k < 3; k++) tint[i + k] = Math.round(255 * clamp(this.tint[i + k] * 0.5)); tint[i + 3] = Math.round((this.tint[i + 3] / 8) * 255 + 8); }
    // measured: the crown (leaf cards), the trunk at a metre, how far the bole leans by the crown's foot
    const ys = this.leafStats.map((p) => p[1]).sort((a, b) => a - b);
    const reach = this.leafStats.map((p) => Math.hypot(p[0], p[2])).sort((a, b) => a - b);
    const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    let maxY = 0;
    for (let i = 1; i < this.pos.length; i += 3) maxY = Math.max(maxY, this.pos[i]);
    const tp = this.trunkPath || [{ p: [0, 0, 0], r: 0.2 }, { p: [0, 1, 0], r: 0.2 }];
    const at = (y) => {
      for (let i = 1; i < tp.length; i++) if (tp[i].p[1] >= y || i === tp.length - 1) { const a = tp[i - 1], b = tp[i], t = clamp((y - a.p[1]) / Math.max(1e-6, b.p[1] - a.p[1])); return { p: lerp3(a.p, b.p, t), r: lerp(a.r, b.r, t) }; }
      return tp[tp.length - 1];
    };
    const crownBase = pct(ys, 0.04), H = meta.H;
    const round3 = (v) => Math.round(v * 1000) / 1000;
    const foot = at(Math.min(crownBase, tp[tp.length - 1].p[1]));
    return {
      attributes: {
        position: Float32Array.from(this.pos), normal: Float32Array.from(this.nor), uv: Float32Array.from(this.uv),
        aData: q8(this.data), aTint: tint, aWind: q8(this.wind), aPivot: Float32Array.from(this.piv),
      },
      lods,
      meta: {
        ...meta,
        top: round3(maxY), crownBase: round3(crownBase), crownTop: round3(pct(ys, 0.99)), crownR: round3(pct(reach, 0.95)),
        trunkR: round3(at(1).r), trunkTop: round3(tp[tp.length - 1].p[1]),
        leanAtCrown: round3(Math.hypot(foot.p[0], foot.p[2])), leanMid: round3(Math.hypot(at(maxY * 0.5).p[0], at(maxY * 0.5).p[2])),
        cards: N, verts: this.count, tris: lods.map((l) => l.length / 3),
      },
    };
  }
}

// ---------------------------------------------------------------- shared parts
// A bole from below the ground to yTop: flare at the foot, a taper, a lean that starts
// upright (the ball's trunk is a vertical cylinder: tree-obstacles.js), a little wander.
function bolePath(M, { H, yTop, R, taper = 0.5, flare = 0.6, flareH = 0.05, lean = [0, 0], wobble = 0, steps = 9, twist = 0 }) {
  const r = M.r, ph = r() * 6.283, ph2 = r() * 6.283;
  const at = (y) => {
    const f = clamp(y / H);
    const w = wobble * Math.sin(f * Math.PI) * (1 - 0.3 * f);
    return [lean[0] * f * f + w * Math.sin(f * 5.2 * (1 + twist) + ph), y, lean[1] * f * f + w * Math.cos(f * 4.1 * (1 + twist) + ph2)];
  };
  const rad = (y) => R * (1 - taper * clamp(y / yTop)) * (1 + flare * Math.exp(-Math.max(0, y) / (flareH * H)));
  const path = [{ p: at(-0.7), r: rad(0) * 1.12 }];
  // more rings low down, where the flare is
  for (const y of [0, 0.02 * H, 0.05 * H, 0.1 * H]) if (y < yTop) path.push({ p: at(y), r: rad(y) });
  for (let i = 1; i <= steps; i++) { const y = lerp(0.1 * H, yTop, i / steps); path.push({ p: at(y), r: rad(y) }); }
  return { path, at, rad };
}

// Surface roots (a few low tubes running out into the ground) or a kapok's buttresses
// (tall thin fins). They are part of the two near levels only.
function roots(M, bole, { n, H, reach, rise, thick, col, tint, fin = 0, hero = false }) {
  const r = M.r, a0 = r() * 6.283;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * 6.283 + (r() - 0.5) * 0.5, d = [Math.cos(a), 0, Math.sin(a)];
    const hi = rise * (0.75 + 0.5 * r()), far = reach * (0.8 + 0.4 * r());
    const top = bole.at(hi), R0 = bole.rad(hi);
    const a1 = add(top, mul(d, R0 * 0.4)), b1 = add(bole.at(0), mul(d, far)), ctrl = add(bole.at(hi * 0.25), mul(d, R0 * 1.15 + far * 0.18));
    b1[1] = -0.5;
    const path = (hero ? [0, 0.18, 0.36, 0.54, 0.72, 0.88, 1] : [0, 0.3, 0.6, 0.85, 1]).map((t) => ({ p: bez(a1, ctrl, b1, t), r: thick * R0 * lerp(1, 0.45, t) }));
    M.tube(path, { sides: hero ? 7 : 5, lods: [0, 1], col, tint, frame0: UP, ring: fin ? (th) => 0.45 + fin * Math.abs(Math.cos(th)) : null, ao: (p) => 0.55 + 0.45 * smooth(0, hi, p[1]), snow: 0.8 });
  }
}

const barkAO = (yb) => (p) => lerp(0.7, 1, smooth(0, 0.9, p[1])) * lerp(1, 0.6, smooth(yb * 0.55, yb * 1.05, p[1]));

// ---------------------------------------------------------------- lobed crowns
function lobed(M, S) {
  const r = M.r, H = S.H;
  const yb = H * S.base * (0.94 + 0.12 * r());
  const rx = H * S.width * (0.92 + 0.16 * r());
  const ry = (H - yb) / 2 * (S.crownH ?? 1);
  const R = S.trunkR * H;
  const yTop = yb + (H - yb) * (S.leader ?? 0.35);
  const leanA = S.leanDir ?? r() * 6.283, leanM = (S.lean ?? 0.4) * (0.5 + 0.5 * r());
  const hero = !!S.hero;
  const bole = bolePath(M, { H, yTop, R, taper: S.taper ?? 0.55, flare: S.flare ?? 0.7, flareH: S.flareH ?? 0.04, lean: [Math.cos(leanA) * leanM, Math.sin(leanA) * leanM], wobble: S.wobble ?? 0.12, twist: S.twist ?? 0, steps: hero ? 14 : 9 });
  const tint = S.barkTint || [1, 1, 1];
  const cy = H - ry * (S.crownH ? 1 : 1);
  const sweep = S.sweep || [0, 0];
  const C = add(bole.at(Math.min(cy, yTop)), [sweep[0] * 0.5, 0, sweep[1] * 0.5]);
  C[1] = cy;
  const ao = barkAO(yb);
  const mainStems = S.stems || 1;
  M.trunk(bole.path, { sides: (S.sides ?? 8) + (hero ? 4 : 0), col: S.bark, tint, ao, ring: S.rootRing ? (th, i, pt) => 1 + S.rootRing * Math.exp(-Math.max(0, pt.p[1]) / (0.03 * H)) * Math.max(0, Math.cos(th * (S.rootN || 5))) ** 2 : null });
  if (S.roots || hero) roots(M, bole, { n: (S.roots || 2) + (hero ? 3 : 0), H, reach: (S.rootReach ?? 3.2) * R * (hero ? 1.3 : 1), rise: (S.rootRise ?? 0.05) * H * (hero ? 1.15 : 1), thick: S.rootThick ?? 0.5, col: S.bark, tint, fin: S.fin || 0, hero });
  // a strangler's lattice: stems winding up the bole
  for (let s = 0; s < (S.lattice || 0); s++) {
    const a0 = r() * 6.283, turns = 0.5 + r() * 0.7, dirn = r() < 0.5 ? 1 : -1, path = [];
    for (let i = 0; i <= 8; i++) { const y = lerp(-0.5, yTop * 0.95, i / 8), a = a0 + dirn * turns * 6.283 * (i / 8), rr = bole.rad(Math.max(0, y)) * 0.95; const c = bole.at(y); path.push({ p: [c[0] + Math.cos(a) * rr, y, c[2] + Math.sin(a) * rr], r: R * lerp(0.36, 0.2, i / 8) }); }
    M.tube(path, { sides: 4, lods: [0, 1], col: S.bark, tint: mul(tint, 0.92), ao });
  }

  // the lobes: spread over the crown's envelope, low ones first
  const lobes = [];
  const yLo = Math.sin((S.elMin ?? -30) * Math.PI / 180);
  const turn = r() * 6.283;
  for (let i = 0; i < S.lobes; i++) {
    const d = fib(i, S.lobes, yLo, 1, turn);
    const lr = S.lobeR * rx * (0.82 + 0.36 * r());
    const flat = S.lobeFlat ?? 0.8;
    const k = 1 - (S.lobeIn ?? 0.7) * lr / rx;
    const hf = 0.5 + 0.5 * d[1];
    const c = [C[0] + d[0] * rx * k + sweep[0] * hf * (0.6 + 0.6 * r()), C[1] + d[1] * Math.max(0.05, ry - lr * flat * 0.7), C[2] + d[2] * rx * k + sweep[1] * hf * (0.6 + 0.6 * r())];
    c[1] += (r() - 0.5) * (S.lobeJitterY ?? 0.5) * lr;
    lobes.push({ c, lr, flat, phase: r(), i });
  }
  // the crown's heart: a darker mass the lobes stand round, so the middle never shows sky
  if (S.core !== 0) lobes.push({ c: [C[0], C[1] - ry * 0.12, C[2]], lr: rx * (S.core ?? 0.5), flat: clamp(ry / rx, 0.4, 1) * 0.95, phase: r(), i: S.lobes, core: true });
  const eNorm = (p) => norm([(p[0] - C[0]) / rx, (p[1] - C[1]) / Math.max(ry, rx * 0.35), (p[2] - C[2]) / rx]);
  const eRel = (p) => Math.hypot((p[0] - C[0]) / rx, (p[1] - C[1]) / Math.max(ry, rx * 0.3), (p[2] - C[2]) / rx);
  const tiles = S.tiles, tints = S.tints || [[[1, 1, 1], 1]];
  const droopy = new Set(['broadB', 'vine', 'grass', 'frond', 'blossom']);

  for (const L of lobes) {
    if (L.core) { leaves(L); continue; }
    // --- the limb that carries it
    const hd = Math.hypot(L.c[0] - bole.at(L.c[1])[0], L.c[2] - bole.at(L.c[1])[2]);
    const ys = clamp(L.c[1] - hd * (S.limbRise ?? 0.6) - L.lr * 0.3, yb * (S.limbLow ?? 0.8), yTop);
    const start = bole.at(ys), end = lerp3(L.c, start, 0.12);
    end[1] -= L.lr * L.flat * 0.25;
    const out = norm([end[0] - start[0], 0, end[2] - start[2]]);
    const ctrl = add(add(start, mul(out, hd * (S.limbOut ?? 0.45))), [0, (end[1] - start[1]) * (S.limbCurve ?? 0.75), 0]);
    const r0 = bole.rad(ys) * (S.limbR ?? 0.62) * (0.8 + 0.3 * r()) / Math.sqrt(mainStems), r1 = 0.05 * (H / 14) + 0.015;
    const limb = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ p: bez(start, ctrl, end, t), r: lerp(r0, r1, t ** 0.8) }));
    const limbFull = hero ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => ({ p: bez(start, ctrl, end, t), r: lerp(r0, r1, t ** 0.8) })) : limb;
    const lsway = (t) => 0.55 * t * clamp(hd / rx);
    M.tube(limbFull, { sides: hero ? 7 : 5, lods: [0, 1], col: S.bark, tint, ao: (p) => ao(p) * 0.9, sway: lsway, phase: L.phase });
    // a hero's limb forks: two boughs leaving it for the sides of its lobe, so the branching reads from below
    for (let k = 0; hero && k < 2; k++) {
      const d = norm([r() - 0.5, r() * 0.5 + 0.1, r() - 0.5]);
      const tip = add(L.c, [d[0] * L.lr * 0.7, d[1] * L.lr * L.flat * 0.7, d[2] * L.lr * 0.7]);
      const from = limb[1 + k], mid = add(lerp3(from.p, tip, 0.5), [0, L.lr * 0.12, 0]);
      M.tube([0, 0.33, 0.66, 1].map((t) => ({ p: bez(from.p, mid, tip, t), r: lerp(from.r * 0.62, 0.03, t ** 0.7) })), { sides: 5, lods: [0, 1], col: S.bark, tint, ao: (p) => ao(p) * 0.8, sway: (t) => lsway(0.5 + 0.5 * t), phase: L.phase });
    }
    if (S.showLimbs) M.tube([limb[0], limb[2], limb[4]], { sides: 3, lods: [2], col: S.bark, tint, ao: (p) => ao(p) * 0.9, sway: lsway, phase: L.phase });
    // twigs into the lobe (near level only): the branching you read against the sky
    for (let k = 0; k < (S.twigs ?? 3) + (hero ? 2 : 0); k++) {
      const d = norm([r() - 0.5, r() * 0.8 - 0.15, r() - 0.5]);
      const tip = add(L.c, [d[0] * L.lr * 0.85, d[1] * L.lr * L.flat * 0.85, d[2] * L.lr * 0.85]);
      const from = limb[2 + (k % 2)];
      M.tube([{ p: from.p, r: from.r * 0.55 }, { p: lerp3(from.p, tip, 0.55), r: Math.max(0.018, from.r * 0.3) }, { p: tip, r: 0.012 }], { sides: 3, lods: [0], col: S.bark, tint, ao: () => 0.6, sway: (t) => lsway(1) * (0.6 + 0.4 * t), phase: L.phase });
    }
    // an aerial root dropping from the limb to the ground (a strangler fig)
    if (S.aerial && r() < S.aerial && hd > rx * 0.35) {
      const from = limb[1].p, foot = [from[0] * 1.15 + (r() - 0.5) * 0.5, -0.4, from[2] * 1.15 + (r() - 0.5) * 0.5];
      M.tube([{ p: from, r: 0.1 }, { p: lerp3(from, foot, 0.5), r: 0.085 }, { p: lerp3(from, foot, 0.9), r: 0.1 }, { p: foot, r: 0.2 }], { sides: 5, lods: [0, 1], col: S.bark, tint: mul(tint, 0.95), ao: (p) => 0.6 + 0.4 * smooth(0, 1, p[1]) });
    }

    leaves(L);
  }
  // --- a lobe's leaf cards: clusters on its shell, two crossed cards each
  function leaves(L) {
    const nC = Math.max(4, Math.round(S.perLobe * (0.85 + 0.3 * r()) * (L.lr / (S.lobeR * rx)) ** 1.2 * (L.core ? (S.coreDense ?? 1.5) : 1) * (hero ? 1.25 : 1)));
    const toC = norm(sub(C, L.c)), lturn = r() * 6.283;
    // a lobe's own cast: each limb's leaves are a little lighter, darker, yellower or bluer than the next's
    const lobeTint = L.core ? [0.84, 0.88, 0.9] : [0.88 + 0.24 * r(), 0.92 + 0.14 * r(), 0.8 + 0.34 * r()];
    const normalAt = (p) => norm(add(add(mul(norm([(p[0] - L.c[0]), (p[1] - L.c[1]) / L.flat, (p[2] - L.c[2])]), S.lobeShade ?? 0.6), mul(eNorm(p), 1 - (S.lobeShade ?? 0.6))), [0, 0.2, 0]));
    const aoAt = (p) => {
      const eC = smooth(0.4, 1.0, eRel(p));
      const ln = norm(sub(p, L.c));
      const eL = 0.5 + 0.5 * dot(ln, norm(add(mul(toC, -0.6), [0, 1, 0])));
      const low = lerp(0.72, 1, smooth(C[1] - ry * 0.9, C[1] + ry * 0.5, p[1]));   // the underside of the whole crown
      return clamp((0.2 + 0.8 * (0.42 * eC + 0.62 * eL - 0.04)) * low);
    };
    const swayAt = (p) => clamp(0.25 + 0.6 * Math.hypot(p[0] - C[0], p[2] - C[2]) / rx + 0.15 * (p[1] - yb) / (H - yb));
    for (let j = 0; j < nC; j++) {
      const d = fib(j, nC, S.shellLo ?? -0.8, 1, lturn);
      if (!L.core && dot(d, toC) > (S.shellIn ?? 0.75) && lobes.length > 2) continue;   // faces into the crown: hidden anyway
      const inK = L.core && j % 3 === 2 ? 0.5 : 1;   // a third of the heart's clusters stand inside it: no sky straight through a crown
      const p = [L.c[0] + d[0] * L.lr * inK * (0.84 + 0.2 * r()), L.c[1] + d[1] * L.lr * inK * L.flat * (0.84 + 0.2 * r()), L.c[2] + d[2] * L.lr * inK * (0.84 + 0.2 * r())];
      const tile = pick(r, tiles), tn = pick(r, tints), b = (0.9 + 0.2 * r()) * (L.core ? 0.82 : 1);
      const tnt = [tn[0] * b * lobeTint[0], tn[1] * b * lobeTint[1], tn[2] * b * lobeTint[2]];
      const size = S.card * 1.18 * (0.85 + 0.35 * r()) * (L.core ? 1.15 : 1);
      const common = { pivot: p, group: L.i, normal: normalAt, ao: aoAt, tint: tnt, sway: swayAt, phase: L.phase + (r() - 0.5) * 0.08, snow: 0.55 + 0.45 * clamp(d[1] + 0.3) };
      // A: faces out of the lobe
      const nA = norm(add(d, mul([r() - 0.5, r() - 0.5, r() - 0.5], 0.7)));
      let upA = sub(UP, mul(nA, dot(UP, nA)));
      upA = len(upA) < 0.25 ? norm(cross(nA, [1, 0, 0])) : norm(upA);
      const roll = droopy.has(tile) ? (r() - 0.5) * 0.7 : r() * 6.283;
      const rtA = cross(upA, nA);
      const ca = Math.cos(roll), sa = Math.sin(roll), h = size / 2;
      M.quad(p, mul(add(mul(rtA, ca), mul(upA, sa)), h), mul(add(mul(rtA, -sa), mul(upA, ca)), h), tile, { ...common, flip: r() < 0.5, cup: S.cup ?? 0.34, out: nA });
      // B: edge-on to A, so the lobe has a leafy rim from the side as well
      const tA = norm(add(mul(rtA, Math.cos(roll * 1.7 + j)), mul(upA, Math.sin(roll * 1.7 + j))));
      const upB = droopy.has(tile) ? norm(add(mul(nA, 0.45), [0, 1, 0])) : norm(add(nA, mul(tA, (r() - 0.5) * 0.8)));
      const nB = norm(cross(tA, upB)), rtB = norm(cross(upB, nB));
      M.quad(add(p, mul(nA, -0.12 * size)), mul(rtB, h * 0.94), mul(upB, h * 0.94), pick(r, tiles), { ...common, flip: r() < 0.5, late: (S.crossLate ?? 0) > r(), ...(hero ? { cup: 0.25, out: nB } : {}) });
    }
    // hanging vines under the lobe (kapok, fig): each a tall card, dropped first with distance
    if (S.vines && !L.core && r() < S.vines) {
      const a = r() * 6.283, l = Math.min(L.c[1] - L.lr * L.flat * 0.5 - 1.4, (S.vineLen ?? 3.5) * (0.6 + 0.8 * r()));
      if (l > 1.2) {
        const top = [L.c[0] + Math.cos(a) * L.lr * 0.5, L.c[1] - L.lr * L.flat * 0.35, L.c[2] + Math.sin(a) * L.lr * 0.5];
        const a2 = r() * 3.1416, rt = [Math.cos(a2) * 0.75, 0, Math.sin(a2) * 0.75];
        M.quad([top[0], top[1] - l / 2, top[2]], rt, [0, l / 2, 0], 'vine', { pivot: top, group: L.i, late: true, normal: (p) => norm(add(eNorm(p), [0, 0.5, 0])), ao: (p) => 0.5 + 0.25 * smooth(top[1] - l, top[1], p[1]), tint: [0.92, 1.0, 0.8], sway: (p) => 0.35 + 0.65 * (top[1] - p[1]) / l, flutter: (sx, sy) => (sy < 0 ? 0.8 : 0.1), phase: L.phase, grow: 0.2, snow: 0.2, crown: false });
      }
    }
  }
  return { kind: 'lobed' };
}

// ---------------------------------------------------------------- rosettes: palms, banana, tree fern
function rosette(M, S) {
  const r = M.r, H = S.H;
  const Hs = H * S.stem * (0.96 + 0.08 * r());
  const R = S.trunkR * H;
  const leanA = S.leanDir ?? r() * 6.283, leanM = (S.lean ?? 1) * (0.6 + 0.4 * r());
  const hero = !!S.hero;
  const bole = bolePath(M, { H: Hs, yTop: Hs, R, taper: S.taper ?? 0.3, flare: S.flare ?? 0.5, flareH: S.flareH ?? 0.05, lean: [Math.cos(leanA) * leanM, Math.sin(leanA) * leanM], wobble: S.wobble ?? 0.1, steps: hero ? 16 : 10 });
  const tint = S.barkTint || [1, 1, 1];
  // a swelling under the crown (a coconut's crownshaft, a date palm's boss of old leaf bases)
  const path = bole.path.map((q) => ({ p: q.p, r: q.r * (1 + (S.boss ?? 0) * smooth(Hs * 0.86, Hs, q.p[1])) }));
  M.trunk(path, { sides: (S.sides ?? 7) + (hero ? 3 : 0), col: S.bark, tint, ao: (p) => lerp(0.72, 1, smooth(0, 0.8, p[1])) * lerp(1, 0.62, smooth(Hs * 0.8, Hs, p[1])), sway: (t) => 0.25 * t * t, vScale: S.vScale ?? 3 });
  if (hero) roots(M, bole, { n: 6, H: Hs, reach: 2.6 * R, rise: 0.035 * Hs, thick: 0.4, col: S.bark, tint, hero });
  const T = bole.at(Hs);
  const leafTint = S.leafTints || [[[1, 1, 1], 1]];
  const frond = (i, n, o = {}) => {
    const u = (i + 0.5) / n;
    const az = i * GOLDEN + (r() - 0.5) * 0.5;
    const el = (o.el ?? lerp(S.elTop, S.elBot, u ** (S.elPow ?? 0.85))) * Math.PI / 180 + (r() - 0.5) * 0.18;
    const L = (o.len ?? S.frondLen) * H * (0.88 + 0.24 * r()) * lerp(0.82, 1, Math.sin(Math.PI * clamp(u * 0.9 + 0.1)));
    const d0 = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const droop = (o.droop ?? S.droop) * (0.75 + 0.5 * r()) * (0.55 + 0.6 * u);
    const nP = (S.frondSeg ?? 7) + (hero ? 3 : 0), pts = [];
    const start = add(T, [Math.cos(az) * R * 0.5, -R * 0.4, Math.sin(az) * R * 0.5]);
    // the rachis leaves the crown straight, arches over under its own weight, and its tip hangs
    const arch = S.arch ?? 0;
    for (let k = 0; k < nP; k++) { const s = k / (nP - 1); pts.push(add(add(start, mul(d0, L * s * (1 - 0.1 * arch * s * s))), [0, -droop * L * (s * s * (1 - 0.55 * arch) + 0.75 * arch * s * s * s * s), 0])); }
    const sideOf = (k, tan) => { const sd = cross(tan, UP); return len(sd) < 0.2 ? [Math.sin(az), 0, -Math.cos(az)] : norm(sd); };
    const tn = o.tint || pick(r, leafTint), b = 0.9 + 0.2 * r(), ph = r();
    const hwF = (o.width ?? S.frondW) * H * 0.5 * (0.9 + 0.2 * r()), fold0 = o.fold ?? S.fold ?? 0.45, roll0 = (r() - 0.5) * (S.frondRoll ?? 0), twist = (r() - 0.5) * (S.frondRoll ?? 0) * 1.4;
    M.strip(pts, o.tile || S.tile, {
      side: sideOf, half: () => hwF, fold: arch ? (s) => fold0 * (0.75 + 0.7 * s) : fold0, roll: S.frondRoll ? (s) => roll0 + twist * s : 0, group: i % 7, late: !!o.late,
      normal: (p, gn) => norm(add(add(mul(gn, 0.55), mul(norm([p[0] - T[0], (p[1] - T[1]) * 0.6 + 0.3, p[2] - T[2]]), 0.5)), [0, 0.15, 0])),
      ao: (p, s) => clamp((0.42 + 0.58 * smooth(0, 0.55, s)) * (o.ao ?? lerp(1, 0.72, u))), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
      sway: (s) => 0.3 + 0.7 * s ** 1.4, flutter: (s, k) => s * (0.3 + 0.7 * Math.abs(k)), phase: ph, grow: 0.3, snow: 0.8, flip: r() < 0.5, crown: !o.dead,
    });
    return { pts, az };
  };
  const nFronds = S.fronds + (hero && S.fronds ? 5 : 0);
  for (let i = 0; i < nFronds; i++) frond(i, nFronds);
  // old fronds hanging against the stem, brown
  for (let i = 0; i < (S.dead || 0) + (hero && S.dead ? 2 : 0); i++) frond(i, S.dead + (hero ? 2 : 0), { el: -62 - r() * 16, droop: 0.25, len: S.frondLen * 0.8, tint: S.deadTint || [1.25, 0.95, 0.5], late: true, dead: true, ao: 0.62 });
  // a fan palm's leaves: a stalk and a folded fan at its end
  const nFans = (S.fans || 0) + (hero && S.fans ? 6 : 0);
  for (let i = 0; i < nFans; i++) {
    const u = (i + 0.5) / nFans;
    const az = i * GOLDEN + (r() - 0.5) * 0.4, el = lerp(S.elTop, S.elBot, u ** 0.9) * Math.PI / 180;
    const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const Ls = S.stalk * H * (0.8 + 0.4 * r()), size = S.fanSize * H * (0.85 + 0.3 * r());
    const base = add(T, [0, -R * 0.3, 0]), hub = add(add(base, mul(d, Ls)), [0, -0.12 * Ls * (1 - Math.sin(el)), 0]);
    const dead = u > 1 - (S.fanDead ?? 0);
    M.tube([{ p: base, r: 0.035 }, { p: hub, r: 0.022 }], { sides: 3, lods: [0], col: 'smooth', tint: [0.75, 0.95, 0.5], ao: () => 0.7, sway: (t) => 0.4 * t, phase: u });
    // the fan: its stalk end at the hub, opening outward and up, folded a little along its middle
    const outv = norm(add(d, [0, 0.25, 0]));
    let side = cross(outv, UP);
    side = len(side) < 0.2 ? [Math.sin(az), 0, -Math.cos(az)] : norm(side);
    const tn = dead ? (S.deadTint || [1.25, 0.95, 0.5]) : pick(r, leafTint), b = 0.9 + 0.2 * r(), ph = r();
    const pts = [0, 0.5, 1].map((s) => add(hub, mul(outv, (s - 0.48) * size)));   // the painted fan's hub is that far up its tile
    M.strip(pts, 'fan', {
      side: () => side, half: () => size * 0.5, fold: 0.22, group: i % 7, late: dead,
      normal: (p, gn) => norm(add(add(mul(gn, 0.5), mul(norm(sub(p, T)), 0.55)), [0, 0.15, 0])),
      ao: (p, s) => clamp((0.5 + 0.5 * s) * (dead ? 0.6 : lerp(1, 0.75, u))), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
      sway: (s) => 0.45 + 0.55 * s, flutter: (s, k) => 0.25 + 0.75 * Math.abs(k) * s, phase: ph, grow: 0.5, snow: 0.8, crown: !dead,
    });
  }
  // fruit under the crown
  for (let i = 0; i < (S.fruit || 0) + (hero && S.fruit ? 3 : 0); i++) {
    const a = r() * 6.283, c = add(T, [Math.cos(a) * R * 1.5, -R * (1.2 + r() * 1.4), Math.sin(a) * R * 1.5]);
    M.blob(c, (S.fruitR ?? 0.13) * (0.85 + 0.3 * r()), S.fruitTint || [0.55, 0.42, 0.2], { ao: 0.75, sway: 0.25 });
  }
  return { kind: 'rosette' };
}

// ---------------------------------------------------------------- conifers
function conifer(M, S) {
  const r = M.r, H = S.H;
  const R = S.trunkR * H;
  const leanA = r() * 6.283, leanM = (S.lean ?? 0.25) * r();
  const hero = !!S.hero;
  const bole = bolePath(M, { H, yTop: H * 0.985, R, taper: 0.93, flare: S.flare ?? 0.6, flareH: 0.035, lean: [Math.cos(leanA) * leanM, Math.sin(leanA) * leanM], wobble: S.wobble ?? 0.05, steps: hero ? 14 : 9 });
  const tileOf = () => (S.tiles ? pick(r, S.tiles) : S.tile);
  const tint = S.barkTint || [1, 1, 1];
  const y0 = H * S.base * (0.9 + 0.2 * r());
  M.trunk(bole.path, { sides: hero ? 10 : 7, col: S.bark, tint, ao: (p) => lerp(0.75, 1, smooth(0, 0.8, p[1])) * lerp(1, 0.5, smooth(y0 * 0.7, y0 * 1.2 + 0.3, p[1])) });
  if (S.roots || hero) roots(M, bole, { n: (S.roots || 0) + (hero ? 5 : 0), H, reach: 3 * R * (hero ? 1.3 : 1), rise: 0.04 * H, thick: 0.45, col: S.bark, tint, hero });
  const Rw = (t) => S.width * H * ((1 - t) ** (S.pow ?? 0.85)) * (1 - (S.waist ?? 0) * Math.sin(Math.PI * t)) + 0.3 * (H / 16);
  const tints = S.tints || [[[1, 1, 1], 1]];
  // the crown's dark heart: a cone inside the boughs, so the tree is solid from any side and
  // keeps its shape when a far tree is down to a handful of them
  if (!S.bare) {
    const colN = BARK_COLUMNS.indexOf('plated'), sides = 6, rings = [0, 0.3, 0.62, 1];
    const rows = rings.map((t) => {
      const y = lerp(y0 + 0.02 * H, H * 0.97, t), c = bole.at(y), rr = Math.max(0.05, Rw(t) * 0.5 * (t >= 1 ? 0.1 : 1));
      const row = [];
      for (let k = 0; k <= sides; k++) { const a = (k / sides) * 6.283; row.push(M.v([c[0] + Math.cos(a) * rr, y, c[2] + Math.sin(a) * rr], norm([Math.cos(a), 0.45, Math.sin(a)]), [k / sides * 2, y / 3], [0.3 + 0.25 * t, 0.2 * t, 0, 0.5], [0.3, 0.38, 0.38, colN], [0, 0, 0, 0.25])); }
      return row;
    });
    for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < sides; k++) { const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k]; for (const l of [0, 1, 2]) M.bark[l].push(a, b, c, a, c, d); }
  }
  // tiers of boughs sloping down and out like a skirt (their upper sides face whoever looks
  // from the side), each tier overlapping the one below, tips curling up
  let w = 0;
  for (let y = y0 + 0.03 * H; y < H * 0.95; w++) {
    const t = (y - y0) / (H - y0);
    const nb = Math.max(4, Math.round(lerp(S.per, S.perTop ?? 5, t))) + (hero ? 2 : 0);
    const az0 = w * GOLDEN + r();
    const axis = bole.at(y), rad = bole.rad(y), Rt = Rw(t);
    // as steep as the species droops, but never into the ground
    const droop0 = Math.min(lerp(S.droopLow, S.droopTop, t ** 0.8) * Math.PI / 180, Math.atan2(Math.max(0.1, y - 0.25), Rt));
    for (let k = 0; k < nb; k++) {
      if (r() < (S.gapChance ?? 0.04)) continue;
      const a = az0 + (k / nb) * 6.283 + (r() - 0.5) * 0.3;
      const droop = droop0 + (r() - 0.5) * 0.14;
      const L = (Rt / Math.cos(droop)) * (0.86 + 0.28 * r());
      const out = [Math.cos(a), 0, Math.sin(a)];
      const start = add(axis, mul(out, rad * 0.5));
      const pts = [];
      const nP = hero ? 6 : 4;
      for (let i = 0; i < nP; i++) {
        const s = i / (nP - 1);
        pts.push(add(add(start, mul(out, Math.cos(droop) * L * s)), [0, -Math.sin(droop) * L * s + (S.curl ?? 0.12) * L * s * s, 0]));
      }
      const side = [-Math.sin(a), 0, Math.cos(a)];
      const tn = pick(r, tints), b = 0.88 + 0.24 * r(), ph = r();
      const hw = (Math.PI * Rt / nb) * (S.boughW ?? 1.25);
      if (S.bare || hero) M.tube([{ p: start, r: rad * 0.28 + 0.012 }, { p: pts[1], r: 0.035 }, { p: pts[nP - 1], r: 0.014 }], { sides: 3, lods: [0, 1], col: S.bark, tint, ao: () => 0.85, sway: (s) => 0.5 * s, phase: ph });
      M.strip(pts, tileOf(), {
        side: () => side, half: (i, s) => Math.max(0.25, hw * lerp(0.5, 1, s)), fold: S.fold ?? 0.22, group: w,
        normal: (p, gn) => norm(add(add(mul(gn, 0.45), mul(out, 0.6)), [0, 0.35, 0])),
        ao: (p, s) => clamp((0.3 + 0.7 * smooth(0.05, 0.75, s)) * lerp(0.8, 1, t)), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
        sway: (s) => (0.25 + 0.75 * s) * lerp(0.5, 1, t), flutter: (s, kk) => 0.5 * s * (0.4 + 0.6 * Math.abs(kk)), phase: ph, grow: 0.8, snow: 1, flip: r() < 0.5, v0: S.boughV0 ?? 0, v1: S.boughV1 ?? 1,
      });
    }
    y += Math.max(0.3, Rt * Math.tan(droop0) * (S.gap ?? 0.5)) * (0.9 + 0.2 * r());
  }
  // the leader: a little spire of upswept boughs
  const top = bole.at(H * 0.93);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.571 + r(), out = [Math.cos(a), 0, Math.sin(a)], L = 0.085 * H;
    const pts = [0, 0.5, 1].map((s) => add(add(top, mul(out, L * 0.42 * s)), [0, L * (0.35 + 0.95 * s), 0]));
    const tn = pick(r, tints);
    M.strip(pts, tileOf(), { side: () => [-Math.sin(a), 0, Math.cos(a)], half: () => L * 0.3, fold: 0.3, group: w + 1, normal: (p, gn) => norm(add(mul(gn, 0.4), add(mul(out, 0.5), [0, 0.5, 0]))), ao: () => 1, tint: tn, sway: () => 1, flutter: (s) => 0.4 * s, phase: r(), grow: 1, snow: 1 });
  }
  return { kind: 'conifer' };
}

// ---------------------------------------------------------------- snags
function snag(M, S) {
  const r = M.r, H = S.H;
  const R = S.trunkR * H;
  const Hs = H * (S.stem ?? 0.82);
  const leanA = r() * 6.283, leanM = (S.lean ?? 0.5) * r();
  const hero = !!S.hero;
  const bole = bolePath(M, { H: Hs, yTop: Hs, R, taper: S.taper ?? 0.62, flare: 0.8, flareH: 0.06, lean: [Math.cos(leanA) * leanM, Math.sin(leanA) * leanM], wobble: S.wobble ?? 0.28, steps: hero ? 13 : 8, twist: 0.6 });
  const tint = S.barkTint || [1, 1, 1];
  const ao = (p) => lerp(0.7, 1, smooth(0, 0.9, p[1]));
  M.trunk(bole.path, { sides: hero ? 10 : 7, col: S.bark, tint, ao, cap: true });
  if (S.roots) roots(M, bole, { n: S.roots + (hero ? 2 : 0), H, reach: 3.4 * R * (hero ? 1.25 : 1), rise: 0.06 * H, thick: 0.5, col: S.bark, tint, hero });
  // a splintered spike past the break
  const tp = bole.at(Hs), a0 = r() * 6.283;
  M.tube([{ p: add(tp, [Math.cos(a0) * R * 0.2, -0.3, Math.sin(a0) * R * 0.2]), r: R * 0.24 }, { p: add(tp, [Math.cos(a0) * R * 0.5, H * 0.1, Math.sin(a0) * R * 0.5]), r: R * 0.12 }, { p: add(tp, [Math.cos(a0) * R * 0.9, H * (0.16 + 0.05 * r()), Math.sin(a0) * R * 0.9]), r: 0.02 }], { sides: 4, lods: [0, 1, 2], col: S.bark, tint, ao });
  const nL = S.limbs + (hero ? 3 : 0);
  for (let i = 0; i < nL; i++) {
    const u = (i + 0.5) / nL;
    const y = Hs * lerp(0.38, 0.95, u) * (0.94 + 0.12 * r());
    const a = i * GOLDEN + r() * 0.8, out = [Math.cos(a), 0, Math.sin(a)];
    const L = H * (S.limbLen ?? 0.3) * (0.55 + 0.75 * r()) * lerp(1, 0.6, u);
    const start = bole.at(y), r0 = bole.rad(y) * (0.42 + 0.2 * r());
    const rise = 0.25 + 0.7 * r();
    const mid = add(add(start, mul(out, L * 0.5)), [0, L * 0.5 * rise * 0.6, 0]);
    const kink = [Math.cos(a + (r() - 0.5) * 1.4), 0, Math.sin(a + (r() - 0.5) * 1.4)];
    const end = add(add(mid, mul(kink, L * 0.5)), [0, L * 0.5 * rise * 1.3, 0]);
    const broken = r() < 0.35;
    const ph = r();
    M.tube(hero ? [{ p: start, r: r0 }, { p: lerp3(start, mid, 0.5), r: r0 * 0.82 }, { p: mid, r: r0 * 0.6 }, { p: lerp3(mid, end, 0.5), r: r0 * 0.42 }, { p: end, r: broken ? r0 * 0.4 : 0.02 }] : [{ p: start, r: r0 }, { p: mid, r: r0 * 0.6 }, { p: end, r: broken ? r0 * 0.4 : 0.02 }], { sides: hero ? 6 : 5, lods: [0, 1], col: S.bark, tint, ao, cap: broken, sway: (t) => 0.3 * t, phase: ph });
    M.tube([{ p: start, r: r0 }, { p: end, r: broken ? r0 * 0.4 : 0.03 }], { sides: 3, lods: [2], col: S.bark, tint, ao });
    if (broken) continue;
    // twigs at the limb's end: two crossed fans
    const dir = norm(sub(end, mid)), size = H * (S.twigSize ?? 0.2) * (0.8 + 0.4 * r());
    const c = add(end, mul(dir, size * 0.36));
    for (let k = 0; k < 2; k++) {
      let side = norm(cross(dir, k ? norm(cross(dir, UP)) : UP));
      if (!Number.isFinite(side[0])) side = [1, 0, 0];
      M.quad(c, mul(side, size * 0.5), mul(dir, size * 0.5), 'twig', { pivot: end, group: i, normal: () => norm(add(out, [0, 0.6, 0])), ao: () => 0.95, tint: S.twigTint || [1, 1, 1], sway: () => 0.7, flutter: (sx, sy) => (sy > 0 ? 0.6 : 0.1), phase: ph, grow: 0.6, snow: 0.4 });
    }
  }
  return { kind: 'snag' };
}

// ---------------------------------------------------------------- the understory's small plants
// Built a metre tall (the game scales each to its own size). Their one pivot is the foot,
// and they shrink into the ground as a whole at their draw distance (tree-models.js).
function under(M, S) {
  const r = M.r;
  const O = [0, 0, 0];
  const tints = S.tints || [[[1, 1, 1], 1]];
  if (S.form === 'rosette') {
    // long leaves arching out of one point: a fern, an elephant ear
    for (let i = 0; i < S.leaves; i++) {
      const u = (i + 0.5) / S.leaves, az = i * GOLDEN + r() * 0.5;
      const el = lerp(S.elTop, S.elBot, u) * Math.PI / 180, L = S.len * (0.8 + 0.4 * r());
      const d0 = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
      const pts = [];
      for (let k = 0; k < 5; k++) { const s = k / 4; pts.push(add(mul(d0, L * s), [0, 0.03 - S.droop * L * s * s, 0])); }
      const tn = pick(r, tints), b = 0.88 + 0.24 * r();
      M.strip(pts, S.tile, {
        side: (k, tan) => { const sd = cross(tan, UP); return len(sd) < 0.2 ? [Math.sin(az), 0, -Math.cos(az)] : norm(sd); }, half: () => S.width * 0.5 * (0.85 + 0.3 * r()), fold: S.fold ?? 0.3, group: i, pivot: O,
        normal: (p, gn) => norm(add(mul(gn, 0.5), [p[0] * 0.6, 0.75, p[2] * 0.6])), ao: (p, s) => clamp(0.4 + 0.6 * smooth(0, 0.6, s)), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
        sway: (s) => 0.5 * s, flutter: (s, k) => 0.6 * s * (0.4 + 0.6 * Math.abs(k)), phase: r(), grow: 0, snow: 0.9, flip: r() < 0.5,
      });
    }
  } else if (S.form === 'dome') {
    // a bush: leaf cards heaped on a low dome, a couple of stems showing
    for (let i = 0; i < S.cards; i++) {
      const d = fib(i, S.cards, 0.05, 1, r() * 6.283);
      const p = [d[0] * S.rad * (0.8 + 0.3 * r()), 0.12 + d[1] * S.high * (0.75 + 0.3 * r()), d[2] * S.rad * (0.8 + 0.3 * r())];
      const nA = norm(add(d, mul([r() - 0.5, r() * 0.6, r() - 0.5], 0.6)));
      let up = sub(UP, mul(nA, dot(UP, nA)));
      up = len(up) < 0.25 ? norm(cross(nA, [1, 0, 0])) : norm(up);
      const rt = cross(up, nA), roll = r() * 6.283, ca = Math.cos(roll), sa = Math.sin(roll), h = S.card * 0.5 * (0.85 + 0.3 * r());
      const tn = pick(r, tints), b = 0.88 + 0.24 * r();
      M.quad(p, mul(add(mul(rt, ca), mul(up, sa)), h), mul(add(mul(rt, -sa), mul(up, ca)), h), pick(r, S.tiles), {
        pivot: O, group: i,
        normal: (q) => norm([q[0] * 0.8, 0.5 + q[1], q[2] * 0.8]), ao: (q) => clamp(0.35 + 0.75 * smooth(0.05, S.high, q[1])), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
        sway: (q) => 0.4 * clamp(q[1]), flutter: 0.5, phase: r(), grow: 0, snow: 0.9, flip: r() < 0.5, cup: 0.3, out: nA,
      });
    }
    for (let i = 0; i < (S.stems || 0); i++) { const a = r() * 6.283; M.tube([{ p: [0, -0.1, 0], r: 0.03 }, { p: [Math.cos(a) * S.rad * 0.4, S.high * 0.5, Math.sin(a) * S.rad * 0.4], r: 0.012 }], { sides: 3, lods: [0, 1, 2], col: 'ridged', tint: [0.4, 0.3, 0.22], ao: () => 0.6 }); }
  } else if (S.form === 'tuft') {
    // grass: upright cards crossed through one foot
    for (let i = 0; i < S.cards; i++) {
      const a = (i / S.cards) * Math.PI + r() * 0.5, lean = (r() - 0.5) * 0.3;
      const rt = [Math.cos(a) * S.width * 0.5, 0, Math.sin(a) * S.width * 0.5], up = [-Math.sin(a) * lean * 0.5, 0.5, Math.cos(a) * lean * 0.5];
      const tn = pick(r, tints), b = 0.88 + 0.24 * r();
      M.quad([up[0], 0.48, up[2]], rt, up, S.tile, {
        pivot: O, group: i, normal: (q) => norm([q[0] * 0.5, 0.9, q[2] * 0.5]), ao: (q) => clamp(0.45 + 0.6 * q[1]), tint: [tn[0] * b, tn[1] * b, tn[2] * b],
        sway: (q) => 0.9 * clamp(q[1]) ** 1.5, flutter: (sx, sy) => (sy > 0 ? 0.8 : 0), phase: r(), grow: 0, snow: 0.6, flip: r() < 0.5,
      });
    }
  } else if (S.form === 'rock') {
    // a boulder: the hull of a dozen jittered points, flattened and sunk a little (so few
    // points that the hull is found by trying every triangle)
    const dirs = [];
    for (let i = 0; i < 14; i++) dirs.push(fib(i, 14, -0.55, 1, 0.3));
    const rad = dirs.map(() => 0.5 * (0.72 + 0.5 * r()));
    const P = dirs.map((d, i) => [d[0] * rad[i] * S.wide, (d[1] * rad[i] + 0.16) * S.high * 2, d[2] * rad[i] * S.wide]);
    const faces = [];
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) for (let c = b + 1; c < P.length; c++) {
      let n = cross(sub(P[b], P[a]), sub(P[c], P[a]));
      if (len(n) < 1e-6) continue;
      n = norm(n);
      let pos = 0, neg = 0;
      for (let k = 0; k < P.length; k++) { if (k === a || k === b || k === c) continue; const s = dot(n, sub(P[k], P[a])); if (s > 1e-6) pos++; else if (s < -1e-6) neg++; }
      if (pos && neg) continue;
      faces.push(pos ? [a, c, b, mul(n, -1)] : [a, b, c, n]);
    }
    const tn = pick(r, tints), colN = BARK_COLUMNS.indexOf('plated');
    for (const [a, b, c, n] of faces) {
      const k = 0.85 + 0.3 * n[1] * n[1];
      const ids = [a, b, c].map((i) => M.v(P[i], n, [P[i][0] * 0.6 + P[i][1] * 0.3, P[i][2] * 0.35 + P[i][1] * 0.2], [clamp(0.5 + 0.6 * P[i][1]), 0, 0, 0.5], [tn[0] * k, tn[1] * k, tn[2] * k, colN], [0, 0, 0, 1]));
      for (const l of [0, 1, 2]) M.bark[l].push(...ids);
    }
    for (const p of P) M.leafStats.push(p);
  }
  M.trunkPath = [{ p: [0, 0, 0], r: 0.02 }, { p: [0, 1, 0], r: 0.02 }];
  return { kind: 'under' };
}

// ---------------------------------------------------------------- the species
// Colours here are RELATIVE: a tree's leaf colour comes from the world it stands in
// (public/render/tree-species.js); `tints` vary it card to card. Bark tints are absolute.
const GREY = [0.5, 0.47, 0.43], BROWN = [0.5, 0.36, 0.25], RED = [0.56, 0.3, 0.2], DARK = [0.3, 0.24, 0.2], PALE = [0.86, 0.8, 0.7];
const LEAFY = [[[1, 1, 1], 5], [[1.12, 1.08, 0.72], 2], [[0.8, 0.92, 0.95], 2]];
export const SPECIES = Object.freeze({
  // ---- jungle
  kapok: { build: lobed, H: 18, variants: [
    { seed: 11, base: 0.6, width: 0.4, crownH: 0.62, leader: 0.3, lobes: 9, elMin: -8, lobeR: 0.42, lobeFlat: 0.6, perLobe: 17, card: 2.5 },
    { seed: 12, base: 0.66, width: 0.36, crownH: 0.7, leader: 0.4, lobes: 8, elMin: -4, lobeR: 0.44, lobeFlat: 0.62, perLobe: 17, card: 2.4 },
  ], common: { trunkR: 0.027, taper: 0.4, flare: 0.5, flareH: 0.035, roots: 5, rootReach: 5.5, rootRise: 0.17, rootThick: 0.5, fin: 1.3, sides: 9, bark: 'smooth', barkTint: GREY, lean: 0.3, wobble: 0.08, limbRise: 0.4, limbCurve: 0.9, limbOut: 0.5, limbR: 0.5, showLimbs: true, twigs: 3, tiles: [['broadA', 3], ['bigleaf', 2]], tints: LEAFY, vines: 0.75, vineLen: 4.5, shellLo: -0.75, crossLate: 0.3 } },
  fig: { build: lobed, H: 15, variants: [
    { seed: 21, base: 0.34, width: 0.5, lobes: 10, lobeR: 0.4, perLobe: 16, card: 2.3 },
    { seed: 22, base: 0.4, width: 0.44, lobes: 9, lobeR: 0.42, perLobe: 16, card: 2.3 },
  ], common: { trunkR: 0.033, taper: 0.45, flare: 0.9, flareH: 0.05, roots: 6, rootReach: 4.2, rootRise: 0.08, lattice: 5, sides: 8, bark: 'mossy', barkTint: [0.5, 0.44, 0.36], lean: 0.4, wobble: 0.16, leader: 0.3, elMin: -22, lobeFlat: 0.72, limbRise: 0.7, limbCurve: 0.8, limbR: 0.55, showLimbs: true, aerial: 0.35, twigs: 3, tiles: [['broadB', 4], ['broadA', 2]], tints: LEAFY, vines: 0.6, vineLen: 3.2, crossLate: 0.3 } },
  junglebroad: { build: lobed, H: 14, variants: [
    { seed: 31, base: 0.44, width: 0.36, lobes: 8, lobeR: 0.46, perLobe: 17, card: 2.4 },
    { seed: 32, base: 0.5, width: 0.32, lobes: 7, lobeR: 0.48, perLobe: 17, card: 2.3, crownH: 0.9 },
    { seed: 33, base: 0.38, width: 0.4, lobes: 9, lobeR: 0.42, perLobe: 16, card: 2.4 },
  ], common: { trunkR: 0.028, flare: 0.8, roots: 4, rootReach: 3.6, rootRise: 0.06, bark: 'mossy', barkTint: [0.4, 0.34, 0.27], lean: 0.5, wobble: 0.2, leader: 0.4, elMin: -28, lobeFlat: 0.8, limbRise: 0.65, twigs: 3, tiles: [['bigleaf', 3], ['broadA', 3]], tints: LEAFY, vines: 0.3, vineLen: 2.6, crossLate: 0.3 } },
  // ---- tropical
  coconut: { build: rosette, H: 13, variants: [
    { seed: 41, lean: 1.9, wobble: 0.25 }, { seed: 42, lean: 1.0, wobble: 0.15, stem: 0.84 }, { seed: 43, lean: 2.3, wobble: 0.3, stem: 0.74 },
  ], common: { stem: 0.78, trunkR: 0.022, taper: 0.3, flare: 0.9, flareH: 0.045, boss: 0.5, bark: 'ringed', barkTint: [0.5, 0.41, 0.31], vScale: 2.4, tile: 'frond', fronds: 19, frondLen: 0.4, frondW: 0.115, frondSeg: 8, fold: 0.5, arch: 1, frondRoll: 0.7, elTop: 80, elBot: -30, droop: 0.6, dead: 3, fruit: 5, fruitTint: [0.5, 0.62, 0.22], leafTints: [[[1, 1, 1], 4], [[1.1, 1.06, 0.7], 1]] } },
  fanpalm: { build: rosette, H: 10, variants: [{ seed: 51, lean: 0.5 }, { seed: 52, lean: 0.9, stem: 0.7 }],
    common: { stem: 0.76, trunkR: 0.029, taper: 0.15, flare: 0.5, boss: 0.25, bark: 'fibrous', barkTint: [0.46, 0.36, 0.26], wobble: 0.06, fronds: 0, fans: 26, stalk: 0.13, fanSize: 0.2, elTop: 80, elBot: -48, fanDead: 0.24, deadTint: [1.2, 0.92, 0.5], leafTints: [[[1, 1, 1], 4], [[0.86, 0.98, 0.9], 2]] } },
  seaalmond: { build: lobed, H: 12, variants: [
    { seed: 61, lobes: 9, lobeR: 0.46, perLobe: 15, card: 2.3 }, { seed: 62, lobes: 8, lobeR: 0.5, perLobe: 15, card: 2.3, base: 0.36 },
  ], common: { base: 0.3, width: 0.5, trunkR: 0.029, flare: 0.8, roots: 4, rootReach: 3.2, bark: 'ridged', barkTint: [0.52, 0.42, 0.34], lean: 0.6, wobble: 0.18, leader: 0.55, elMin: -12, lobeFlat: 0.45, lobeJitterY: 0.3, limbRise: 0.25, limbCurve: 0.6, limbR: 0.5, showLimbs: true, twigs: 2, tiles: [['bigleaf', 4], ['bushFlower', 2]], tints: [[[1, 1, 1], 5], [[1.15, 1.05, 0.7], 2]], crossLate: 0.3 } },
  // ---- canyon / desert
  juniper: { build: lobed, H: 8, variants: [
    { seed: 71, lobes: 6, lobeR: 0.5, perLobe: 16 }, { seed: 72, lobes: 5, lobeR: 0.54, perLobe: 16, base: 0.4, lean: 1.2 },
  ], common: { base: 0.3, width: 0.42, trunkR: 0.044, taper: 0.5, flare: 1.0, flareH: 0.06, roots: 4, rootReach: 2.6, bark: 'fibrous', barkTint: [0.62, 0.5, 0.42], lean: 0.8, wobble: 0.4, twist: 1.2, leader: 0.5, elMin: -10, lobeFlat: 0.75, lobeJitterY: 0.9, limbRise: 0.7, limbR: 0.6, showLimbs: true, twigs: 2, card: 1.7, tiles: [['juniper', 1]], tints: [[[1, 1, 1], 4], [[0.82, 0.94, 0.9], 2], [[1.1, 1.05, 0.8], 1]] } },
  acacia: { build: lobed, H: 9, variants: [
    { seed: 81, lobes: 9, lobeR: 0.4, perLobe: 14 }, { seed: 82, lobes: 8, lobeR: 0.44, perLobe: 14, base: 0.6, width: 0.6 },
  ], common: { base: 0.56, width: 0.66, crownH: 0.5, trunkR: 0.031, taper: 0.4, flare: 0.7, roots: 3, bark: 'ridged', barkTint: [0.5, 0.4, 0.32], lean: 0.9, wobble: 0.3, leader: 0.1, elMin: 4, lobeFlat: 0.36, lobeJitterY: 0.25, limbRise: 1.5, limbLow: 0.45, limbCurve: 0.85, limbOut: 0.35, limbR: 0.62, showLimbs: true, twigs: 3, card: 2.0, tiles: [['spray', 1]], tints: [[[1, 1, 1], 4], [[1.1, 1.06, 0.76], 2]], shellLo: -0.35 } },
  datepalm: { build: rosette, H: 12, variants: [{ seed: 91, lean: 0.6 }, { seed: 92, lean: 1.4, stem: 0.7 }],
    common: { stem: 0.74, trunkR: 0.028, taper: 0.12, flare: 0.55, boss: 0.55, bark: 'fibrous', barkTint: [0.6, 0.47, 0.34], wobble: 0.08, vScale: 2.2, tile: 'frond', fronds: 26, frondLen: 0.32, frondW: 0.085, frondSeg: 7, fold: 0.55, arch: 0.7, frondRoll: 0.5, elTop: 80, elBot: -42, elPow: 0.75, droop: 0.42, dead: 5, fruit: 9, fruitR: 0.16, fruitTint: [0.95, 0.5, 0.14], leafTints: [[[1, 1, 1], 4], [[0.86, 0.98, 0.9], 2]] } },
  snag: { build: snag, H: 10, variants: [
    { seed: 101, limbs: 7 }, { seed: 102, limbs: 8, stem: 0.7, lean: 0.9 }, { seed: 103, limbs: 6, stem: 0.9 },
  ], common: { trunkR: 0.036, bark: 'dead', barkTint: [0.5, 0.45, 0.4], roots: 4, limbLen: 0.36, twigSize: 0.3 } },
  // ---- links
  windpine: { build: lobed, H: 11, variants: [
    { seed: 111, lobes: 7, sweep: [2.6, 0], lean: 1.5 }, { seed: 112, lobes: 6, sweep: [1.6, 0], lean: 0.9, base: 0.6 }, { seed: 113, lobes: 8, sweep: [3.2, 0], lean: 1.9, base: 0.5, width: 0.4 },
  ], common: { base: 0.55, width: 0.36, crownH: 0.7, trunkR: 0.031, taper: 0.5, flare: 0.6, roots: 3, bark: 'plated', barkTint: [0.7, 0.44, 0.3], leanDir: 0, wobble: 0.22, leader: 0.45, elMin: -5, lobeR: 0.5, lobeFlat: 0.42, lobeJitterY: 0.5, limbRise: 0.5, limbCurve: 0.8, limbR: 0.55, showLimbs: true, twigs: 2, perLobe: 16, card: 1.9, tiles: [['pineTuft', 1]], tints: [[[1, 1, 1], 4], [[0.84, 0.95, 0.92], 2], [[1.1, 1.05, 0.78], 1]], shellLo: -0.5 }, align: true },
  // ---- alpine
  spruce: { build: conifer, H: 16, variants: [{ seed: 121 }, { seed: 122, width: 0.2, base: 0.14 }, { seed: 123, width: 0.25, gap: 0.58 }],
    common: { base: 0.1, width: 0.23, pow: 0.9, trunkR: 0.021, bark: 'plated', barkTint: [0.36, 0.27, 0.22], tile: 'bough', tiles: [['boughSnow', 3], ['bough', 2]], boughV0: 1, boughV1: 0.08, per: 9, perTop: 5, droopLow: 56, droopTop: 34, curl: 0.14, boughW: 1.6, gap: 0.5, tints: [[[1, 1, 1], 4], [[0.86, 0.97, 1.02], 2]] } },
  fir: { build: conifer, H: 15, variants: [{ seed: 131 }, { seed: 132, width: 0.17 }],
    common: { base: 0.08, width: 0.18, pow: 0.72, waist: 0.08, trunkR: 0.021, bark: 'smooth', barkTint: [0.4, 0.38, 0.36], tile: 'bough', tiles: [['boughSnow', 3], ['bough', 2]], boughV0: 1, boughV1: 0.08, per: 9, perTop: 5, droopLow: 46, droopTop: 22, curl: 0.2, boughW: 1.6, gap: 0.42, tints: [[[0.9, 1, 1.06], 4], [[1, 1, 1], 2]] } },
  larch: { build: conifer, H: 15, variants: [{ seed: 141 }, { seed: 142, width: 0.2, lean: 0.6 }],
    common: { base: 0.22, width: 0.24, pow: 0.7, trunkR: 0.021, bark: 'ridged', barkTint: [0.5, 0.38, 0.3], tile: 'twig', bare: true, per: 6, perTop: 4, droopLow: 24, droopTop: -14, curl: 0.16, boughW: 1.1, fold: 0.1, gap: 2.2, gapChance: 0.15, lean: 0.4, tints: [[[1, 1, 1], 1]] } },
  // ---- sakura
  cherry: { build: lobed, H: 9, variants: [
    { seed: 151, lobes: 10 }, { seed: 152, lobes: 9, width: 0.56, base: 0.3 }, { seed: 153, lobes: 11, width: 0.66, lobeFlat: 0.6 },
  ], common: { base: 0.26, width: 0.6, trunkR: 0.038, taper: 0.4, flare: 0.8, flareH: 0.06, roots: 4, rootReach: 3, bark: 'banded', barkTint: [0.4, 0.26, 0.24], lean: 0.7, wobble: 0.3, twist: 0.5, leader: 0.15, elMin: -18, lobeR: 0.4, lobeFlat: 0.7, limbRise: 1.0, limbLow: 0.7, limbCurve: 0.9, limbOut: 0.4, limbR: 0.6, showLimbs: true, twigs: 3, perLobe: 16, card: 1.9, tiles: [['blossom', 1]], tints: [[[1, 1, 1], 5], [[1.2, 1.25, 1.25], 2], [[0.94, 0.84, 0.9], 1]], crossLate: 0.25 } },
  maple: { build: lobed, H: 8, variants: [{ seed: 161, lobes: 8 }, { seed: 162, lobes: 9, width: 0.6 }],
    common: { base: 0.3, width: 0.54, trunkR: 0.032, flare: 0.7, roots: 3, bark: 'smooth', barkTint: [0.44, 0.38, 0.34], lean: 0.8, wobble: 0.3, leader: 0.2, elMin: -10, lobeR: 0.44, lobeFlat: 0.42, lobeJitterY: 0.35, limbRise: 0.7, limbLow: 0.6, limbCurve: 0.7, limbR: 0.55, showLimbs: true, twigs: 3, perLobe: 16, card: 1.7, tiles: [['maple', 1]], tints: [[[1, 1, 1], 4], [[1.2, 1.3, 0.9], 2], [[0.85, 0.7, 0.8], 1]] } },
  cloudpine: { build: lobed, H: 10, variants: [{ seed: 171, lobes: 7 }, { seed: 172, lobes: 6, lean: 1.6, base: 0.34 }],
    common: { base: 0.3, width: 0.5, trunkR: 0.033, taper: 0.55, flare: 0.8, roots: 4, bark: 'plated', barkTint: [0.4, 0.3, 0.27], lean: 1.2, wobble: 0.5, twist: 0.8, leader: 0.75, elMin: -25, lobeR: 0.42, lobeFlat: 0.34, lobeIn: 0.4, lobeJitterY: 0.2, limbRise: 0.15, limbLow: 0.9, limbCurve: 0.3, limbOut: 0.6, limbR: 0.5, showLimbs: true, twigs: 2, perLobe: 16, card: 1.6, tiles: [['pineTuft', 1]], tints: [[[1, 1, 1], 4], [[0.85, 0.96, 0.92], 2]], shellLo: -0.3 } },
  // ---- neon / stadium
  street: { build: lobed, H: 10, variants: [
    { seed: 181, width: 0.3, crownH: 1 }, { seed: 182, width: 0.26, base: 0.36, lobes: 12 }, { seed: 183, width: 0.34, base: 0.5, crownH: 0.8 },
  ], common: { base: 0.42, trunkR: 0.025, taper: 0.3, flare: 0.35, flareH: 0.03, bark: 'smooth', barkTint: [0.5, 0.46, 0.42], lean: 0, wobble: 0.02, leader: 0.5, elMin: -60, lobes: 10, lobeR: 0.5, lobeFlat: 1, lobeIn: 1.0, lobeJitterY: 0.1, lobeShade: 0.3, limbRise: 0.9, limbR: 0.4, twigs: 1, perLobe: 16, card: 1.5, tiles: [['spray', 3], ['broadA', 1]], tints: [[[1, 1, 1], 5], [[1.08, 1.06, 0.84], 1]], shellLo: -0.9 } },
  // ---- understory plants big enough to be models (never a ball's obstacle)
  banana: { build: rosette, H: 4.5, variants: [{ seed: 191 }, { seed: 192, stem: 0.38, fronds: 7 }],
    common: { stem: 0.44, trunkR: 0.036, taper: 0.35, flare: 0.3, bark: 'smooth', barkTint: [0.5, 0.62, 0.3], lean: 0.25, wobble: 0.04, sides: 6, tile: 'banana', fronds: 9, frondLen: 0.6, frondW: 0.26, frondSeg: 6, fold: 0.3, elTop: 82, elBot: 8, droop: 0.5, leafTints: [[[1, 1, 1], 3], [[1.12, 1.08, 0.72], 1]] } },
  treefern: { build: rosette, H: 4.5, variants: [{ seed: 201 }, { seed: 202, stem: 0.5, lean: 0.5 }],
    common: { stem: 0.6, trunkR: 0.03, taper: 0.1, flare: 0.4, boss: 0.3, bark: 'fibrous', barkTint: [0.3, 0.24, 0.2], lean: 0.3, wobble: 0.1, sides: 6, tile: 'fern', fronds: 15, frondLen: 0.5, frondW: 0.2, frondSeg: 6, fold: 0.2, elTop: 70, elBot: -14, elPow: 1.4, droop: 0.5, leafTints: [[[1, 1, 1], 3], [[0.86, 0.98, 0.9], 1]] } },
  // ---- the understory's small plants (a metre tall; scaled per plant)
  'under-fern': { build: under, H: 1, variants: [{ seed: 301 }, { seed: 302, leaves: 9, len: 1.0 }], common: { form: 'rosette', tile: 'fern', leaves: 8, len: 1.1, width: 0.46, elTop: 72, elBot: 26, droop: 0.42, fold: 0.15, tints: [[[1, 1, 1], 3], [[1.12, 1.08, 0.74], 1]] } },
  'under-bigleaf': { build: under, H: 1, variants: [{ seed: 311 }, { seed: 312, leaves: 6 }], common: { form: 'rosette', tile: 'banana', leaves: 7, len: 1.05, width: 0.5, elTop: 80, elBot: 34, droop: 0.4, fold: 0.25, tints: [[[1, 1, 1], 3], [[0.85, 0.96, 0.9], 1]] } },
  'under-flower': { build: under, H: 1, variants: [{ seed: 321 }, { seed: 322, cards: 7 }], common: { form: 'dome', tiles: [['bushFlower', 1]], cards: 6, rad: 0.42, high: 0.5, card: 0.95, tints: [[[1, 1, 1], 1]] } },
  'under-scrub': { build: under, H: 1, variants: [{ seed: 331 }, { seed: 332, cards: 8, rad: 0.5 }], common: { form: 'dome', tiles: [['dryScrub', 3], ['spray', 1]], cards: 7, rad: 0.44, high: 0.62, card: 0.95, stems: 2, tints: [[[1, 1, 1], 3], [[1.1, 1.05, 0.78], 1]] } },
  'under-gorse': { build: under, H: 1, variants: [{ seed: 371 }, { seed: 372, cards: 9, rad: 0.52 }], common: { form: 'dome', tiles: [['gorse', 1]], cards: 8, rad: 0.46, high: 0.64, card: 0.95, stems: 1, tints: [[[1, 1, 1], 3], [[0.9, 0.98, 0.9], 1]] } },
  'under-bush': { build: under, H: 1, variants: [{ seed: 341 }, { seed: 342, cards: 10 }], common: { form: 'dome', tiles: [['broadA', 2], ['spray', 1]], cards: 9, rad: 0.46, high: 0.66, card: 0.85, stems: 1, tints: [[[1, 1, 1], 3], [[0.85, 0.96, 0.9], 1]] } },
  'under-grass': { build: under, H: 1, variants: [{ seed: 351 }, { seed: 352, cards: 2 }], common: { form: 'tuft', tile: 'grass', cards: 3, width: 1.0, tints: [[[1, 1, 1], 3], [[1.1, 1.06, 0.8], 1]] } },
  'under-rock': { build: under, H: 1, variants: [{ seed: 361, wide: 1.2, high: 0.34 }, { seed: 362, wide: 0.95, high: 0.48 }, { seed: 363, wide: 1.45, high: 0.26 }], common: { form: 'rock', tints: [[[1, 1, 1], 1]] } },
});
export const SPECIES_NAMES = Object.freeze(Object.keys(SPECIES));

// One model: species `name`, variant index v. Returns { attributes, lods, meta }.
// hero: the higher-detail model of the same tree (a rounder bole with more rings, longer roots,
// limbs that fork, more twigs, a fuller crown, every card cupped): the game stands it on the
// spots nearest a tee or a green (tree-models.js), where the player looks longest.
export function growTree(name, v = 0, { hero = false } = {}) {
  const sp = SPECIES[name];
  if (!sp) throw new Error(`no species "${name}"`);
  const S = { H: sp.H, ...sp.common, ...sp.variants[v % sp.variants.length], ...(hero ? { hero: true } : {}) };
  const M = new Model(S.seed * 7919 + 17);
  const { kind } = sp.build(M, S);
  return M.finish({ species: name, variant: v % sp.variants.length, kind, H: S.H, align: !!sp.align, ...(hero ? { hero: true } : {}) });
}
// the species that have a hero model: every tree (the understory's plants are small and many)
export const hasHero = (name) => { const sp = SPECIES[name]; return !!sp && sp.build !== under && name !== 'banana' && name !== 'treefern'; };
