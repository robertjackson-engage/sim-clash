#!/usr/bin/env node
// Build the shipped sound effects from the free-licensed and generated sources listed in
// sources.mjs: cut, layer, fade, level and encode each one into public/arcade/sfx/, then
// rewrite manifest.json and CREDITS.md.
//
//   node tools/arcade-voice/import.mjs                    everything in sources.mjs
//   node tools/arcade-voice/import.mjs --only strike,coin-flip
//   node tools/arcade-voice/import.mjs --credits          only rewrite manifest.json and CREDITS.md
//   --downloads <dir>   where the source audio is (default .scratch/voice/downloads)
//   --out <dir>         instead of public/arcade/sfx
//
// The source audio is not in the repo (docs/arcade-voice.md, "Sources", says how to fetch
// it again). A clip whose source is missing is reported and skipped; the file already in
// public/arcade/sfx stays as it is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORTS, PACKS_KENNEY, FREESOUND, GENERATED, cueOfFile } from './sources.mjs';
import { SFX } from './lines.mjs';
import { SFX_FORMAT } from './generate.mjs';
import { writeSfxManifest } from './manifest.mjs';
import {
  decodeAny, resample, slice, fade, normalise, activeRange, encodeMp3, peak, lin, gain as applyGain,
} from './dsp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SR = SFX_FORMAT.sampleRate;

/** Where a source key lives on disk, and how to credit it. */
export function describeSource(src) {
  const [kind, rest] = [src.slice(0, 1), src.slice(2)];
  if (kind === 'k') {
    const [pack, name] = rest.split('/');
    const p = PACKS_KENNEY[pack];
    return { rel: path.join('kenney', pack, 'Audio', `${name}.ogg`), source: p.name, url: p.url, licence: 'CC0 1.0', original: `${name}.ogg`, author: 'Kenney (kenney.nl)' };
  }
  if (kind === 'f') {
    const [title, user] = FREESOUND[rest] || ['?', '?'];
    return { rel: path.join('freesound', rest, `${rest}.ogg`), source: 'freesound.org', url: `https://freesound.org/people/${user}/sounds/${rest}/`, licence: 'CC0 1.0', original: title, author: user };
  }
  if (kind === 'h') {
    return { rel: path.join('higgsfield', `${rest}.mp3`), source: 'Generated for this project (ElevenLabs Music v2.5, through a Higgsfield account)', url: '', licence: 'generated, no third-party audio', original: GENERATED[rest] || rest, author: '' };
  }
  throw new Error(`unknown source "${src}"`);
}

/** One layer of a clip as stereo 44.1 kHz, levelled to a common loudness, ready to mix. */
async function loadLayer(layer, downloads) {
  const d = describeSource(layer.src);
  const file = path.join(downloads, d.rel);
  if (!fs.existsSync(file)) throw new Error(`source missing: ${d.rel}`);
  let c = await decodeAny(fs.readFileSync(file));
  if (layer.from != null || layer.to != null) {
    c = slice(c, (layer.from || 0) * c.sr, (layer.to != null ? layer.to : c.ch[0].length / c.sr) * c.sr);
  } else {
    const r = activeRange(c, { relDb: -45 });
    if (!r.silent) c = slice(c, Math.max(0, r.start - c.sr * 0.002), r.end + c.sr * 0.03);
  }
  // rate above 1 plays it faster and higher: pretend the source was recorded at a higher rate
  c = resample({ ch: c.ch, sr: Math.round(c.sr * (layer.rate || 1)) }, SR);
  c = fade(c, { inMs: 1, outMs: layer.fadeOutMs ?? 25 });
  c = normalise(c, { targetLufs: -20, peakDb: -1, maxGainDb: 40 });
  c = applyGain(c, layer.gain ?? 1);
  if (c.ch.length === 1) c = { ch: [c.ch[0], c.ch[0]], sr: SR };
  return { clip: c, at: Math.round((layer.at || 0) * SR) };
}

/** Cut, layer, fade and level one entry of sources.mjs. Returns the finished clip. */
export async function buildClip(spec, downloads) {
  const layers = [];
  for (const l of spec.layers) layers.push(await loadLayer(l, downloads));
  const n = Math.max(...layers.map((l) => l.at + l.clip.ch[0].length));
  let mix = { ch: [new Float32Array(n), new Float32Array(n)], sr: SR };
  for (const l of layers) for (let k = 0; k < 2; k++) { const src = l.clip.ch[k]; const dst = mix.ch[k]; for (let i = 0; i < src.length; i++) dst[l.at + i] += src[i]; }
  // mono unless the channels really differ
  let diff = 0;
  for (let i = 0; i < n; i += 5) diff = Math.max(diff, Math.abs(mix.ch[0][i] - mix.ch[1][i]));
  if (diff < 1e-4 * Math.max(1e-6, peak(mix))) mix = { ch: [mix.ch[0]], sr: SR };
  // the sound starts at once: whatever silence the sources carried in front is cut
  const lead = activeRange(mix, { relDb: -38 });
  if (!spec.exact && !lead.silent && lead.start > SR * 0.004) mix = slice(mix, lead.start - SR * 0.002, n);
  // a swell climbs: `ramp` dB quieter at the start, rising evenly to full level at peakS
  if (spec.ramp && spec.peakS) {
    const top = Math.round(spec.peakS * SR);
    for (const c of mix.ch) for (let i = 0; i < Math.min(top, c.length); i++) c[i] *= lin(spec.ramp * (1 - i / top));
  }
  if (spec.keepS) mix = slice(mix, 0, spec.keepS * SR);
  const len = mix.ch[0].length / SR;
  mix = fade(mix, { inMs: spec.fadeInMs ?? 1, outMs: Math.min(spec.fadeMs ?? Math.max(15, Math.min(120, len * 250)), len * 500) });
  return normalise(mix, { targetLufs: spec.lufs ?? SFX_FORMAT.lufs, peakDb: SFX_FORMAT.peakDb, maxGainDb: 30 });
}

/** CREDITS.md: every shipped effect file and where it came from. */
export function writeCredits(outDir) {
  const bySpec = new Map(IMPORTS.map((s) => [s.file, s]));
  const generated = new Set(SFX.flatMap((s) => Array.from({ length: s.takes }, (_, i) => (i ? `${s.cue}-${i + 1}.mp3` : `${s.cue}.mp3`))));
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.mp3')).sort();
  const rows = [];
  for (const f of files) {
    const spec = bySpec.get(f);
    const cue = (cueOfFile(f) || {}).cue || '';
    if (!spec) {
      rows.push(`| \`${f}\` | \`${cue}\` | ${generated.has(f) ? 'Generated with the ElevenLabs sound-effects API (tools/arcade-voice/generate.mjs)' : 'placed by hand: not from this tool'} | | | |`);
      continue;
    }
    const parts = spec.layers.map((l) => describeSource(l.src));
    const cell = (fn) => parts.map(fn).filter((v, i, a) => v && a.indexOf(v) === i).join('<br>');
    rows.push(`| \`${f}\` | \`${cue}\` | ${cell((p) => p.source)} | ${cell((p) => p.url)} | ${cell((p) => p.licence)} | ${parts.map((p) => `${p.original}${p.author && p.source === 'freesound.org' ? ` (by ${p.author})` : ''}`).join('<br>')} |`);
  }
  const text = `# Sound effect credits

Every effect file shipped in this folder, where it came from and under what licence.
This file is written by \`node tools/arcade-voice/import.mjs\`; edit \`tools/arcade-voice/sources.mjs\`, not this.

- **Kenney** packs (kenney.nl) are Creative Commons Zero (CC0 1.0): free to use in any project, no credit required.
- **freesound.org** sounds listed here were each checked on their own page: all are Creative Commons 0 (CC0 1.0).
  The files were taken from freesound's high-quality previews, then cut, layered and levelled.
- **Generated** clips were made for this project with ElevenLabs Music v2.5 through a Higgsfield account,
  from a text prompt only (no reference audio).
- Nothing here comes from a commercial game, a film, a broadcast or a video rip.
- A file made of several sources lists each of them.

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

| File | Cue | Source | URL | Licence | Original file |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
  fs.writeFileSync(path.join(outDir, 'CREDITS.md'), text);
  return rows.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { only: null, downloads: path.join(REPO, '.scratch', 'voice', 'downloads'), out: path.join(REPO, 'public', 'arcade', 'sfx'), creditsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') opt.only = new Set(argv[++i].split(','));
    else if (argv[i] === '--downloads') opt.downloads = path.resolve(argv[++i]);
    else if (argv[i] === '--out') opt.out = path.resolve(argv[++i]);
    else if (argv[i] === '--credits') opt.creditsOnly = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  fs.mkdirSync(opt.out, { recursive: true });
  let made = 0;
  let failed = 0;
  if (!opt.creditsOnly) {
    for (const spec of IMPORTS) {
      const cue = cueOfFile(spec.file).cue;
      if (opt.only && !opt.only.has(cue) && !opt.only.has(spec.file)) continue;
      try {
        const clip = await buildClip(spec, opt.downloads);
        fs.writeFileSync(path.join(opt.out, spec.file), encodeMp3(clip, clip.ch.length === 2 ? SFX_FORMAT.kbps : 96));
        made++;
        console.log(`  ${spec.file.padEnd(24)} ${(clip.ch[0].length / SR).toFixed(2)}s ${clip.ch.length === 2 ? 'stereo' : 'mono'}  ${spec.layers.map((l) => l.src).join(' + ')}`);
      } catch (err) {
        failed++;
        console.log(`  ${spec.file.padEnd(24)} FAILED ${err.message}`);
      }
    }
  }
  const res = writeSfxManifest(opt.out, SFX_FORMAT);
  const credited = writeCredits(opt.out);
  console.log(`sfx: ${made} built, ${failed} failed; ${res ? Object.keys(res.manifest.cues).length : 0} cues in the manifest, ${credited} files in CREDITS.md`);
  if (res && res.stray.length) console.log(`  not cues (left out of the manifest): ${res.stray.join(', ')}`);
  process.exitCode = failed ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
