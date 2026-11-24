// Pixel helpers shared by the environment art tools (sky-build.mjs, tex-build.mjs). Pure:
// typed arrays in, typed arrays out, so test/env-art.test.mjs can run them without an image.

// The band of elevation (degrees) every stage sky covers, bottom to top. The game's dome
// shader (public/render/far-world.js) reads the same two numbers from the manifest.
export const SKY_BAND = Object.freeze([-15, 75]);

export const srgb8ToLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const linearToSrgb8 = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
export const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const luma = (px, o) => 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];

/**
 * Close a wrap seam in place. px: Float32Array RGB (0..255), row-major. The step between
 * the last and the first column of each row is spread, half each way, over `reach` columns
 * at both ends, falling off smoothly: the two edges meet and nothing is cross-faded, so
 * nothing ghosts. A strip that already wraps is left as it was.
 */
export function closeSeam(px, W, H, reach) {
  const R = Math.max(1, Math.min(reach, W >> 1));
  const step = new Float32Array(H * 3);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) step[y * 3 + c] = px[(y * W + W - 1) * 3 + c] - px[(y * W) * 3 + c];
  // each row takes its own step exactly: the two edges then meet to the last count, on a
  // hard horizon line as much as in open sky
  const sm = step;
  for (let y = 0; y < H; y++) {
    for (let d = 0; d < R; d++) {
      const t = 1 - d / R, w = 0.5 * t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++) {
        px[(y * W + d) * 3 + c] += sm[y * 3 + c] * w;
        px[(y * W + W - 1 - d) * 3 + c] -= sm[y * 3 + c] * w;
      }
    }
  }
  return px;
}

/** The largest step left across the wrap, as a share of full scale (0..1): what a seam check reads. */
export function seamError(px, W, H, channels = 3) {
  let worst = 0;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let c = 0; c < 3; c++) {
      // the step across the wrap, less the step the picture takes between neighbours anyway
      const across = Math.abs(px[(y * W + W - 1) * channels + c] - px[(y * W) * channels + c]);
      const inside = Math.abs(px[(y * W + 1) * channels + c] - px[(y * W) * channels + c]) + Math.abs(px[(y * W + W - 1) * channels + c] - px[(y * W + W - 2) * channels + c]);
      s += Math.max(0, across - inside);
    }
    worst = Math.max(worst, s / (3 * 255));
  }
  return worst;
}

/** The row of the horizon: the strongest level edge (mean colour change between rows) in the lower two thirds. */
export function findHorizon(px, W, H) {
  const mean = new Float32Array(H * 3);
  for (let y = 0; y < H; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < W; x += 8) { const o = (y * W + x) * 3; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
    mean[y * 3] = r / n; mean[y * 3 + 1] = g / n; mean[y * 3 + 2] = b / n;
  }
  let best = 0, row = Math.round(H * 0.75);
  const k = Math.max(2, Math.round(H * 0.006));
  for (let y = Math.round(H * 0.34) + k; y < H - k - 2; y++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(mean[(y + k) * 3 + c] - mean[(y - k) * 3 + c]);
    if (d > best) { best = d; row = y; }
  }
  // the edge is somewhere in that window: the row where one row to the next changes most
  let sharp = -1, at = row;
  for (let y = Math.max(1, row - k); y <= Math.min(H - 1, row + k + 1); y++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(mean[y * 3 + c] - mean[(y - 1) * 3 + c]);
    if (d > sharp) { sharp = d; at = y; }
  }
  return at;
}

/** The sun or moon: the brightest soft blob above the horizon. -> { u, v } as fractions across and down. */
export function findSun(px, W, H, horizonRow) {
  const cw = 512, ch = Math.max(8, Math.round((cw * H) / W)), sx = W / cw, sy = H / ch;
  const L = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    let s = 0, n = 0;
    for (let y = Math.floor(j * sy); y < Math.min(H, Math.floor((j + 1) * sy)); y += 2) for (let x = Math.floor(i * sx); x < Math.min(W, Math.floor((i + 1) * sx)); x += 2) { s += luma(px, (y * W + x) * 3); n++; }
    L[j * cw + i] = n ? s / n : 0;
  }
  // a blur, so a small bright disc with a wide glow beats a big white cloud's edge
  const B = new Float32Array(cw * ch), r = 5;
  const hMax = Math.min(ch, Math.floor(horizonRow / sy) - 1);
  let best = -1, bi = 0, bj = 0;
  for (let j = 0; j < hMax; j++) for (let i = 0; i < cw; i++) {
    let s = 0, n = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const jj = j + dj; if (jj < 0 || jj >= hMax) continue;
      const w = 1 / (1 + di * di + dj * dj);
      s += Math.pow(L[jj * cw + ((i + di + cw) % cw)] / 255, 6) * w; n += w;
    }
    B[j * cw + i] = s / n;
    if (B[j * cw + i] > best) { best = B[j * cw + i]; bi = i; bj = j; }
  }
  // centre of the blob round the peak
  let su = 0, sv = 0, sw = 0;
  for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
    const jj = bj + dj; if (jj < 0 || jj >= hMax) continue;
    const w = Math.max(0, B[jj * cw + ((bi + di + cw) % cw)] - best * 0.6);
    su += (bi + di) * w; sv += jj * w; sw += w;
  }
  return { u: (((su / sw + 0.5) / cw) % 1 + 1) % 1, v: (sv / sw + 0.5) / ch };
}

/**
 * Make a square texture tile in place (Float32Array, `channels` a pixel): its edges are
 * cross-faded with the picture shifted half its size, which already tiles, weighted by the
 * distance to the edge. Stochastic textures (grass, sand, rock) hide the blend.
 */
export function makeTileable(px, N, channels = 3, band = 0.18) {
  const src = px.slice();
  const half = N >> 1, B = Math.max(2, Math.round(N * band));
  const edge = (i) => { const d = Math.min(i, N - 1 - i); const t = Math.min(1, d / B); return t * t * (3 - 2 * t); };   // 0 at the edge, 1 inside
  for (let y = 0; y < N; y++) {
    const wy = edge(y);
    for (let x = 0; x < N; x++) {
      const w = Math.min(wy, edge(x));
      if (w >= 1) continue;
      const o = (y * N + x) * channels, s = (((y + half) % N) * N + ((x + half) % N)) * channels;
      for (let c = 0; c < channels; c++) px[o + c] = src[o + c] * w + src[s + c] * (1 - w);
    }
  }
  return px;
}

/**
 * How badly a square tile fails to repeat, 0..1: the mean step across its two wraps, less
 * the mean step the picture takes between neighbouring texels anyway (a grainy texture
 * steps a lot everywhere; what shows as a seam is stepping MORE across the wrap).
 */
export function tileError(px, N, channels = 3) {
  let across = 0, inside = 0, n = 0;
  for (let i = 0; i < N; i++) for (let c = 0; c < Math.min(3, channels); c++) {
    across += Math.abs(px[(i * N + N - 1) * channels + c] - px[(i * N) * channels + c]) + Math.abs(px[((N - 1) * N + i) * channels + c] - px[i * channels + c]);
    inside += Math.abs(px[(i * N + 1) * channels + c] - px[(i * N) * channels + c]) + Math.abs(px[(N + i) * channels + c] - px[i * channels + c]);
    n += 2;
  }
  return Math.max(0, across - inside) / (n * 255);
}

/** A height field (Float32Array N*N, 0..1) from a colour tile's luminance, band-passed: what its light and shade suggest. */
export function heightFromColor(px, N, channels = 3) {
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = luma(px, i * channels) / 255;
  // take out the broad shading (a wrapped box blur), keep the relief
  const blur = boxBlurWrap(h, N, Math.max(2, Math.round(N * 0.04)));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { h[i] -= blur[i]; if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / Math.max(1e-6, hi - lo);
  return h;
}

export function boxBlurWrap(h, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), k = 1 / (2 * r + 1);
  for (let y = 0; y < N; y++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += h[y * N + ((d + N) % N)];
    for (let x = 0; x < N; x++) { tmp[y * N + x] = s * k; s += h[y * N + ((x + r + 1) % N)] - h[y * N + ((x - r + N) % N)]; }
  }
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[((d + N) % N) * N + x];
    for (let y = 0; y < N; y++) { out[y * N + x] = s * k; s += tmp[((y + r + 1) % N) * N + x] - tmp[((y - r + N) % N) * N + x]; }
  }
  return out;
}

/** A tangent-space normal map (Uint8 RGB... x, y in 0..255, z up) from a wrapped height field. */
export function normalFromHeight(h, N, strength = 2) {
  const out = new Uint8Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = h[y * N + ((x - 1 + N) % N)], r = h[y * N + ((x + 1) % N)], u = h[((y - 1 + N) % N) * N + x], d = h[((y + 1) % N) * N + x];
    const nx = (l - r) * strength, ny = (u - d) * strength, k = 1 / Math.hypot(nx, ny, 1), o = (y * N + x) * 3;
    out[o] = Math.round((nx * k * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * k * 0.5 + 0.5) * 255); out[o + 2] = Math.round((k * 0.5 + 0.5) * 255);
  }
  return out;
}
