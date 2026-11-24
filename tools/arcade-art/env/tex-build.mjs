#!/usr/bin/env node
// Turn a generated picture of a surface into a ground material set (docs/arcade-look.md,
// "The ground of a stage"):
//
//   node tools/arcade-art/env/tex-build.mjs --id grass --src <picture.png> [--size 1024]
//        [--strength 2.4] [--band 0.18] [--tile-m 2.2] [--job <id>] [--prompt-file <txt>]
//
// The source is a top-down (or, for rock, face-on) picture that fills its frame. This tool:
//   1. crops it square and scales it to --size;
//   2. makes it TILE: its edges are cross-faded with the picture shifted half its size
//      (lib.mjs makeTileable), and the step left across each wrap is measured and written
//      to the manifest (test/env-art.test.mjs holds every set under a limit);
//   3. derives a HEIGHT from its light and shade (band-passed luminance), a NORMAL map from
//      that height, and a ROUGHNESS (hollows rougher than tops);
//   4. stores the colour as DETAIL: each texel over the picture's mean colour, halved, so
//      0.5 grey is "the palette's colour as it is". The game multiplies a theme's own colour
//      by it, which is how one rock serves red canyon walls and black volcano cliffs;
//   5. writes public/arcade/env/tex/<id>_c.webp (rgb detail, alpha height) and
//      <id>_n.webp (rg normal, b roughness), and the set's row in manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeTileable, tileError, heightFromColor, normalFromHeight, hex } from './lib.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.join(here, '..', '..', '..', 'public', 'arcade', 'env');
const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const id = flag('--id'), src = flag('--src');
if (!id || !/^[a-z0-9-]+$/.test(id) || !src) { console.error('usage: tex-build.mjs --id <name> --src <picture>'); process.exit(1); }
const N = +(flag('--size') || 1024);
const strength = +(flag('--strength') || 2.4);

const meta = await sharp(src).metadata();
const side = Math.min(meta.width, meta.height);
const { data: raw } = await sharp(src).removeAlpha()
  .extract({ left: Math.floor((meta.width - side) / 2), top: Math.floor((meta.height - side) / 2), width: side, height: side })
  .resize(N, N, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
const px = new Float32Array(N * N * 3);
for (let i = 0; i < px.length; i++) px[i] = raw[i];
const before = tileError(px, N);
makeTileable(px, N, 3, +(flag('--band') || 0.18));
const after = tileError(px, N);

const mean = [0, 0, 0];
for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) mean[c] += px[i * 3 + c];
for (let c = 0; c < 3; c++) mean[c] /= N * N;
const h = heightFromColor(px, N);
const nrm = normalFromHeight(h, N, strength);

const colour = Buffer.alloc(N * N * 4), normal = Buffer.alloc(N * N * 4);
for (let i = 0; i < N * N; i++) {
  for (let c = 0; c < 3; c++) colour[i * 4 + c] = Math.max(0, Math.min(255, Math.round((px[i * 3 + c] / Math.max(1, mean[c])) * 127.5)));
  colour[i * 4 + 3] = Math.round(h[i] * 255);
  normal[i * 4] = nrm[i * 3]; normal[i * 4 + 1] = nrm[i * 3 + 1];
  normal[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.95 - 0.35 * h[i])));   // roughness: the tops a little smoother
  normal[i * 4 + 3] = 255;
}
fs.mkdirSync(path.join(envDir, 'tex'), { recursive: true });
const cBuf = await sharp(colour, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: +(flag('--quality') || 74), alphaQuality: 55, effort: 6 }).toBuffer();
const nBuf = await sharp(normal, { raw: { width: N, height: N, channels: 4 } }).removeAlpha().webp({ quality: 78, effort: 6 }).toBuffer();
fs.writeFileSync(path.join(envDir, `tex/${id}_c.webp`), cBuf);
fs.writeFileSync(path.join(envDir, `tex/${id}_n.webp`), nBuf);

const manifestFile = path.join(envDir, 'manifest.json');
let manifest = { format: 1, skies: {}, textures: {} };
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) { /* first */ }
manifest.textures = manifest.textures || {};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let prompt = null;
if (flag('--prompt-file')) try { prompt = fs.readFileSync(flag('--prompt-file'), 'utf8').trim(); } catch (_) { /* none */ }
manifest.textures[id] = {
  color: { file: `tex/${id}_c.webp`, bytes: cBuf.length, sha256: sha(cBuf) },
  normal: { file: `tex/${id}_n.webp`, bytes: nBuf.length, sha256: sha(nBuf) },
  size: N, tileM: +(flag('--tile-m') || 2.2), mean: hex(mean), tileError: Math.round(after * 1e4) / 1e4,
  source: { made: 'generated for Sim Clash (original; no third-party image)', model: flag('--model') || 'nano_banana_2_1', job: flag('--job') || null, ...(prompt ? { prompt } : {}) },
};
manifest.textures = Object.fromEntries(Object.entries(manifest.textures).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${id}: ${((cBuf.length + nBuf.length) / 1024).toFixed(0)} KB, mean ${hex(mean)}, wrap step ${before.toFixed(4)} -> ${after.toFixed(4)}`);
