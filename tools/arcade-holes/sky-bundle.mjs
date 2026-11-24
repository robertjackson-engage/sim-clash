#!/usr/bin/env node
// Bundle the sky photos the arcade stages are lit by (lib/sky-bundle.js installs them into
// the data dir on boot; the game itself never downloads anything):
//
//   node tools/arcade-holes/sky-bundle.mjs [--out <dir>] [--soft] [--no-fetch] [--check]
//     --out        bundle dir (default <repo>/build/arcade-data); run bundle.mjs first
//     --soft       a sky that cannot be had is a warning, not an error (npm start: the game
//                  then shows its midday sky on those stages). A release build runs without it.
//     --no-fetch   never download: only the copies already on this machine
//     --check      exit 1 unless the bundle on disk is complete; writes nothing
//
// Which files: asked of the look itself, per bundled course (sky-files.mjs). Where each comes
// from, in this order, every candidate checked against its pinned SHA-256:
//   1. the bundle dir (already there from an earlier run);
//   2. the local data dir's sky-cache (BIRDIE_DATA_DIR or <repo>/data), where the simulator
//      keeps the skies it has downloaded;
//   3. Poly Haven (the same address lib/sky-cache.js uses), once, into the bundle dir.
// Writes <out>/sky/<file> and <out>/sky.json:
//   { format, complete, files: [{ file, sha256, bytes, preset, title, authors, page, licence, stages }] }
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKY_SOURCES, POLY_HAVEN_HDR_4K, neededSkyFiles } from './sky-files.mjs';

const require = createRequire(import.meta.url);
const { sha256, readBundle } = require('../../lib/arcade-bundle.js');
const { SKY_MANIFEST, SKY_DIR, SKY_FORMAT, readSkyBundle } = require('../../lib/sky-bundle.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outDir = path.resolve(flag('--out') || path.join(repo, 'build', 'arcade-data'));
const soft = args.includes('--soft');
const noFetch = args.includes('--no-fetch');
const check = args.includes('--check');
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

const stages = readBundle(outDir);
if (!stages) {
  console.error(`No arcade bundle in ${outDir}: run npm run prepare:arcade-data first.`);
  process.exit(soft ? 0 : 1);
}
const courses = stages.courses.map((c) => JSON.parse(fs.readFileSync(path.join(outDir, 'courses', c.file), 'utf8')));
const needed = neededSkyFiles(courses);
const unpinned = needed.filter((n) => !SKY_SOURCES[n.file]);
if (unpinned.length) {
  for (const n of unpinned) console.error(`FAILED  ${n.file} (${n.stages.join(', ')}) has no row in tools/arcade-holes/sky-files.mjs: add its source and checksum`);
  process.exit(1);
}

const skyDir = path.join(outDir, SKY_DIR);
const good = (file, name) => {
  const src = SKY_SOURCES[name];
  try {
    if (fs.statSync(file).size !== src.bytes) return false;
    return sha256(fs.readFileSync(file)) === src.sha256;
  } catch (_) { return false; }
};

if (check) {
  const manifest = readSkyBundle(outDir);
  const ok = !!manifest && manifest.complete === true
    && needed.length === manifest.files.length
    && needed.every((n) => manifest.files.some((f) => f.file === n.file && f.sha256 === SKY_SOURCES[n.file].sha256) && good(path.join(skyDir, n.file), n.file));
  console.log(ok ? `Sky bundle is complete (${needed.length} sky photos).` : 'Sky bundle is missing or incomplete: run npm run prepare:sky');
  process.exit(ok ? 0 : 1);
}

async function download(name, dest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('the download took too long')), 180000);
  try {
    const res = await fetch(POLY_HAVEN_HDR_4K + name, { signal: controller.signal });
    if (!res.ok) throw new Error(`Poly Haven answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== SKY_SOURCES[name].bytes || sha256(buf) !== SKY_SOURCES[name].sha256) throw new Error('the downloaded file does not match its pinned checksum');
    fs.writeFileSync(`${dest}.part`, buf);
    fs.renameSync(`${dest}.part`, dest);
  } finally {
    clearTimeout(timer);
    fs.rmSync(`${dest}.part`, { force: true });
  }
}

fs.mkdirSync(skyDir, { recursive: true });
const localCache = path.join(path.resolve(process.env.BIRDIE_DATA_DIR || path.join(repo, 'data')), 'sky-cache');
const have = [];
const missing = [];
for (const n of needed) {
  const dest = path.join(skyDir, n.file);
  let from = null;
  if (good(dest, n.file)) from = 'bundle';
  else if (good(path.join(localCache, n.file), n.file)) { fs.copyFileSync(path.join(localCache, n.file), dest); from = 'the local sky cache'; }
  else if (!noFetch) {
    try { console.log(`  fetching ${n.file} from Poly Haven (${mb(SKY_SOURCES[n.file].bytes)}, CC0)...`); await download(n.file, dest); from = 'Poly Haven'; }
    catch (error) { console.warn(`  ${n.file}: ${error.message}`); }
  }
  if (from) have.push({ ...n, from }); else missing.push(n);
}
// only our own output dir: a sky no stage uses any more does not ship
for (const f of fs.readdirSync(skyDir)) if (!have.some((h) => h.file === f)) fs.rmSync(path.join(skyDir, f), { force: true });

const manifest = {
  format: SKY_FORMAT,
  complete: missing.length === 0,
  files: have.map((h) => {
    const s = SKY_SOURCES[h.file];
    return { file: h.file, sha256: s.sha256, bytes: s.bytes, preset: s.preset, title: s.title, authors: s.authors, page: s.page, licence: s.licence, stages: h.stages };
  }),
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestFile = path.join(outDir, SKY_MANIFEST);
let before = null;
try { before = fs.readFileSync(manifestFile, 'utf8'); } catch (_) { /* first run */ }
if (before !== text) fs.writeFileSync(manifestFile, text);

const bytes = have.reduce((n, h) => n + SKY_SOURCES[h.file].bytes, 0);
console.log(`Sky bundle: ${have.length} of ${needed.length} sky photos, ${mb(bytes)}${have.length ? ` (${have.map((h) => `${h.file.replace(/_4k\.hdr$/, '')}: ${h.stages.length} stages, from ${h.from}`).join('; ')})` : ''}`);
if (missing.length) {
  const what = missing.map((m) => `${m.file} (${m.stages.join(', ')})`).join('; ');
  if (soft) console.warn(`  not bundled: ${what}. Those stages will show the midday sky until npm run prepare:sky succeeds.`);
  else { console.error(`FAILED  could not get ${what}. A release does not ship without its skies.`); process.exit(1); }
}
