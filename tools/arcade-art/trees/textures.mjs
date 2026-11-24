// The arcade trees' textures: painted foliage and bark, cut out and packed here.
//
//   public/arcade/trees/leaves.webp      2048 x 2560, a 4 x 5 atlas of leaf / frond / needle /
//                                        blossom tiles (LEAF_TILES names them): COLOUR
//   public/arcade/trees/leaves-aux.png   the same atlas's masks: R = coverage (alpha tested),
//                                        G = accent (flowers, seed heads, buds, snow: painted in the
//                                        tree's accent colour), B = blade (1 leaf, 0 twig / wood)
//   public/arcade/trees/bark.webp        2048 x 1024, eight bark columns side by side
//                                        (BARK_COLUMNS names them), each tiling up the trunk: COLOUR
//   public/arcade/trees/bark-n.webp      the columns' normal map (RG) and moss mask (B)
//
// The pictures themselves were painted by an image model, one a tile, from the prompts in
// prompts.mjs (original work made for this game: no photograph, no texture library). This
// file turns a folder of those pictures into the four files above:
//
//   - the flat background is keyed out (the alpha is cut here, not by the model), the spill
//     is taken off the edges, and the colour under the cut is DILATED outward to the tile's
//     edge, so no mip level ever pulls background into a leaf's rim;
//   - leaf, twig and flower pixels are told apart by hue (the blade and accent masks);
//   - colour is stored as DETAIL round each tile's own mean (x 0.4, sRGB), so the game still
//     colours every tree from its world's palette (tree-species.js) and the paint only says
//     how leaves differ from one another: veins, shading, the warm and cool leaves of a
//     cluster. Wood keeps its painted colour;
//   - bark is made to tile up the trunk, flattened (no painted roundness), and its normal map
//     is derived from its own light and dark.
//
//   node tools/arcade-art/trees/textures.mjs --src <folder of <tile>.png> [--out public/arcade/trees] [--preview <dir>]
//
// build.mjs calls this only when given --paint <folder>: without the pictures the shipped
// textures are left as they are (the models are still grown from seeds every time).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const LEAF_TILES = Object.freeze(['broadA', 'broadB', 'bigleaf', 'spray', 'frond', 'fan', 'banana', 'fern', 'bough', 'pineTuft', 'blossom', 'maple', 'bushFlower', 'grass', 'vine', 'twig', 'juniper', 'gorse', 'dryScrub', 'boughSnow']);
export const LEAF_GRID = Object.freeze([4, 5]);   // columns, rows
export const BARK_COLUMNS = Object.freeze(['ridged', 'plated', 'smooth', 'ringed', 'banded', 'fibrous', 'dead', 'mossy']);
export const TILE = 512, BARK_W = 256, BARK_H = 1024;
export const DETAIL_MID = 0.4;   // a tile's mean colour is stored as this (linear); the shader multiplies by 1 / DETAIL_MID

// how each picture is laid in its tile, and how its pixels are told apart
//   fit: cluster (uniform, centred) | strip (stalk at the bottom centre, tip at the top: stretched to
//        the whole tile, the midrib on the centre line) | hang (from the top edge) | grow (from the bottom centre)
//   accent / wood: names of the rules below; soft: < 1 presses the tile's light and dark together (a pale
//   mass of blossom, not a dark-hearted rosette on every card)
const LEAF_SPEC = Object.freeze({
  broadA: { fit: 'cluster', wood: 'brown' }, broadB: { fit: 'cluster', wood: 'brown' }, bigleaf: { fit: 'cluster', wood: 'brown' },
  spray: { fit: 'cluster', wood: 'brown' }, juniper: { fit: 'cluster', wood: 'brown' }, pineTuft: { fit: 'cluster', wood: 'brown' },
  blossom: { fit: 'cluster', wood: 'darkTwig', key: 'blue', soft: 0.55 }, maple: { fit: 'cluster', wood: 'dullDark', key: 'blue' },
  bushFlower: { fit: 'cluster', wood: 'brown', accent: 'white' }, gorse: { fit: 'cluster', wood: 'brown', accent: 'yellow' },
  dryScrub: { fit: 'cluster', wood: 'brown' },
  frond: { fit: 'strip' }, fan: { fit: 'cluster' }, banana: { fit: 'strip' }, fern: { fit: 'strip', wood: 'brown' },
  bough: { fit: 'strip', wood: 'brown' }, boughSnow: { fit: 'strip', wood: 'brown', accent: 'snow' },
  grass: { fit: 'grow', accent: 'straw' }, vine: { fit: 'hang', wood: 'brown' }, twig: { fit: 'grow', wood: 'all', accent: 'bud' },
});

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float32Array.from({ length: 256 }, (_, i) => toLin(i / 255));
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx > 0 ? d / mx : 0, mx];
}
// r, g, b in 0..1 (as painted, sRGB): is this pixel an accent / wood?
const ACCENT = {
  white: (h, s, v) => (s < 0.3 && v > 0.42) || (h > 195 && h < 300 && s < 0.5 && v > 0.4) || (h > 35 && h < 66 && s > 0.35 && v > 0.78),   // petals, their shaded sides, their yellow centres
  yellow: (h, s, v) => h > 24 && h < 61 && s > 0.5 && v > 0.55,
  snow: (h, s, v) => (s < 0.2 && v > 0.6) || (h > 185 && h < 265 && s < 0.42 && v > 0.55),
  straw: (h, s, v) => h > 18 && h < 53 && s < 0.68 && v > 0.6,
  bud: (h, s, v) => h > 38 && h < 80 && s > 0.45 && v > 0.6,
};
const WOOD = {
  brown: (h, s, v) => (s >= 0.08 ? (h < 52 || h > 300) && v < 0.8 : v < 0.45),
  darkTwig: (h, s, v) => v < 0.5 && ((h > 8 && h < 48 && s < 0.8) || s < 0.22),   // brown or grey, never a petal's own dark pink
  dullDark: (h, s, v) => v < 0.36 && s < 0.5,
  all: () => true,
};

async function loadRgb(sharp, file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

// Fill every pixel whose weight is 0 from the weighted pixels round it (push-pull over a
// pyramid): the colour of a leaf's rim carried out across the cut-away background.
function dilate(rgb, wt, w, h) {
  const levels = [{ c: rgb, a: wt, w, h }];
  while (levels.at(-1).w > 1 || levels.at(-1).h > 1) {
    const L = levels.at(-1), nw = Math.max(1, Math.ceil(L.w / 2)), nh = Math.max(1, Math.ceil(L.h / 2));
    const c = new Float32Array(nw * nh * 3), a = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let s = 0, r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const xx = x * 2 + dx, yy = y * 2 + dy;
        if (xx >= L.w || yy >= L.h) continue;
        const i = yy * L.w + xx, k = L.a[i];
        s += k; r += L.c[i * 3] * k; g += L.c[i * 3 + 1] * k; b += L.c[i * 3 + 2] * k;
      }
      const o = y * nw + x;
      if (s > 0) { c[o * 3] = r / s; c[o * 3 + 1] = g / s; c[o * 3 + 2] = b / s; a[o] = Math.min(1, s); }
    }
    levels.push({ c, a, w: nw, h: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, k = L.a[i];
      if (k >= 1) continue;
      const j = Math.min(U.h - 1, y >> 1) * U.w + Math.min(U.w - 1, x >> 1);
      for (let q = 0; q < 3; q++) L.c[i * 3 + q] = L.c[i * 3 + q] * k + U.c[j * 3 + q] * (1 - k);
      L.a[i] = 1;
    }
  }
}

// One painted leaf picture -> its tile: { color (TILE x TILE x 3, sRGB detail), aux (x 3: coverage, accent, blade), stats }
async function leafTile(sharp, file, name) {
  const spec = LEAF_SPEC[name];
  const { px, w, h } = await loadRgb(sharp, file);
  const n = w * h, blue = spec.key === 'blue';
  // the background: the median of the picture's border
  const border = [[], [], []];
  for (let x = 0; x < w; x += 3) for (const y of [2, h - 3]) for (let k = 0; k < 3; k++) border[k].push(px[(y * w + x) * 3 + k]);
  for (let y = 0; y < h; y += 3) for (const x of [2, w - 3]) for (let k = 0; k < 3; k++) border[k].push(px[(y * w + x) * 3 + k]);
  const bg = border.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
  const keyOf = (r, g, b) => (blue ? b - Math.max(r, g) : Math.min(r, b) - g);
  const kBg = Math.max(40, keyOf(bg[0], bg[1], bg[2]));
  const alpha = new Float32Array(n), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    const t = clamp01(keyOf(r, g, b) / kBg);
    const u = clamp01((t - 0.12) / 0.7), a = 1 - u * u * (3 - 2 * u);
    if (a > 0.02) {
      // take the background's share out of an edge pixel, then whatever spill is left
      const e = Math.max(a, 0.3);
      r = (r - (1 - a) * bg[0]) / e; g = (g - (1 - a) * bg[1]) / e; b = (b - (1 - a) * bg[2]) / e;
      if (blue) b = Math.min(b, Math.max(r, g) + 6); else { const sp = Math.max(0, Math.min(r, b) - g); r -= sp; b -= sp; }
    }
    alpha[i] = a;
    col[i * 3] = Math.min(255, Math.max(0, r)); col[i * 3 + 1] = Math.min(255, Math.max(0, g)); col[i * 3 + 2] = Math.min(255, Math.max(0, b));
  }
  // masks by hue, and each kind's mean (linear)
  const accent = new Float32Array(n), blade = new Float32Array(n);
  const mean = { blade: [0, 0, 0, 0], accent: [0, 0, 0, 0] };
  const isAcc = spec.accent ? ACCENT[spec.accent] : null, isWood = spec.wood ? WOOD[spec.wood] : null;
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.5) { blade[i] = spec.wood === 'all' ? 0 : 1; continue; }
    const r = col[i * 3] / 255, g = col[i * 3 + 1] / 255, b = col[i * 3 + 2] / 255;
    const [hh, s, v] = hsv(r, g, b);
    const acc = isAcc && isAcc(hh, s, v), wood = !acc && isWood && isWood(hh, s, v);
    accent[i] = acc ? 1 : 0; blade[i] = wood ? 0 : 1;
    const m = acc ? mean.accent : wood ? null : mean.blade;
    if (m) { m[0] += toLin(r); m[1] += toLin(g); m[2] += toLin(b); m[3]++; }
  }
  for (const m of Object.values(mean)) if (m[3]) { m[0] /= m[3]; m[1] /= m[3]; m[2] /= m[3]; }
  // what is stored: detail round the mean for leaves and accents, the painted colour for wood (linear)
  const store = new Float32Array(n * 3), wt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.5) continue;
    wt[i] = 1;
    const lin = [toLin(col[i * 3] / 255), toLin(col[i * 3 + 1] / 255), toLin(col[i * 3 + 2] / 255)];
    const m = accent[i] ? mean.accent : blade[i] ? mean.blade : null;
    if (!m) { store[i * 3] = lin[0]; store[i * 3 + 1] = lin[1]; store[i * 3 + 2] = lin[2]; continue; }
    let d = [lin[0] / Math.max(1e-4, m[0]), lin[1] / Math.max(1e-4, m[1]), lin[2] / Math.max(1e-4, m[2])];
    // an accent keeps its light and dark and half of its own hue drift (a white petal's shade, not a second colour)
    const luma = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], keep = accent[i] ? 0.5 : 0.9;
    // (a stray pixel far from its kind's mean hue stays a shade of that kind, never a second colour)
    d = d.map((v) => Math.min(luma * 1.6, Math.max(luma * 0.55, luma + (v - luma) * keep)));
    if (spec.soft) { const k = Math.min(2.4, Math.max(luma, 0.04) ** (spec.soft - 1)); d = d.map((v) => v * k); }
    for (let k = 0; k < 3; k++) store[i * 3 + k] = Math.min(1, d[k] * DETAIL_MID);
  }
  dilate(store, wt, w, h);
  // the picture's box, and where it goes in the tile
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const M = 14, inner = TILE - 2 * M;
  let sx0, sx1, sy0, sy1, dx0 = M, dy0 = M, dw = inner, dh = inner;   // source box -> destination box
  if (spec.fit === 'cluster') {
    const side = Math.max(x1 - x0, y1 - y0) + 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    sx0 = cx - side / 2; sx1 = cx + side / 2; sy0 = cy - side / 2; sy1 = cy + side / 2;
  } else {
    sy0 = y0; sy1 = y1 + 1;
    if (spec.fit === 'hang') { sx0 = x0; sx1 = x1 + 1; } else {
      // the stalk: where the lowest rows of the picture are
      let sum = 0, cnt = 0;
      for (let y = Math.round(y1 - (y1 - y0) * 0.05); y <= y1; y++) for (let x = x0; x <= x1; x++) if (alpha[y * w + x] > 0.5) { sum += x; cnt++; }
      const stalk = cnt ? sum / cnt : (x0 + x1) / 2, half = Math.max(stalk - x0, x1 - stalk) + 1;
      sx0 = stalk - half; sx1 = stalk + half;
    }
  }
  const color = new Uint8Array(TILE * TILE * 3), aux = new Uint8Array(TILE * TILE * 3);
  const fx = (sx1 - sx0) / dw, fy = (sy1 - sy0) / dh;
  for (let ty = 0; ty < TILE; ty++) for (let tx = 0; tx < TILE; tx++) {
    // the source box this texel covers (area filter)
    const ax = sx0 + (tx - dx0) * fx, ay = sy0 + (ty - dy0) * fy;
    const ix0 = Math.floor(ax), ix1 = Math.max(ix0, Math.ceil(ax + fx) - 1), iy0 = Math.floor(ay), iy1 = Math.max(iy0, Math.ceil(ay + fy) - 1);
    let a = 0, ac = 0, bl = 0, r = 0, g = 0, b = 0, cnt = 0, wsum = 0;
    for (let yy = iy0; yy <= iy1; yy++) for (let xx = ix0; xx <= ix1; xx++) {
      cnt++;
      const cxx = Math.min(w - 1, Math.max(0, xx)), cyy = Math.min(h - 1, Math.max(0, yy)), i = cyy * w + cxx;
      const inside = xx >= 0 && yy >= 0 && xx < w && yy < h;
      const al = inside ? alpha[i] : 0;
      a += al; ac += al * accent[i]; bl += al * blade[i];
      const k = 0.02 + al;   // colour weighted by coverage (the dilated colour stands in where nothing is covered)
      wsum += k; r += store[i * 3] * k; g += store[i * 3 + 1] * k; b += store[i * 3 + 2] * k;
    }
    const o = (ty * TILE + tx) * 3;
    color[o] = Math.round(255 * clamp01(toSrgb(r / wsum))); color[o + 1] = Math.round(255 * clamp01(toSrgb(g / wsum))); color[o + 2] = Math.round(255 * clamp01(toSrgb(b / wsum)));
    aux[o] = Math.round(255 * clamp01(a / cnt));
    aux[o + 1] = a > 1e-3 ? Math.round(255 * clamp01(ac / a)) : 0;
    aux[o + 2] = a > 1e-3 ? Math.round(255 * clamp01(bl / a)) : (spec.wood === 'all' ? 0 : 255);
  }
  // carry the accent and blade masks out past the cut too (a mip must not fade a flower to leaf at its rim)
  let cover = 0;
  for (let i = 0; i < TILE * TILE; i++) cover += aux[i * 3] / 255;
  return { color, aux, stats: { cover: Math.round(cover / (TILE * TILE) * 1000) / 1000, mean: mean.blade.slice(0, 3).map((v) => Math.round(toSrgb(v) * 255)), accentShare: Math.round(mean.accent[3] / Math.max(1, mean.accent[3] + mean.blade[3]) * 1000) / 1000, box: [x0, y0, x1, y1], size: [w, h] } };
}

// One painted bark picture -> its column: colour detail (BARK_W x BARK_H x 3, sRGB), normal + moss (x 3)
async function barkColumn(sharp, file, name) {
  const W = BARK_W, H = BARK_H;
  const meta = await sharp(file).metadata(), cut = Math.round(meta.width * 0.035);   // a picture may carry a line down its edges
  const { data } = await sharp(file).removeAlpha().toColourspace('srgb').extract({ left: cut, top: 0, width: meta.width - 2 * cut, height: meta.height }).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const lin = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) lin[i] = LIN[data[i]];
  const luma = (i) => 0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2];
  // flatten: a painted trunk is lighter down its middle; divide that out, column by column, and any slow drift up it
  const colMean = new Float32Array(W), rowMean = new Float32Array(H);
  let all = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const l = luma(y * W + x); colMean[x] += l / H; rowMean[y] += l / W; all += l / (W * H); }
  const smooth1 = (a, rad, wrap) => { const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let d = -rad; d <= rad; d++) { let j = i + d; if (wrap) j = (j + a.length) % a.length; else if (j < 0 || j >= a.length) continue; s += a[j]; c++; } out[i] = s / c; } return out; };
  const cs = smooth1(colMean, 40, false), rs = smooth1(rowMean, 160, true);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (all / Math.max(1e-4, cs[x])) * (all / Math.max(1e-4, rs[y])); const i = (y * W + x) * 3; lin[i] *= k; lin[i + 1] *= k; lin[i + 2] *= k; }
  // tile up the trunk: the picture cross-faded with itself shifted half its height, the seam of
  // each hidden under the middle of the other; the fade's edge wanders so it is not a straight band
  const out = new Float32Array(W * H * 3);
  const hash = (x, y) => { let q = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  const wob = (x, y) => { const gx = x / 32, gy = y / 32, xi = Math.floor(gx), yi = Math.floor(gy), fx = gx - xi, fy = gy - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const v = (i, j) => hash(xi + i, (yi + j) % (H / 32)); return v(0, 0) * (1 - sx) * (1 - sy) + v(1, 0) * sx * (1 - sy) + v(0, 1) * (1 - sx) * sy + v(1, 1) * sx * sy; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.abs(y / H - 0.5) * 2 + (wob(x, y) - 0.5) * 0.24;   // 0 in the middle, 1 at the picture's own top and bottom
    const t = clamp01((d - 0.58) / 0.2), m = t * t * (3 - 2 * t);
    const a = (y * W + x) * 3, b = (((y + H / 2) % H) * W + x) * 3;
    for (let k = 0; k < 3; k++) out[a + k] = lin[a + k] * (1 - m) + lin[b + k] * m;
  }
  // moss: the green of the picture (the mossy column only)
  const moss = new Float32Array(W * H);
  const mean = [0, 0, 0], mossMean = [0, 0, 0];
  let nb = 0, nm = 0;
  for (let i = 0; i < W * H; i++) {
    const r = toSrgb(out[i * 3]), g = toSrgb(out[i * 3 + 1]), b = toSrgb(out[i * 3 + 2]);
    const [hh, s, v] = hsv(r, g, b);
    const isMoss = name === 'mossy' && hh > 62 && hh < 170 && s > 0.3 && v > 0.16;
    moss[i] = isMoss ? 1 : 0;
    const m = isMoss ? mossMean : mean;
    m[0] += out[i * 3]; m[1] += out[i * 3 + 1]; m[2] += out[i * 3 + 2];
    if (isMoss) nm++; else nb++;
  }
  for (let k = 0; k < 3; k++) { mean[k] /= Math.max(1, nb); mossMean[k] /= Math.max(1, nm); }
  const color = new Uint8Array(W * H * 3), nrm = new Uint8Array(W * H * 3), height = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const m = moss[i] ? mossMean : mean;
    let d = [out[i * 3] / Math.max(1e-4, m[0]), out[i * 3 + 1] / Math.max(1e-4, m[1]), out[i * 3 + 2] / Math.max(1e-4, m[2])];
    const l = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], keep = moss[i] ? 0.5 : 0.85;
    d = d.map((v) => l + (v - l) * keep);
    for (let k = 0; k < 3; k++) color[i * 3 + k] = Math.round(255 * clamp01(toSrgb(Math.min(1, d[k] * DETAIL_MID))));
    height[i] = Math.sqrt(clamp01(l * 0.5)) + (moss[i] ? 0.12 : 0);   // light is high, cracks are low; moss stands proud
  }
  // the normal: the slope of that height, a little smoothed (y wraps; x is mirrored by the trunk's own UVs)
  const hb = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = (y + dy + H) % H, k = (dx ? 1 : 2) * (dy ? 1 : 2); s += height[yy * W + xx] * k; c += k; }
    hb[y * W + x] = s / c;
  }
  const mossB = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = (y + dy + H) % H; s += moss[yy * W + xx]; c++; } mossB[y * W + x] = s / c; }
  // (as strong as the paint is contrasty, but a charred column's deep cracks are held to a slope the light can read)
  let rms = 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) { const gx = hb[y * W + x + 1] - hb[y * W + x - 1], gy = hb[((y + 1) % H) * W + x] - hb[((y - 1 + H) % H) * W + x]; rms += gx * gx + gy * gy; }
  rms = Math.sqrt(rms / (W * H));
  const STR = Math.min(5.5, 0.5 / Math.max(1e-4, rms));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = (y - 1 + H) % H, yd = (y + 1) % H;
    const dx = (hb[y * W + xr] - hb[y * W + xl]) * STR, dy = (hb[yd * W + x] - hb[yu * W + x]) * STR;   // dy: down the picture
    const il = 1 / Math.hypot(dx, dy, 1), o = (y * W + x) * 3;
    nrm[o] = Math.round(255 * clamp01(0.5 - 0.5 * dx * il));
    nrm[o + 1] = Math.round(255 * clamp01(0.5 + 0.5 * dy * il));   // +y is UP the trunk (v runs up, the picture's rows run down)
    nrm[o + 2] = Math.round(255 * mossB[y * W + x]);
  }
  return { color, nrm, stats: { mean: mean.map((v) => Math.round(toSrgb(v) * 255)), moss: Math.round(nm / (W * H) * 1000) / 1000 } };
}

export async function buildTextures({ srcDir, outDir = path.join(ROOT, 'public', 'arcade', 'trees'), preview = null, log = () => {} } = {}) {
  if (!srcDir) throw new Error('buildTextures: srcDir (the folder of painted pictures) is required');
  const sharp = createRequire(import.meta.url)('sharp');
  fs.mkdirSync(outDir, { recursive: true });
  const [GX, GY] = LEAF_GRID, AW = GX * TILE, AH = GY * TILE;
  const color = new Uint8Array(AW * AH * 3).fill(Math.round(255 * toSrgb(DETAIL_MID))), aux = new Uint8Array(AW * AH * 3);
  const stats = { leaves: {}, bark: {} };
  for (let t = 0; t < LEAF_TILES.length; t++) {
    const name = LEAF_TILES[t], file = path.join(srcDir, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`no picture for leaf tile "${name}" (${file})`);
    const tile = await leafTile(sharp, file, name);
    const gx = (t % GX) * TILE, gy = Math.floor(t / GX) * TILE;
    for (let y = 0; y < TILE; y++) { const o = ((gy + y) * AW + gx) * 3, s = y * TILE * 3; color.set(tile.color.subarray(s, s + TILE * 3), o); aux.set(tile.aux.subarray(s, s + TILE * 3), o); }
    stats.leaves[name] = tile.stats;
    log(`leaf ${name.padEnd(11)} cover ${tile.stats.cover}  mean rgb ${tile.stats.mean.join(',')}  accent ${tile.stats.accentShare}`);
  }
  const BW = BARK_W * BARK_COLUMNS.length;
  const bark = new Uint8Array(BW * BARK_H * 3), barkN = new Uint8Array(BW * BARK_H * 3);
  for (let c = 0; c < BARK_COLUMNS.length; c++) {
    const name = BARK_COLUMNS[c], file = path.join(srcDir, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`no picture for bark column "${name}" (${file})`);
    const col = await barkColumn(sharp, file, name);
    for (let y = 0; y < BARK_H; y++) { const o = (y * BW + c * BARK_W) * 3, s = y * BARK_W * 3; bark.set(col.color.subarray(s, s + BARK_W * 3), o); barkN.set(col.nrm.subarray(s, s + BARK_W * 3), o); }
    stats.bark[name] = col.stats;
    log(`bark ${name.padEnd(11)} mean rgb ${col.stats.mean.join(',')}${col.stats.moss ? `  moss ${col.stats.moss}` : ''}`);
  }
  const files = {
    leaves: { file: 'leaves.webp', grid: [...LEAF_GRID], tile: TILE },
    leavesAux: { file: 'leaves-aux.png', grid: [...LEAF_GRID], tile: TILE },
    bark: { file: 'bark.webp', columns: BARK_COLUMNS.length, column: [BARK_W, BARK_H] },
    barkNormal: { file: 'bark-n.webp', columns: BARK_COLUMNS.length, column: [BARK_W, BARK_H] },
  };
  const raw = (buf, w, h) => sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width: w, height: h, channels: 3 } });
  await raw(color, AW, AH).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(path.join(outDir, files.leaves.file));
  await raw(aux, AW, AH).png({ compressionLevel: 9 }).toFile(path.join(outDir, files.leavesAux.file));
  await raw(bark, BW, BARK_H).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(path.join(outDir, files.bark.file));
  await raw(barkN, BW, BARK_H).webp({ quality: 92, effort: 6, smartSubsample: true }).toFile(path.join(outDir, files.barkNormal.file));
  for (const f of Object.values(files)) { f.bytes = fs.statSync(path.join(outDir, f.file)).size; f.width = f.grid ? AW : BW; f.height = f.grid ? AH : BARK_H; }
  if (preview) {
    // what the game will draw, roughly: each tile coloured a leaf green (pink for blossom, red for maple) on grey
    fs.mkdirSync(preview, { recursive: true });
    const out = Buffer.alloc(AW * AH * 3);
    const palette = { blossom: [1.0, 0.61, 0.78], maple: [0.91, 0.31, 0.16], dryScrub: [0.6, 0.66, 0.38], juniper: [0.45, 0.6, 0.4] };
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      const i = (y * AW + x) * 3, name = LEAF_TILES[Math.floor(y / TILE) * GX + Math.floor(x / TILE)];
      const leaf = palette[name] || [0.36, 0.72, 0.25], acc = name === 'gorse' ? [1, 0.82, 0.12] : name === 'grass' ? [0.91, 0.85, 0.54] : [1, 1, 1];
      const a = aux[i] / 255 >= 0.5 ? 1 : 0, ac = aux[i + 1] / 255, bl = aux[i + 2] / 255;
      for (let k = 0; k < 3; k++) {
        const d = toLin(color[i + k] / 255) / DETAIL_MID;
        let c = d * DETAIL_MID * (1 - bl) + toLin(leaf[k]) * d * bl;
        c = c * (1 - ac) + toLin(acc[k]) * d * ac;
        out[i + k] = Math.round(255 * clamp01(toSrgb(0.16 + (c - 0.16) * a)));
      }
    }
    await sharp(out, { raw: { width: AW, height: AH, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(preview, 'leaves-preview.jpg'));
    await raw(aux, AW, AH).resize(AW / 2, AH / 2).jpeg({ quality: 85 }).toFile(path.join(preview, 'leaves-aux-preview.jpg'));
    const tinted = Buffer.alloc(BW * BARK_H * 2 * 3);
    for (let rep = 0; rep < 2; rep++) for (let i = 0; i < BW * BARK_H; i++) for (let k = 0; k < 3; k++) tinted[(rep * BW * BARK_H + i) * 3 + k] = Math.round(255 * clamp01(toSrgb(toLin(bark[i * 3 + k] / 255) / DETAIL_MID * [0.2, 0.13, 0.09][k])));
    await sharp(tinted, { raw: { width: BW, height: BARK_H * 2, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(preview, 'bark-preview.jpg'));
    await raw(barkN, BW, BARK_H).jpeg({ quality: 88 }).toFile(path.join(preview, 'bark-n-preview.jpg'));
  }
  return { files, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  if (!flag('--src')) { console.error('usage: node tools/arcade-art/trees/textures.mjs --src <folder of painted pictures> [--out public/arcade/trees] [--preview <dir>]'); process.exit(1); }
  const res = await buildTextures({ srcDir: path.resolve(flag('--src')), outDir: flag('--out') ? path.resolve(flag('--out')) : undefined, preview: flag('--preview') ? path.resolve(flag('--preview')) : null, log: console.log });
  console.log(Object.values(res.files).map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).join(', '));
}
