#!/usr/bin/env node
// Listen to a finished cut by numbers (for a machine that must stay silent): the level of
// the sound just before and just after every cut, any stretch of silence, the loudest
// sample, and where the sound is hot.
//
//   node tools/release/trailer/audit-audio.mjs [trailer|short] [--ffmpeg <path>]
//
// Reads .scratch/trailer/work/<name>-timeline.json (build.mjs writes it) and the finished
// file it names. A cut that lands in loud sound on BOTH sides is where a word or a cheer
// may be chopped: listen there first.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findFfmpeg, WORK } from './ff.mjs';

const name = process.argv.slice(2).find((a) => !a.startsWith('--') && !/ffmpeg/i.test(a)) || 'trailer';
const ffmpeg = findFfmpeg();
if (!ffmpeg) { console.error('ffmpeg not found'); process.exit(1); }
const tl = JSON.parse(fs.readFileSync(path.join(WORK, `${name}-timeline.json`), 'utf8'));
const RATE = 16000, WIN = 0.05;
const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', tl.file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
const n = Math.floor(RATE * WIN);
const db = [];
let peak = 0;
for (let i = 0; i + n <= pcm.length; i += n) {
  let sum = 0;
  for (let k = 0; k < n; k++) { const v = pcm[i + k] / 32768; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  db.push(10 * Math.log10(sum / n + 1e-10));
}
const level = (a, b) => { const x = db.slice(Math.max(0, Math.round(a / WIN)), Math.max(1, Math.round(b / WIN))); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : -100; };
console.log(`${path.basename(tl.file)}: ${(pcm.length / RATE).toFixed(2)} s of sound (picture ${tl.total.toFixed(2)} s), peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS, mean ${level(0, tl.total).toFixed(1)} dB RMS`);
console.log('cut   at      before -> after (dB RMS, 0.25 s each side; * loud on both sides)');
for (const s of tl.segments.slice(1)) {
  const b = level(s.start - 0.3, s.start - 0.05), a = level(s.start + 0.05, s.start + 0.3);
  console.log(`${String(s.id).padEnd(14)} ${s.start.toFixed(2).padStart(6)}  ${b.toFixed(0).padStart(4)} -> ${a.toFixed(0).padStart(4)} ${b > -24 && a > -24 ? '*' : ' '}  ${s.note.slice(0, 70)}`);
}
// silences: a second or more under -55 dB
let run = 0;
const quiet = [];
db.forEach((v, i) => { if (v < -55) run++; else { if (run * WIN >= 1) quiet.push([(i - run) * WIN, i * WIN]); run = 0; } });
if (run * WIN >= 1) quiet.push([(db.length - run) * WIN, db.length * WIN]);
console.log(quiet.length ? `silences of a second or more: ${quiet.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)} s`).join(', ')}` : 'no silence of a second or more');
const seg = (t) => (tl.segments.find((s) => t >= s.start && t < s.end) || {}).id;
const per = tl.segments.map((s) => `${s.id} ${level(s.start, s.end).toFixed(0)}`).join(' | ');
console.log(`level per segment (dB RMS): ${per}`);
