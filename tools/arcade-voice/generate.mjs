#!/usr/bin/env node
// Render the arcade announcer and the one-shot sound effects with ElevenLabs.
//
//   node tools/arcade-voice/generate.mjs                 everything that is missing
//   node tools/arcade-voice/generate.mjs voice           the announcer lines (pack "announcer")
//   node tools/arcade-voice/generate.mjs voice --pack arena
//   node tools/arcade-voice/generate.mjs sfx             the sound effects
//   node tools/arcade-voice/generate.mjs voice --only slice-house,m-knockout --force
//   node tools/arcade-voice/generate.mjs --dry-run       what it would render and cost; no API calls
//   node tools/arcade-voice/generate.mjs --probe         account tier, quota left, are the voices there
//
// Output: public/arcade/voice/<pack>/<id>-<n>.mp3 + manifest.json, public/arcade/sfx/<cue>.mp3
// + manifest.json. Idempotent: a file that exists is skipped unless --force. Every clip is
// trimmed, faded and loudness-normalised here (see dsp.mjs); the audio the API returned is
// kept in .scratch/voice/raw so --reprocess can rebuild the mp3s without paying again.
//
// Options: --pack <name>  --only <id,id>  --force  --takes <n>  --concurrency <n>
//          --retries <n> (re-renders of a take whose length is not sane; default 2)
//          --reprocess (rebuild from the cached raw audio, no API calls)
//          --reject <id-n,id-n> (delete those takes; the next run renders them again)
//          --out <dir> (instead of public/arcade)  --mock (placeholder beeps; needs --out)
//
// The key and what is sent: see eleven.mjs. docs/arcade-voice.md has the full story.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKS, LINES, SFX, SFX_ALIASES, durationBounds, sfxFiles,
} from './lines.mjs';
import {
  decodeMp3, pcm16ToClip, toMono, resample, trim, fade, slice, normalise, encodeMp3, measure, gaps, activeRange,
} from './dsp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRATCH = path.join(REPO, '.scratch', 'voice');

export const VOICE_FORMAT = { sampleRate: 44100, channels: 1, kbps: 96, lufs: -15, peakDb: -2 };
// The effects sit below the voice so the announcer is always on top.
export const SFX_FORMAT = { sampleRate: 44100, kbps: 128, lufs: -21, peakDb: -3 };
const TTS_FORMATS = ['pcm_44100', 'mp3_44100_192', 'mp3_44100_128'];

function parseArgs(argv) {
  const a = { what: 'all', pack: 'announcer', only: null, force: false, takes: 3, concurrency: 2, retries: 2,
    reprocess: false, reject: null, dryRun: false, out: null, mock: false, probe: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${v} needs a value`); return argv[++i]; };
    if (v === '--pack') a.pack = next();
    else if (v === '--only') a.only = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (v === '--force') a.force = true;
    else if (v === '--takes') a.takes = Math.max(1, Number(next()) || 3);
    else if (v === '--concurrency') a.concurrency = Math.max(1, Math.min(8, Number(next()) || 2));
    else if (v === '--retries') a.retries = Math.max(0, Math.min(5, Number(next()) || 0));
    else if (v === '--reprocess') a.reprocess = true;
    else if (v === '--reject') a.reject = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--out') a.out = path.resolve(next());
    else if (v === '--mock') a.mock = true;
    else if (v === '--probe') a.probe = true;
    else if (v.startsWith('--')) throw new Error(`unknown option ${v}`);
    else rest.push(v);
  }
  if (rest.length) a.what = rest[0];
  if (!['all', 'voice', 'sfx'].includes(a.what)) throw new Error(`unknown target "${a.what}" (voice | sfx | all)`);
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(a.pack)) throw new Error('--pack must be lower-case letters, digits and dashes');
  if (a.mock && !a.out) throw new Error('--mock writes placeholder beeps: give it --out <dir> so they never land in public/');
  return a;
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const writeJson = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };

/** Run jobs with a small pool; a job that throws a fatal error stops the rest. */
async function pool(jobs, n) {
  let i = 0;
  let fatal = null;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length && !fatal) {
      const job = jobs[i++];
      try { await job(); } catch (err) { if (err && err.fatal) fatal = err; else throw err; }
    }
  }));
  if (fatal) throw fatal;
}

function fatalIf(err) {
  // nothing to gain by going on: a bad key, no quota left, or no network at all
  if (err && (err.status === 401 || err.status === 402 || err.code === 'network' || /quota/i.test(err.code || ''))) err.fatal = true;
  return err;
}

// ---- placeholder audio (--mock): lets the whole pipeline run without the API ----------------
function mockClient() {
  const sr = 44100;
  const burst = (seconds, f0) => {
    const lead = 0.05 + Math.random() * 0.25;
    const tail = 0.1 + Math.random() * 0.5;
    const n = Math.round((lead + seconds + tail) * sr);
    const x = new Float32Array(n);
    for (let i = Math.round(lead * sr); i < Math.round((lead + seconds) * sr); i++) {
      const t = i / sr - lead;
      x[i] = 0.3 * Math.sin(2 * Math.PI * f0 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t)) * Math.min(1, t * 40);
    }
    return x;
  };
  return {
    async subscription() { return { tier: 'mock', used: 0, limit: 0 }; },
    async voice(id) { return { id, name: 'Mock', labels: {} }; },
    async voices() { return []; },
    async speak({ text, format }) {
      const plain = text.replace(/\[[^\]]*\]/g, '').trim();
      const x = burst(0.25 + plain.length * 0.045, 180 + (plain.length % 7) * 20);
      const buf = Buffer.alloc(x.length * 2);
      for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(x[i] * 32767), i * 2);
      return { bytes: buf, format: format.startsWith('pcm') ? format : 'pcm_44100', characters: text.length };
    },
    async sound({ seconds }) {
      const x = burst(seconds * 0.9, 330);
      return { bytes: encodeMp3({ ch: [x, x.map((v) => v * 0.8)], sr }, 128), format: 'mp3_44100_128', credits: null };
    },
  };
}

// ---- the voice -----------------------------------------------------------------------------

export async function resolveVoice(client, pack, log) {
  let v = null;
  try {
    v = await client.voice(pack.voiceId);
  } catch (err) {
    throw fatalIf(err);
  }
  if (v === undefined) {
    log(`  (this key may not read voices: using ${pack.voiceName} ${pack.voiceId} unchecked)`);
    return { id: pack.voiceId, name: pack.voiceName, checked: false };
  }
  if (v) return { id: v.id || pack.voiceId, name: v.name || pack.voiceName, checked: true };
  // not on the account: the closest energetic male announcer the account does have
  const all = await client.voices();
  const score = (c) => {
    const hay = `${c.name} ${c.description} ${Object.values(c.labels || {}).join(' ')}`.toLowerCase();
    let s = 0;
    if (pack.want && String((c.labels || {}).gender || '').toLowerCase() === pack.want.gender) s += 3;
    for (const w of (pack.want && pack.want.words) || []) if (hay.includes(w)) s += 1;
    return s;
  };
  const ranked = all.map((c) => ({ c, s: score(c) })).sort((x, y) => y.s - x.s);
  if (!ranked.length) throw Object.assign(new Error(`voice ${pack.voiceId} is not on the account and the account lists no voices`), { fatal: true });
  log(`  voice ${pack.voiceName} (${pack.voiceId}) is NOT on this account. Closest: ${ranked.slice(0, 3).map((r) => `${r.c.name} [${r.s}]`).join(', ')}`);
  return { id: ranked[0].c.id, name: ranked[0].c.name, checked: true, substitute: true };
}

/** Raw API audio -> a mono 44.1 kHz clip. */
async function rawToClip(bytes, format) {
  let clip;
  if (format.startsWith('pcm_')) clip = pcm16ToClip(bytes, Number(format.slice(4)));
  else clip = toMono(await decodeMp3(bytes));
  return resample(clip, VOICE_FORMAT.sampleRate);
}

/** Trim, fade, normalise one voice take. Returns { clip, stats, problems }. */
export function processVoice(clip, line) {
  const t = fade(trim(clip, { relDb: -40, padStartMs: 3, padEndMs: 50 }), { inMs: 2, outMs: 40 });
  const out = normalise(t, { targetLufs: VOICE_FORMAT.lufs, peakDb: VOICE_FORMAT.peakDb });
  const r = activeRange(out, { relDb: -40 });
  const activeS = r.silent ? 0 : (r.end - r.start) / out.sr;
  const { minS, maxS } = durationBounds(line);
  const holes = gaps(out, { minMs: 450 });
  const problems = [];
  if (r.silent) problems.push('silent');
  if (activeS < minS) problems.push(`short ${fmt(activeS)}s < ${fmt(minS)}s`);
  if (activeS > maxS) problems.push(`long ${fmt(activeS)}s > ${fmt(maxS)}s`);
  return { clip: out, activeS, holes, problems, minS, maxS };
}

async function renderVoice(args, client, usage, log) {
  const pack = PACKS[args.pack];
  if (!pack) throw new Error(`unknown pack "${args.pack}" (have: ${Object.keys(PACKS).join(', ')}). Add it to PACKS in lines.mjs.`);
  const outDir = path.join(args.out || path.join(REPO, 'public', 'arcade'), 'voice', args.pack);
  const rawDir = path.join(args.out ? path.join(args.out, '.raw') : path.join(SCRATCH, 'raw'), args.pack);
  const manifestFile = path.join(outDir, 'manifest.json');
  const old = readJson(manifestFile);

  const lines = LINES.filter((l) => !args.only || args.only.has(l.id));
  if (args.only) for (const id of args.only) if (!LINES.some((l) => l.id === id) && !SFX.some((s) => s.cue === id)) log(`  (no such line: ${id})`);

  // the work list: take 1 of every line first, so a run that stops early still covers every line
  const todo = [];
  for (let n = 1; n <= args.takes; n++) {
    for (const l of lines) {
      if (n > l.takes.length) continue;
      const file = path.join(outDir, `${l.id}-${n}.mp3`);
      if (!args.force && !args.reprocess && fs.existsSync(file)) continue;
      todo.push({ line: l, n, text: l.takes[n - 1], file, base: path.join(rawDir, `${l.id}-${n}`) });
    }
  }
  const chars = todo.reduce((s, t) => s + t.text.length, 0);
  log(`voice pack "${args.pack}": ${lines.length} lines, ${todo.length} takes to render (${chars} characters before retries)`);
  if (args.dryRun) { for (const t of todo) log(`  ${t.line.id}-${t.n}  ${t.text}`); return; }

  let voice;
  if (args.reprocess) {
    voice = old && old.voice ? old.voice : { id: pack.voiceId, name: pack.voiceName };
  } else if (todo.length) {
    voice = await resolveVoice(client, pack, log);
    if (old && old.voice && old.voice.id && old.voice.id !== voice.id && !args.force) {
      throw new Error(`pack "${args.pack}" was rendered with voice ${old.voice.name} (${old.voice.id}) but would now use ${voice.name} (${voice.id}): re-run with --force to re-render it all in one voice`);
    }
    log(`  voice: ${voice.name} (${voice.id}), model ${pack.model}, stability ${pack.settings.stability}`);
  } else {
    voice = old && old.voice ? old.voice : { id: pack.voiceId, name: pack.voiceName };
  }

  let formats = TTS_FORMATS.slice();
  const flagged = [];
  let made = 0;
  let failed = 0;

  const one = async (t) => {
    const metaFile = `${t.base}.json`;
    const wantMeta = { text: t.text, voiceId: voice.id, model: pack.model, settings: pack.settings };
    const cached = () => {
      const meta = readJson(metaFile);
      if (!meta || !meta.format) return null;
      if (!args.reprocess && JSON.stringify({ ...meta, format: undefined }) !== JSON.stringify({ ...wantMeta, format: undefined })) return null;
      const rawFile = `${t.base}.${meta.format.startsWith('pcm') ? 'pcm' : 'mp3'}`;
      if (!fs.existsSync(rawFile)) return null;
      return { bytes: fs.readFileSync(rawFile), format: meta.format };
    };

    let best = null;
    const attempts = args.reprocess ? 1 : 1 + args.retries;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let raw = attempt === 0 && !args.force ? cached() : null;
      if (args.reprocess && !raw) { log(`  ${t.line.id}-${t.n}: no cached raw audio, skipped`); return; }
      let fromCache = !!raw;
      while (!raw) {
        try {
          raw = await client.speak({ voiceId: voice.id, text: t.text, model: pack.model, settings: pack.settings, format: formats[0] });
          usage.ttsRequests++;
          usage.ttsCharacters += raw.characters;
        } catch (err) {
          // a format this plan may not have (44.1 kHz PCM is a higher-tier format): walk down
          // the list, once for the whole run
          const said = `${err.code} ${err.message}`;
          const aboutFormat = err.status >= 400 && err.status < 500 && !/quota|invalid_api_key|missing_permissions|voice_not_found/i.test(said)
            && (err.status === 403 || /format|pcm|subscri|tier|plan|upgrade/i.test(said));
          if (aboutFormat && formats.length > 1) {
            log(`  (${formats[0]} was refused: ${err.message}. Trying ${formats[1]})`);
            formats = formats.slice(1);
            continue;
          }
          fatalIf(err);
          if (err.fatal) throw err;
          log(`  ${t.line.id}-${t.n}: FAILED ${err.message}`);
          failed++;
          return;
        }
      }
      let result;
      try {
        result = processVoice(await rawToClip(raw.bytes, raw.format), t.line);
      } catch (err) {
        result = { problems: [`undecodable (${err.message})`], activeS: 0, holes: [] };
      }
      const cand = { raw, result, fromCache };
      const badness = (c) => {
        if (!c.result.clip) return 1e9;
        return c.result.problems.length ? 1 + Math.abs(c.result.activeS - (c.result.minS + c.result.maxS) / 2) : 0;
      };
      if (!best || badness(cand) < badness(best)) best = cand;
      if (!result.problems.length) break;
      if (attempt + 1 < attempts) log(`  ${t.line.id}-${t.n}: ${result.problems.join(', ')}: rendering again`);
    }
    if (!best) return;
    if (!best.result.clip || best.result.problems.includes('silent')) {
      log(`  ${t.line.id}-${t.n}: FAILED ${best.result.problems.join(', ')}`);
      failed++;
      return;
    }
    // keep what the API returned, so the mp3 can be rebuilt without paying again
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(`${t.base}.${best.raw.format.startsWith('pcm') ? 'pcm' : 'mp3'}`, best.raw.bytes);
    writeJson(metaFile, { ...wantMeta, format: best.raw.format });

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(t.file, encodeMp3(best.result.clip, VOICE_FORMAT.kbps));
    made++;
    const notes = [...best.result.problems];
    for (const h of best.result.holes) notes.push(`hole of ${fmt(h.lengthS)}s at ${fmt(h.atS)}s`);
    if (notes.length) flagged.push({ file: `${t.line.id}-${t.n}.mp3`, text: t.text, notes });
    log(`  ${`${t.line.id}-${t.n}`.padEnd(26)} ${fmt(best.result.activeS)}s${notes.length ? `  SUSPECT: ${notes.join('; ')}` : ''}`);
  };

  let stopped = null;
  try {
    await pool(todo.map((t) => () => one(t)), args.reprocess ? 1 : args.concurrency);
  } catch (err) {
    if (!err.fatal) throw err;
    stopped = err;
  }

  // the manifest is rebuilt from what is on disk: only lines of the catalogue, only files that exist
  const manifest = {
    pack: args.pack,
    voice: { id: voice.id, name: voice.name, model: pack.model, settings: pack.settings },
    names: { delivery: pack.nameDelivery },
    format: VOICE_FORMAT,
    lines: {},
  };
  let files = 0;
  for (const l of LINES) {
    const have = l.takes.map((_, i) => `${l.id}-${i + 1}.mp3`).filter((f) => fs.existsSync(path.join(outDir, f)));
    if (have.length) { manifest.lines[l.id] = { text: l.text, files: have }; files += have.length; }
  }
  if (files) writeJson(manifestFile, manifest);
  const missing = LINES.filter((l) => !manifest.lines[l.id]).map((l) => l.id);
  log(`voice pack "${args.pack}": ${made} rendered, ${failed} failed, ${files} files in the manifest${missing.length ? `, ${missing.length} lines still missing` : ''}`);
  if (flagged.length) {
    log(`  ${flagged.length} take(s) look suspect by the numbers (listen, or --reject them):`);
    for (const f of flagged) log(`    ${f.file}  ${f.notes.join('; ')}`);
  }
  writeJson(path.join(args.out ? args.out : SCRATCH, `render-report-${args.pack}.json`), { pack: args.pack, flagged, missing });
  if (stopped) throw stopped;
}

// ---- sound effects -------------------------------------------------------------------------

/** Trim, cut to length, fade the tail, normalise one effect. */
export function processSfx(clip, spec) {
  let c = resample(clip, SFX_FORMAT.sampleRate);
  const crowd = /^(crowd-|applause$|oooh$)/.test(spec.cue);
  const target = spec.lufs ?? SFX_FORMAT.lufs;
  // collapse a stereo file whose channels are the same to mono
  if (c.ch.length === 2) {
    let diff = 0;
    for (let i = 0; i < c.ch[0].length; i += 7) diff = Math.max(diff, Math.abs(c.ch[0][i] - c.ch[1][i]));
    if (diff < 1e-4) c = { ch: [c.ch[0]], sr: c.sr };
  }
  const r = activeRange(c, { relDb: -36 });
  if (r.silent) return { problems: ['silent'] };
  const start = Math.max(0, r.start - Math.round(c.sr * 0.002));
  const end = Math.min(r.end + Math.round(c.sr * 0.05), start + Math.round(c.sr * spec.keepS));
  // a crowd swells in; everything else keeps its attack (a 1 ms fade only stops a click)
  c = fade(slice(c, start, end), { inMs: crowd ? 25 : 1, outMs: Math.min(spec.fadeMs, ((end - start) / c.sr) * 500) });
  c = normalise(c, { targetLufs: target, peakDb: SFX_FORMAT.peakDb, maxGainDb: 24 });
  const problems = [];
  const durationS = c.ch[0].length / c.sr;
  if (durationS < Math.min(0.2, spec.keepS * 0.4)) problems.push(`short ${fmt(durationS)}s`);
  return { clip: c, durationS, problems };
}

async function renderSfx(args, client, usage, log) {
  const outDir = path.join(args.out || path.join(REPO, 'public', 'arcade'), 'sfx');
  const rawDir = path.join(args.out ? path.join(args.out, '.raw') : path.join(SCRATCH, 'raw'), 'sfx');
  const specs = SFX.filter((s) => !args.only || args.only.has(s.cue));
  const todo = [];
  for (const s of specs) {
    sfxFiles(s).forEach((name, i) => {
      const file = path.join(outDir, name);
      if (!args.force && !args.reprocess && fs.existsSync(file)) return;
      todo.push({ spec: s, name, file, base: path.join(rawDir, name.replace(/\.mp3$/, '')), i });
    });
  }
  log(`sfx: ${specs.length} cues, ${todo.length} clips to generate (${fmt(todo.reduce((s, t) => s + t.spec.seconds, 0), 1)} s of audio)`);
  if (args.dryRun) { for (const t of todo) log(`  ${t.name.padEnd(22)} ${t.spec.seconds}s  ${t.spec.prompt.slice(0, 70)}...`); return; }

  let made = 0;
  let failed = 0;
  const one = async (t) => {
    const rawFile = `${t.base}.raw.mp3`;
    let bytes = !args.force && fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : null;
    if (args.reprocess && !bytes) { log(`  ${t.name}: no cached raw audio, skipped`); return; }
    let result = null;
    for (let attempt = 0; attempt < (args.reprocess ? 1 : 2); attempt++) {
      if (!bytes) {
        try {
          const r = await client.sound({ text: t.spec.prompt, seconds: t.spec.seconds, influence: t.spec.influence ?? 0.4 });
          usage.sfxGenerations++;
          usage.sfxSeconds += t.spec.seconds;
          bytes = r.bytes;
        } catch (err) {
          if (fatalIf(err).fatal) throw err;
          log(`  ${t.name}: FAILED ${err.message}`);
          failed++;
          return;
        }
      }
      try { result = processSfx(await decodeMp3(bytes), t.spec); } catch (err) { result = { problems: [`undecodable (${err.message})`] }; }
      if (result.clip && !result.problems.length) break;
      if (attempt === 0 && !args.reprocess) { log(`  ${t.name}: ${result.problems.join(', ')}: generating again`); bytes = null; }
    }
    if (!result || !result.clip) { log(`  ${t.name}: FAILED ${result ? result.problems.join(', ') : ''}`); failed++; return; }
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(rawFile, bytes);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(t.file, encodeMp3(result.clip, SFX_FORMAT.kbps));
    made++;
    log(`  ${t.name.padEnd(22)} ${fmt(result.durationS)}s ${result.clip.ch.length === 2 ? 'stereo' : 'mono'}${result.problems.length ? `  SUSPECT: ${result.problems.join('; ')}` : ''}`);
  };

  let stopped = null;
  try {
    await pool(todo.map((t) => () => one(t)), args.reprocess ? 1 : args.concurrency);
  } catch (err) {
    if (!err.fatal) throw err;
    stopped = err;
  }

  const manifest = { version: 1, format: SFX_FORMAT, cues: {} };
  let files = 0;
  for (const s of SFX) {
    const have = sfxFiles(s).filter((f) => fs.existsSync(path.join(outDir, f)));
    if (have.length) { manifest.cues[s.cue] = { files: have }; files += have.length; }
  }
  for (const [alias, target] of Object.entries(SFX_ALIASES)) {
    // a file dropped in by hand under the alias name wins (the old override mechanism)
    if (manifest.cues[target] && !fs.existsSync(path.join(outDir, `${alias}.mp3`))) {
      manifest.cues[alias] = { files: manifest.cues[target].files, alias: target };
    }
  }
  if (files) writeJson(path.join(outDir, 'manifest.json'), manifest);
  log(`sfx: ${made} generated, ${failed} failed, ${files} files in the manifest`);
  if (stopped) throw stopped;
}

// ---- main ----------------------------------------------------------------------------------

function reject(args, log) {
  const dir = path.join(args.out || path.join(REPO, 'public', 'arcade'), 'voice', args.pack);
  for (const id of args.reject) {
    const file = path.join(dir, `${id.replace(/\.mp3$/, '')}.mp3`);
    if (!/^[a-z0-9-]+$/.test(id.replace(/\.mp3$/, '')) || !fs.existsSync(file)) { log(`  (no such take: ${id})`); continue; }
    fs.unlinkSync(file);
    const base = path.join(args.out ? path.join(args.out, '.raw') : path.join(SCRATCH, 'raw'), args.pack, id.replace(/\.mp3$/, ''));
    for (const ext of ['.pcm', '.mp3', '.json']) { try { fs.unlinkSync(base + ext); } catch (_) { /* not cached */ } }
    log(`  rejected ${id}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (m) => console.log(m);
  const usage = { ttsRequests: 0, ttsCharacters: 0, sfxGenerations: 0, sfxSeconds: 0 };

  if (args.reject) reject(args, log);

  let client = null;
  if (args.mock) client = mockClient();
  else if (!args.dryRun && !args.reprocess) {
    const { createClient } = await import('./eleven.mjs');
    client = createClient({ concurrency: args.concurrency, log });
  }

  if (args.probe) {
    const sub = await client.subscription();
    log(sub ? `account: tier ${sub.tier}, ${sub.used} of ${sub.limit} credits used (${sub.limit - sub.used} left)` : 'account: the key cannot read the subscription (or is not valid)');
    for (const [name, pack] of Object.entries(PACKS)) {
      let v = null;
      try { v = await client.voice(pack.voiceId); } catch (err) { log(`  ${name}: ${err.message}`); continue; }
      log(`  ${name}: ${pack.voiceName} ${pack.voiceId} ${v ? `is on the account as "${v.name}"` : v === undefined ? 'could not be checked with this key' : 'is NOT on the account'}`);
    }
    return;
  }

  const before = client && !args.mock ? await client.subscription() : null;
  let error = null;
  try {
    if (args.what === 'voice' || args.what === 'all') await renderVoice(args, client, usage, log);
    if (args.what === 'sfx' || args.what === 'all') await renderSfx(args, client, usage, log);
  } catch (err) {
    error = err;
  }

  if (!args.dryRun && !args.mock && (usage.ttsRequests || usage.sfxGenerations)) {
    const after = await client.subscription();
    const spent = before && after ? after.used - before.used : null;
    log(`spent: ${usage.ttsCharacters} text-to-speech characters in ${usage.ttsRequests} requests, ${usage.sfxGenerations} sound generations (${fmt(usage.sfxSeconds, 1)} s)${spent != null ? `; the account's credit counter moved by ${spent}` : ''}`);
    // a running total across runs, for the budget
    const ledgerFile = path.join(SCRATCH, 'usage.json');
    const ledger = readJson(ledgerFile) || { ttsRequests: 0, ttsCharacters: 0, sfxGenerations: 0, sfxSeconds: 0, credits: 0, runs: [] };
    for (const k of Object.keys(usage)) ledger[k] = (ledger[k] || 0) + usage[k];
    if (spent != null) ledger.credits = (ledger.credits || 0) + spent;
    ledger.runs.push({ at: new Date().toISOString(), what: args.what, pack: args.pack, ...usage, credits: spent });
    writeJson(ledgerFile, ledger);
    log(`total so far: ${ledger.ttsCharacters} characters, ${ledger.sfxGenerations} sound generations`);
  }

  if (error) {
    console.error(`\nSTOPPED: ${error.message}`);
    if (error.status === 401 && !/quota/i.test(error.code || '')) {
      console.error('The ElevenLabs key was rejected. Put a working key in ELEVENLABS_API_KEY (or in the env file named by BIRDIE_VOICE_ENV) and run this again: it carries on where it stopped.');
    }
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
