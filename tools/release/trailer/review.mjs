#!/usr/bin/env node
// Look at a finished cut without building it again: one still just after every cut and one
// in the middle of every caption, as a contact sheet.
//
//   node tools/release/trailer/review.mjs [trailer|short] [--tw 320] [--cols 6] [--ffmpeg <path>]
//
// Reads .scratch/trailer/work/<name>-timeline.json (written by build.mjs) and the file it names.
import fs from 'node:fs';
import path from 'node:path';
import { findFfmpeg, still, sheet, SCRATCH, WORK } from './ff.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const name = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'trailer';
const ffmpeg = findFfmpeg();
if (!ffmpeg) { console.error('ffmpeg not found'); process.exit(1); }
const tl = JSON.parse(fs.readFileSync(path.join(WORK, `${name}-timeline.json`), 'utf8'));
const tw = +flag('--tw', 320), cols = +flag('--cols', 6);
const times = [], labels = [];
for (const s of tl.segments) { times.push(s.start + 2.5 / 60); labels.push(`${s.start.toFixed(2)} ${s.id}`); }
for (const c of tl.captions) { times.push((c.t0 + c.t1) / 2); labels.push(`${c.t0.toFixed(1)}-${c.t1.toFixed(1)} ${c.card}`); times.push(c.t1 - 0.3); labels.push(`${(c.t1 - 0.3).toFixed(2)} ${c.card} end`); }
times.push(tl.total - 0.6); labels.push('last 0.6 s');
const dir = path.join(SCRATCH, 'review', 'tmp');
const files = times.map((t, i) => still(ffmpeg, tl.file, t, path.join(dir, `r${String(i).padStart(3, '0')}.jpg`), { width: tw }));
const out = path.join(SCRATCH, 'review', `${name}-review.jpg`);
await sheet(out, files, { cols, tw, th: Math.round(tw * 9 / 16), labels });
for (const f of files) fs.unlinkSync(f);
console.log(out);
