// public/arcade/sfx/manifest.json is rebuilt from the mp3s that are actually on disk, the
// same way whoever put them there (the ElevenLabs generator or the free-library importer):
//
//   <cue>.mp3, <cue>-2.mp3, <cue>-3.mp3 ...       the takes (one is picked at random)
//   <cue>-hard.mp3, <cue>-hard-2.mp3 ...          takes for a hard hit (cue intensity 0.78 and up)
//
// Only names that audio.js knows as cues are listed (plus stage-sting-<theme>), so a stray
// file can never turn into a cue. An alias (roar -> crowd-roar) reuses another cue's takes
// unless a file of its own name exists.

import fs from 'node:fs';
import path from 'node:path';
import { CUE_NAMES } from '../../public/arcade/audio.js';
import { SFX_ALIASES } from './lines.mjs';
import { cueOfFile, IMPORTS } from './sources.mjs';

const isCue = (name) => CUE_NAMES.includes(name) || /^stage-sting-[a-z]+$/.test(name);

/** Scan a folder of effect mp3s: { cues: { name: { files, hard? } }, stray: [files] }. */
export function scanSfx(dir) {
  const cues = {};
  const stray = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort(); } catch (_) { /* no folder yet */ }
  for (const f of files) {
    const c = cueOfFile(f);
    // 'crowd-roar-2' reads as cue 'crowd-roar' take 2; a cue whose own name ends in a digit does not exist
    if (!c || !isCue(c.cue)) { stray.push(f); continue; }
    const e = cues[c.cue] || (cues[c.cue] = { files: [], hard: [] });
    (c.hard ? e.hard : e.files).push({ f, take: c.take });
  }
  for (const [name, e] of Object.entries(cues)) {
    const order = (a) => a.sort((x, y) => x.take - y.take).map((x) => x.f);
    const out = { files: order(e.files) };
    const hard = order(e.hard);
    if (hard.length) out.hard = hard;
    if (!out.files.length) { out.files = hard; delete out.hard; }   // only hard takes: they are the takes
    cues[name] = out;
  }
  return { cues, stray };
}

/** Write manifest.json for a folder of effects. Returns the manifest (null when the folder has none). */
export function writeSfxManifest(dir, format) {
  const { cues, stray } = scanSfx(dir);
  if (!Object.keys(cues).length) return null;
  const manifest = { version: 2, format, cues: {} };
  for (const name of Object.keys(cues).sort()) {
    manifest.cues[name] = cues[name];
    // a swell says where its peak is (seconds from the start of the file): audio.anticipate() lands it on the moment
    const spec = IMPORTS.find((s) => s.file === cues[name].files[0]);
    if (spec && spec.peakS) manifest.cues[name].peakS = spec.peakS;
  }
  for (const [alias, target] of Object.entries(SFX_ALIASES)) {
    if (!manifest.cues[alias] && manifest.cues[target]) manifest.cues[alias] = { ...manifest.cues[target], alias: target };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, stray };
}
