#!/usr/bin/env node
// Turn a generated panorama strip into a stage sky (docs/arcade-look.md, "The world round a stage"):
//
//   node tools/arcade-art/env/sky-build.mjs --id tropical-day --src <strip.png> [--front 0.62]
//        [--horizon 0.75] [--sun 0.25,0.48 | --sun-az 285 --sun-alt 28] [--seam 0.03] [--width 8192]
//        [--quality 80] [--note "..."] [--model nano_banana_2_1] [--job <id>] [--prompt-file <txt>]
//
// The source is a wide strip (4:1 or so) that wraps round the whole horizon: a level
// horizon line, sky above, a little sea or far ground below. This tool:
//   1. closes the seam: the step between the last and the first column is spread over
//      `--seam` of the width on each side (no ghosting: nothing is cross-faded);
//   2. finds the horizon row (or takes --horizon, a fraction from the top) and re-lays the
//      strip on the fixed band the game draws, -15 .. +75 degrees of elevation, at the
//      strip's own scale along the horizon (so clouds keep their shape); what the strip
//      does not reach is its own top colour (the zenith) and its own bottom colour;
//   3. turns it so --front (a fraction across the source: the part the player should face
//      from the tee) is due north, the centre column of the output;
//   4. finds the sun or the moon (the brightest soft blob above the horizon), or takes it
//      from --sun (fractions across and down the SOURCE) or --sun-az / --sun-alt;
//   5. measures the haze colour round the horizon (16 sectors), the zenith and the ground;
//   6. writes public/arcade/env/sky/<id>.webp and its row in public/arcade/env/manifest.json
//      (bytes, SHA-256, the sun, the colours, where the picture came from).
//
// Needs sharp (already a dev dependency of the app's packaging tools). Nothing is fetched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SKY_BAND, closeSeam, findHorizon, findSun, hex, linearToSrgb8, srgb8ToLinear } from './lib.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..');
const envDir = path.join(repo, 'public', 'arcade', 'env');
const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const id = flag('--id');
const src = flag('--src');
if (!id || !/^[a-z0-9-]+$/.test(id) || !src) { console.error('usage: sky-build.mjs --id <name> --src <strip image> [--front 0..1] ...'); process.exit(1); }
const OUT_W = +(flag('--width') || 8192), OUT_H = OUT_W / 4;
const front = +(flag('--front') ?? 0.5);
const seamShare = +(flag('--seam') ?? 0.03);
const quality = +(flag('--quality') || 80);

const { data: raw, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = new Float32Array(W * H * 3);
for (let i = 0; i < px.length; i++) px[i] = raw[i];

closeSeam(px, W, H, Math.round(W * seamShare));
const horizonRow = flag('--horizon') != null ? Math.round(+flag('--horizon') * H) : findHorizon(px, W, H);
const degPerPx = 360 / W;   // the strip's scale along the horizon, kept up the sky
const [BAND_LO, BAND_HI] = SKY_BAND;

// the sun, in the source
let sun = null;
if (flag('--sun-az') != null) sun = { azDeg: +flag('--sun-az'), altDeg: +flag('--sun-alt') };
else {
  let u, v;
  if (flag('--sun')) [u, v] = flag('--sun').split(',').map(Number);
  else if (!args.includes('--no-sun')) ({ u, v } = findSun(px, W, H, horizonRow));
  if (u != null) sun = { azDeg: (((u - front) * 360) % 360 + 360) % 360, altDeg: (horizonRow - v * H) * degPerPx };
}

// the strip's own top and bottom colours: what lies past its edges
const rowMean = (y0, y1) => {
  const m = [0, 0, 0]; let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = 0; x < W; x += 4) { const o = (y * W + x) * 3; m[0] += px[o]; m[1] += px[o + 1]; m[2] += px[o + 2]; n++; }
  return m.map((c) => c / Math.max(1, n));
};
// (the darkest quarter of the top rows: open sky, not the clouds the strip cuts through)
const topSky = (() => {
  const rows = Math.max(4, Math.round(H * 0.03)), cols = [];
  for (let x = 0; x < W; x += 8) { let r = 0, g = 0, b = 0; for (let y = 0; y < rows; y++) { const o = (y * W + x) * 3; r += px[o]; g += px[o + 1]; b += px[o + 2]; } cols.push([r / rows, g / rows, b / rows]); }
  cols.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const keep = cols.slice(0, Math.max(1, cols.length >> 2)), m = [0, 0, 0];
  for (const c of keep) { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }
  return m.map((c) => c / keep.length);
})();
const bottom = rowMean(H - Math.round(H * 0.03), H);
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const out = Buffer.alloc(OUT_W * OUT_H * 3);
const shift = (front - 0.5) * W;   // source column that lands on the output's first column
const topEl = horizonRow * degPerPx, botEl = -(H - 1 - horizonRow) * degPerPx;
for (let j = 0; j < OUT_H; j++) {
  const el = BAND_HI - ((j + 0.5) / OUT_H) * (BAND_HI - BAND_LO);
  const sy = horizonRow - el / degPerPx;
  const y0 = Math.min(H - 1, Math.max(0, Math.floor(sy))), y1 = Math.min(H - 1, y0 + 1), fy = Math.min(1, Math.max(0, sy - y0));
  // fade to the zenith colour over the strip's last 9 degrees, and past -11 to the bottom's
  const kTop = smooth(topEl - 9, topEl - 0.5, el), kBot = 1 - smooth(Math.max(botEl, BAND_LO) + 0.3, Math.max(botEl, BAND_LO) + 3.5, el);
  for (let i = 0; i < OUT_W; i++) {
    const sx = (((i + 0.5) / OUT_W) * W + shift) % W;
    const x0 = Math.floor((sx + W) % W), x1 = (x0 + 1) % W, fx = sx - Math.floor(sx);
    const o = (j * OUT_W + i) * 3;
    for (let c = 0; c < 3; c++) {
      const a = px[(y0 * W + x0) * 3 + c] * (1 - fx) + px[(y0 * W + x1) * 3 + c] * fx;
      const b = px[(y1 * W + x0) * 3 + c] * (1 - fx) + px[(y1 * W + x1) * 3 + c] * fx;
      let v = a * (1 - fy) + b * fy;
      v += (topSky[c] - v) * kTop;
      v += (bottom[c] - v) * kBot;
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

// colours the game lights and hazes with (linear, from the finished band)
const rowOf = (el) => Math.min(OUT_H - 1, Math.max(0, Math.round(((BAND_HI - el) / (BAND_HI - BAND_LO)) * OUT_H)));
const meanLinear = (j0, j1, i0, i1) => {
  const m = [0, 0, 0]; let n = 0;
  for (let j = j0; j < j1; j += 2) for (let i = i0; i < i1; i += 4) { const o = (j * OUT_W + ((i + OUT_W) % OUT_W)) * 3; m[0] += srgb8ToLinear(out[o]); m[1] += srgb8ToLinear(out[o + 1]); m[2] += srgb8ToLinear(out[o + 2]); n++; }
  return m.map((c) => c / Math.max(1, n));
};
const SECTORS = 16;
const haze = [];
for (let s = 0; s < SECTORS; s++) {
  // sector s is centred on azimuth s * 22.5 degrees; north is the centre column
  const c = ((s / SECTORS) + 0.5) * OUT_W, half = OUT_W / SECTORS / 2;
  haze.push(hex(meanLinear(rowOf(5), rowOf(0.6), Math.round(c - half), Math.round(c + half)).map(linearToSrgb8)));
}
const all = meanLinear(rowOf(5), rowOf(0.6), 0, OUT_W);
const zenith = meanLinear(0, rowOf(68), 0, OUT_W);
const ground = meanLinear(rowOf(-2), rowOf(-9), 0, OUT_W);
const skyMean = meanLinear(rowOf(70), rowOf(1), 0, OUT_W);
let sunColor = null;
if (sun) {
  const i = Math.round(((sun.azDeg / 360 + 0.5) % 1) * OUT_W), j = rowOf(sun.altDeg), r = Math.round(OUT_W * 0.012);
  sunColor = hex(meanLinear(Math.max(0, j - r), Math.min(OUT_H, j + r), i - r, i + r).map(linearToSrgb8));
}

fs.mkdirSync(path.join(envDir, 'sky'), { recursive: true });
const file = `sky/${id}.webp`;
const buf = await sharp(out, { raw: { width: OUT_W, height: OUT_H, channels: 3 } }).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
fs.writeFileSync(path.join(envDir, file), buf);

const manifestFile = path.join(envDir, 'manifest.json');
let manifest = { format: 1, skies: {}, textures: {} };
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) { /* first sky */ }
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
let prompt = null;
if (flag('--prompt-file')) try { prompt = fs.readFileSync(flag('--prompt-file'), 'utf8').trim(); } catch (_) { /* none */ }
manifest.skies[id] = {
  file, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  width: OUT_W, height: OUT_H, band: SKY_BAND,
  sun: sun ? { azDeg: round(sun.azDeg, 1), altDeg: round(sun.altDeg, 1), color: sunColor } : null,
  haze, horizon: hex(all.map(linearToSrgb8)), zenith: hex(zenith.map(linearToSrgb8)), ground: hex(ground.map(linearToSrgb8)),
  luma: round(0.2126 * skyMean[0] + 0.7152 * skyMean[1] + 0.0722 * skyMean[2], 4),
  source: {
    made: 'generated for Sim Clash (original; no third-party image)', model: flag('--model') || 'nano_banana_2_1', job: flag('--job') || null,
    front: round(front, 3), horizonRow: round(horizonRow / H, 4), strip: [W, H], ...(flag('--note') ? { note: flag('--note') } : {}), ...(prompt ? { prompt } : {}),
  },
};
manifest.skies = Object.fromEntries(Object.entries(manifest.skies).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${id}: ${file} ${(buf.length / 1048576).toFixed(2)} MB, horizon at ${(horizonRow / H).toFixed(3)} of the strip, sun ${sun ? `az ${sun.azDeg.toFixed(1)} alt ${sun.altDeg.toFixed(1)}` : 'none'}, haze ${manifest.skies[id].horizon}, zenith ${manifest.skies[id].zenith}`);
