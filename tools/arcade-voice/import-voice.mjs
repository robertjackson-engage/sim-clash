#!/usr/bin/env node
// Build an announcer pack from renders made OUTSIDE the ElevenLabs key: clips generated in
// a Higgsfield account (ElevenLabs v4 there), fetched into .scratch/voice/downloads.
//
// A render job holds one take, or several takes spoken one after another with a long pause
// between them. This splits a job at its long silences (it must split into exactly as many
// pieces as the plan says, or the job is refused), then trims, fades, levels and encodes
// each take exactly as generate.mjs does, and writes the pack's manifest.
//
//   node tools/arcade-voice/import-voice.mjs --plan <plan.json> --from <dir of <index>.mp3> [--pack announcer]
//
// plan.json: { voice: '<preset voice id>', voiceName, jobs: [{ index, turns: [{ id, n, text }] }] }
// Takes that look wrong by the numbers are still written but listed, so a human can listen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, durationBounds } from './lines.mjs';
import { decodeAny, toMono, resample, slice, gaps, activeRange, encodeMp3 } from './dsp.mjs';
import { processVoice, VOICE_FORMAT } from './generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** Split a clip into `count` pieces at its longest silences. Returns the pieces, or null if it does not divide cleanly. */
export function splitAtPauses(clip, count) {
  if (count === 1) return [clip];
  const r = activeRange(clip, { relDb: -40 });
  if (r.silent) return null;
  // every silence of 200 ms or more inside the speech, longest first: the pauses between takes
  // are the long ones, a breath inside a take is short
  const holes = gaps(clip, { minMs: 200, relDb: -36 }).sort((a, b) => b.lengthS - a.lengthS);
  if (holes.length < count - 1) return null;
  const cuts = holes.slice(0, count - 1);
  const rest = holes.slice(count - 1);
  // refuse a split that is a coin toss: the shortest pause used must clearly beat the longest one not used
  if (rest.length && cuts[cuts.length - 1].lengthS < rest[0].lengthS * 1.35) return null;
  // exactly as many silences as there are joins: nothing to choose between (the pieces are still checked one by one)
  if (rest.length && cuts[cuts.length - 1].lengthS < 0.3) return null;
  cuts.sort((a, b) => a.atS - b.atS);
  const out = [];
  let from = 0;
  for (const c of cuts) {
    out.push(slice(clip, from * clip.sr, (c.atS + c.lengthS * 0.35) * clip.sr));
    from = c.atS + c.lengthS * 0.65;
  }
  out.push(slice(clip, from * clip.sr, clip.ch[0].length));
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { pack: 'announcer', plan: null, from: null, out: path.join(REPO, 'public', 'arcade') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pack') opt.pack = argv[++i];
    else if (argv[i] === '--plan') opt.plan = path.resolve(argv[++i]);
    else if (argv[i] === '--from') opt.from = path.resolve(argv[++i]);
    else if (argv[i] === '--out') opt.out = path.resolve(argv[++i]);
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!opt.plan || !opt.from) throw new Error('--plan and --from are required');
  const plan = JSON.parse(fs.readFileSync(opt.plan, 'utf8'));
  const byId = new Map(LINES.map((l) => [l.id, l]));
  const outDir = path.join(opt.out, 'voice', opt.pack);
  fs.mkdirSync(outDir, { recursive: true });
  let made = 0;
  const refused = [];
  const suspect = [];
  for (const job of plan.jobs) {
    const file = path.join(opt.from, `${job.index}.mp3`);
    if (!fs.existsSync(file)) continue;
    const clip = resample(toMono(await decodeAny(fs.readFileSync(file))), VOICE_FORMAT.sampleRate);
    const parts = splitAtPauses(clip, job.turns.length);
    if (!parts) { refused.push(job.index); console.log(`  job ${job.index}: does not split into ${job.turns.length} takes cleanly, refused`); continue; }
    const results = job.turns.map((turn, k) => processVoice(parts[k], byId.get(turn.id)));
    // several takes in one job: every piece must look like its own line, or the split is not trusted
    if (job.turns.length > 1 && results.some((r) => r.problems.length || r.holes.length)) {
      refused.push(job.index);
      console.log(`  job ${job.index}: a piece does not look like its line after splitting, refused`);
      continue;
    }
    job.turns.forEach((turn, k) => {
      const res = results[k];
      const name = `${turn.id}-${turn.n}.mp3`;
      if (!res.clip || res.problems.includes('silent')) { suspect.push(`${name}: silent`); return; }
      fs.writeFileSync(path.join(outDir, name), encodeMp3(res.clip, VOICE_FORMAT.kbps));
      made++;
      const notes = [...res.problems, ...res.holes.map((h) => `hole of ${h.lengthS.toFixed(2)} s`)];
      if (notes.length) suspect.push(`${name} (job ${job.index}): ${notes.join('; ')}`);
    });
  }
  const manifest = {
    pack: opt.pack,
    voice: { id: plan.voice, name: plan.voiceName || '', model: 'elevenlabs_v4', provider: 'higgsfield', settings: {} },
    names: { delivery: '[shouting] {NAME}!' },
    format: VOICE_FORMAT,
    lines: {},
  };
  let files = 0;
  for (const l of LINES) {
    const have = [1, 2, 3].map((n) => `${l.id}-${n}.mp3`).filter((f) => fs.existsSync(path.join(outDir, f)));
    if (have.length) { manifest.lines[l.id] = { text: l.text, files: have }; files += have.length; }
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const missing = LINES.filter((l) => !manifest.lines[l.id]).map((l) => l.id);
  console.log(`pack "${opt.pack}": ${made} takes written, ${files} files in the manifest, ${missing.length} lines without a voice${refused.length ? `, jobs refused: ${refused.join(' ')}` : ''}`);
  if (missing.length) console.log(`  no voice yet: ${missing.join(', ')}`);
  if (suspect.length) { console.log(`  suspect by the numbers (${suspect.length}):`); for (const s of suspect) console.log(`    ${s}`); }
  fs.writeFileSync(path.join(path.dirname(opt.plan), `voice-import-${opt.pack}.json`), JSON.stringify({ refused, suspect, missing }, null, 1));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
