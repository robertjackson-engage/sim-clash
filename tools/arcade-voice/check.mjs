#!/usr/bin/env node
// Machine check of the rendered announcer packs and sound effects. Nobody can listen from
// here, so this measures what can be measured:
//
//   every file decodes · its spoken length is sane for its text · no long silence at either
//   end · the tail ends clean · loudness is consistent across the pack · nothing clips ·
//   the manifest and the files on disk agree · every line of the catalogue is there
//
//   node tools/arcade-voice/check.mjs                    all packs found + the sfx
//   node tools/arcade-voice/check.mjs --pack announcer   one pack
//   node tools/arcade-voice/check.mjs --sfx              only the sound effects
//   node tools/arcade-voice/check.mjs --all              print every file, not just the outliers
//   node tools/arcade-voice/check.mjs --json out.json    the numbers, for a report
//   node tools/arcade-voice/check.mjs --transcribe       ALSO send each announcer clip back through
//                                                        speech-to-text and compare the words with
//                                                        the line (catches stray speech; needs the key,
//                                                        uses a little speech-to-text quota)
//   --dir <dir>  check a tree other than public/arcade (the tests use this)
//
// Exit code 1 when a file FAILS (undecodable, clipped, silent, wildly long or short, missing).
// A WARN is something a human should listen to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, SFX, SFX_ALIASES, NEW_SFX_CUES, PHYSICAL_SFX_CUES, FEEL_SFX_CUES, durationBounds, sfxFiles, compareWords } from './lines.mjs';
import { decodeMp3, mp3Info, measure, gaps } from './dsp.mjs';
import { IMPORTS } from './sources.mjs';
import { SAMPLE_CUE_NAMES } from '../../public/arcade/audio.js';
import { VOICE_FORMAT, SFX_FORMAT } from './generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// contract limits (docs/dev/arcade-v2-contract.md section 3), seconds
const SFX_LIMITS = { drumroll: 3, 'fanfare-win': 6, 'fanfare-hole': 3, riser: 2.5 };
const LIMITS = {
  leadMs: 60,        // silence before the sound (about 25 ms of it is the mp3 codec's own delay)
  tailMs: 260,       // silence after it
  endDb: -36,        // the last 10 ms must be this quiet: a clean tail, no cut-off
  peakDb: -0.3,      // true clipping guard
  lufsSpread: 1.5,   // announcer takes must sit within this of the pack median
  sfxLufsSpread: 3,  // effects are short and odd-shaped: a wider window round the target
  holeMs: 450,       // a silent hole this long inside a shout: listen to it
};

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };

async function checkVoicePack(dir, pack, opts) {
  const out = { pack, files: [], fails: [], warns: [], summary: null };
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest) { out.fails.push('manifest.json is missing or unreadable'); return out; }
  if (manifest.pack !== pack) out.fails.push(`manifest.pack is "${manifest.pack}"`);
  const onDisk = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')));
  const listed = new Set();
  const byId = new Map(LINES.map((l) => [l.id, l]));

  for (const l of LINES) {
    if (!manifest.lines[l.id]) out.fails.push(`line ${l.id} is not in the manifest`);
    else if (manifest.lines[l.id].files.length < 2) out.warns.push(`line ${l.id} has only ${manifest.lines[l.id].files.length} take`);
  }
  let client = null;
  if (opts.transcribe) client = (await import('./eleven.mjs')).createClient({ concurrency: 2 });

  for (const [id, entry] of Object.entries(manifest.lines)) {
    const l = byId.get(id);
    if (!l) { out.fails.push(`manifest line ${id} is not in the catalogue`); continue; }
    if (entry.text !== l.text) out.fails.push(`${id}: manifest text "${entry.text}" is not "${l.text}"`);
    for (const f of entry.files) {
      listed.add(f);
      const row = { file: f, id, text: l.text, fail: [], warn: [] };
      out.files.push(row);
      if (!onDisk.has(f)) { row.fail.push('file is missing'); continue; }
      const bytes = fs.readFileSync(path.join(dir, f));
      row.bytes = bytes.length;
      let clip;
      try { clip = await decodeMp3(bytes); } catch (err) { row.fail.push(`does not decode (${err.message})`); continue; }
      const m = measure(clip);
      Object.assign(row, { durationS: m.durationS, activeS: m.activeS, lufs: m.lufs, peakDb: m.peakDb, leadMs: m.leadMs, tailMs: m.tailMs, endDb: m.endDb, channels: m.channels, sampleRate: m.sampleRate });
      const { minS, maxS } = durationBounds(l);
      if (clip.errors) row.warn.push(`${clip.errors} decoder error(s)`);
      if (m.silent) row.fail.push('silent');
      if (m.clipped || m.peakDb > LIMITS.peakDb) row.fail.push(`clips (peak ${fmt(m.peakDb, 1)} dBFS)`);
      if (m.activeS < minS * 0.8) row.fail.push(`far too short: ${fmt(m.activeS)} s (sane ${fmt(minS)} to ${fmt(maxS)})`);
      else if (m.activeS < minS) row.warn.push(`short: ${fmt(m.activeS)} s (sane from ${fmt(minS)})`);
      if (m.activeS > maxS * 1.5) row.fail.push(`far too long: ${fmt(m.activeS)} s (sane ${fmt(minS)} to ${fmt(maxS)})`);
      else if (m.activeS > maxS) row.warn.push(`long: ${fmt(m.activeS)} s (sane up to ${fmt(maxS)})`);
      if (m.leadMs > LIMITS.leadMs) row.warn.push(`${fmt(m.leadMs, 0)} ms of silence before the voice`);
      if (m.tailMs > LIMITS.tailMs) row.warn.push(`${fmt(m.tailMs, 0)} ms of silence after it`);
      if (m.endDb > LIMITS.endDb) row.warn.push(`the tail is cut off (last 10 ms at ${fmt(m.endDb, 0)} dB)`);
      for (const h of gaps(clip, { minMs: LIMITS.holeMs })) row.warn.push(`a ${fmt(h.lengthS)} s hole at ${fmt(h.atS)} s (stray speech?)`);
      if (client) {
        try {
          row.transcript = await client.transcribe(bytes);
          const cmp = compareWords(row.transcript, l.text);
          if (!cmp.ok) row.warn.push(`heard "${row.transcript.trim()}"${cmp.extra.length ? ` (extra: ${cmp.extra.join(' ')})` : ''}${cmp.missing.length ? ` (missing: ${cmp.missing.join(' ')})` : ''}`);
        } catch (err) { row.warn.push(`not transcribed (${err.message})`); }
      }
    }
  }
  for (const f of onDisk) if (!listed.has(f)) out.fails.push(`${f} is on disk but not in the manifest`);

  const good = out.files.filter((r) => Number.isFinite(r.lufs));
  const med = median(good.map((r) => r.lufs));
  for (const r of good) {
    if (Math.abs(r.lufs - med) > LIMITS.lufsSpread) r.warn.push(`loudness ${fmt(r.lufs, 1)} LUFS is ${fmt(Math.abs(r.lufs - med), 1)} away from the pack (${fmt(med, 1)})`);
  }
  const num = (k) => good.map((r) => r[k]);
  out.summary = {
    voice: manifest.voice, lines: Object.keys(manifest.lines).length, catalogue: LINES.length, files: out.files.length,
    bytes: out.files.reduce((s, r) => s + (r.bytes || 0), 0),
    activeS: { min: Math.min(...num('activeS')), median: median(num('activeS')), max: Math.max(...num('activeS')) },
    lufs: { min: Math.min(...num('lufs')), median: med, max: Math.max(...num('lufs')), target: VOICE_FORMAT.lufs },
    peakDb: { max: Math.max(...num('peakDb')) },
    leadMs: { max: Math.max(...num('leadMs')) },
    tailMs: { max: Math.max(...num('tailMs')) },
  };
  return out;
}

async function checkSfx(dir, opts) {
  const out = { pack: 'sfx', files: [], fails: [], warns: [], summary: null };
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest) { out.fails.push('sfx/manifest.json is missing or unreadable'); return out; }
  // what each file was built to: the free-library importer's entry for the file, else the generator's for the cue
  const specs = new Map(SFX.map((s) => [s.cue, s]));
  const imported = new Map(IMPORTS.map((s) => [s.file, s]));
  for (const cue of NEW_SFX_CUES) if (!manifest.cues[cue]) (SAMPLE_CUE_NAMES.includes(cue) ? out.fails : out.warns).push(`cue ${cue} is not in the manifest${SAMPLE_CUE_NAMES.includes(cue) ? ' (it is silent)' : ' (the synth plays instead)'}`);
  // every other cue with no synthesizer (gadgets, the living world, Bullseye, the duel, replays): no file, no sound
  for (const cue of SAMPLE_CUE_NAMES) if (!NEW_SFX_CUES.includes(cue) && !manifest.cues[cue]) out.fails.push(`cue ${cue} is not in the manifest (it is silent)`);
  // the physical and game-feel cues have a synthesized stand-in, so a missing one is a warning
  for (const cue of [...PHYSICAL_SFX_CUES, ...FEEL_SFX_CUES]) if (!manifest.cues[cue]) out.warns.push(`cue ${cue} is not in the manifest (the synth plays instead)`);
  for (const [alias, target] of Object.entries(SFX_ALIASES)) {
    if (manifest.cues[alias] && manifest.cues[alias].alias !== target) out.warns.push(`cue ${alias} is not the alias of ${target}`);
  }
  const seen = new Set();
  for (const [cue, entry] of Object.entries(manifest.cues)) {
    if (entry.alias) continue;
    for (const f of [...entry.files, ...(entry.hard || [])]) {
      const spec = imported.get(f) || specs.get(cue) || {};
      if (seen.has(f)) continue;
      seen.add(f);
      const row = { file: f, id: cue, fail: [], warn: [] };
      out.files.push(row);
      const full = path.join(dir, f);
      if (!fs.existsSync(full)) { row.fail.push('file is missing'); continue; }
      const bytes = fs.readFileSync(full);
      row.bytes = bytes.length;
      let clip;
      try { clip = await decodeMp3(bytes); } catch (err) { row.fail.push(`does not decode (${err.message})`); continue; }
      const m = measure(clip);
      Object.assign(row, { durationS: m.durationS, activeS: m.activeS, lufs: m.lufs, peakDb: m.peakDb, leadMs: m.leadMs, tailMs: m.tailMs, endDb: m.endDb, channels: m.channels, sampleRate: m.sampleRate });
      const limit = SFX_LIMITS[cue];
      if (m.silent) row.fail.push('silent');
      if (m.clipped || m.peakDb > LIMITS.peakDb) row.fail.push(`clips (peak ${fmt(m.peakDb, 1)} dBFS)`);
      if (limit && m.durationS >= limit) row.fail.push(`${fmt(m.durationS)} s: the contract wants under ${limit} s`);
      if (spec.keepS && m.durationS > spec.keepS + 0.12) row.warn.push(`${fmt(m.durationS)} s is longer than its ${spec.keepS} s`);
      if (m.durationS > 6) row.fail.push(`${fmt(m.durationS)} s: far too long for a one-shot`);
      // (a swell of anticipation rises out of nothing by design: its quiet start is not a late start)
      if (!spec.peakS && m.leadMs > 90) row.warn.push(`${fmt(m.leadMs, 0)} ms of silence before the sound`);
      row.swell = !!spec.peakS;
      if (m.endDb > LIMITS.endDb) row.warn.push(`the tail is cut off (last 10 ms at ${fmt(m.endDb, 0)} dB)`);
      const target = spec.lufs ?? SFX_FORMAT.lufs;
      row.targetLufs = target;
      // a click or a strike is over before a loudness meter has settled: those are judged by their peak
      // and a peaky sound (a knock, a strike) is held by the peak ceiling before it reaches its loudness target: that is right
      const peakHeld = m.peakDb >= SFX_FORMAT.peakDb - 1.2 && m.lufs < target;
      row.peakHeld = peakHeld;
      if (m.durationS >= 0.4 && !peakHeld && Math.abs(m.lufs - target) > LIMITS.sfxLufsSpread) row.warn.push(`loudness ${fmt(m.lufs, 1)} LUFS (target ${target})`);
    }
  }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
    // a file dropped in by hand for an old cue name is the documented override: fine
    if (!seen.has(f)) out.warns.push(`${f} is on disk but not in the manifest (a hand-placed override?)`);
  }
  const good = out.files.filter((r) => Number.isFinite(r.lufs));
  const num = (k) => good.map((r) => r[k]);
  out.summary = {
    cues: Object.keys(manifest.cues).length, files: out.files.length,
    bytes: out.files.reduce((s, r) => s + (r.bytes || 0), 0),
    durationS: { min: Math.min(...num('durationS')), max: Math.max(...num('durationS')) },
    lufs: { min: Math.min(...num('lufs')), median: median(num('lufs')), max: Math.max(...num('lufs')), target: SFX_FORMAT.lufs },
    peakDb: { max: Math.max(...num('peakDb')) },
    leadMs: { max: Math.max(...good.filter((r) => !r.swell).map((r) => r.leadMs)) },
    offTarget: { max: Math.max(0, ...good.filter((r) => r.durationS >= 0.4 && !r.peakHeld).map((r) => Math.abs(r.lufs - r.targetLufs))) },
  };
  return out;
}

function print(result, all) {
  const s = result.summary;
  console.log(`\n== ${result.pack} ==`);
  if (s && result.pack !== 'sfx') {
    console.log(`  voice ${s.voice ? `${s.voice.name} (${s.voice.id}), ${s.voice.model}` : '?'}: ${s.lines} of ${s.catalogue} lines, ${s.files} files, ${fmt(s.bytes / 1048576)} MB`);
    console.log(`  spoken length  ${fmt(s.activeS.min)} to ${fmt(s.activeS.max)} s (median ${fmt(s.activeS.median)})`);
    console.log(`  loudness       ${fmt(s.lufs.min, 1)} to ${fmt(s.lufs.max, 1)} LUFS (median ${fmt(s.lufs.median, 1)}, target ${s.lufs.target})`);
    console.log(`  loudest peak   ${fmt(s.peakDb.max, 1)} dBFS      lead silence up to ${fmt(s.leadMs.max, 0)} ms, tail up to ${fmt(s.tailMs.max, 0)} ms`);
  } else if (s) {
    console.log(`  ${s.cues} cues, ${s.files} files, ${fmt(s.bytes / 1048576)} MB`);
    console.log(`  length         ${fmt(s.durationS.min)} to ${fmt(s.durationS.max)} s`);
    console.log(`  loudness       ${fmt(s.lufs.min, 1)} to ${fmt(s.lufs.max, 1)} LUFS (median ${fmt(s.lufs.median, 1)}, target ${s.lufs.target})`);
    console.log(`  loudest peak   ${fmt(s.peakDb.max, 1)} dBFS      lead silence up to ${fmt(s.leadMs.max, 0)} ms      furthest from its loudness target ${fmt(s.offTarget.max, 1)} LU`);
  }
  for (const f of result.fails) console.log(`  FAIL  ${f}`);
  for (const w of result.warns) console.log(`  WARN  ${w}`);
  for (const r of result.files) {
    const show = all || r.fail.length || r.warn.length;
    if (!show) continue;
    const nums = Number.isFinite(r.lufs) ? `${fmt(r.activeS ?? r.durationS)}s ${fmt(r.lufs, 1)}LUFS pk${fmt(r.peakDb, 1)} lead${fmt(r.leadMs, 0)}ms` : '';
    console.log(`  ${r.fail.length ? 'FAIL' : r.warn.length ? 'WARN' : ' ok '}  ${r.file.padEnd(30)} ${nums}  ${[...r.fail, ...r.warn].join('; ')}`);
  }
  const fails = result.fails.length + result.files.filter((r) => r.fail.length).length;
  const warns = result.warns.length + result.files.filter((r) => !r.fail.length && r.warn.length).length;
  console.log(`  ${fails} fail, ${warns} warn, ${result.files.filter((r) => !r.fail.length && !r.warn.length).length} clean`);
  return fails;
}

/** Check a tree (default public/arcade). Returns [{ pack, files, fails, warns, summary }]. */
export async function checkAll({ dir = path.join(REPO, 'public', 'arcade'), pack = null, sfx = true, voice = true, transcribe = false } = {}) {
  const results = [];
  if (voice) {
    const voiceDir = path.join(dir, 'voice');
    let packs = [];
    try { packs = fs.readdirSync(voiceDir).filter((p) => fs.existsSync(path.join(voiceDir, p, 'manifest.json'))); } catch (_) { /* none */ }
    if (pack) packs = [pack];
    for (const p of packs) results.push(await checkVoicePack(path.join(voiceDir, p), p, { transcribe }));
    if (!packs.length) results.push({ pack: '(voice)', files: [], fails: ['no announcer pack has been rendered yet (public/arcade/voice/<pack>/manifest.json)'], warns: [], summary: null });
  }
  if (sfx) results.push(await checkSfx(path.join(dir, 'sfx'), {}));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { dir: undefined, pack: null, sfx: true, voice: true, transcribe: false, all: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--pack') { opt.pack = argv[++i]; opt.sfx = false; }
    else if (v === '--sfx') opt.voice = false;
    else if (v === '--dir') opt.dir = path.resolve(argv[++i]);
    else if (v === '--transcribe') opt.transcribe = true;
    else if (v === '--all') opt.all = true;
    else if (v === '--json') opt.json = path.resolve(argv[++i]);
    else throw new Error(`unknown option ${v}`);
  }
  const results = await checkAll(opt);
  let fails = 0;
  for (const r of results) fails += print(r, opt.all);
  if (opt.json) fs.writeFileSync(opt.json, `${JSON.stringify(results, null, 2)}\n`);
  console.log(fails ? `\n${fails} FAILED` : '\nall files pass the machine check');
  process.exitCode = fails ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
