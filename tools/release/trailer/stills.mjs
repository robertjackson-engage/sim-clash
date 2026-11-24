#!/usr/bin/env node
// Look at a clip: stills at the times given, as one contact sheet.
//
//   node tools/release/trailer/stills.mjs <clip name | file> <t1,t2,... | from:to:step> [--out sheet.jpg] [--cols 4] [--tw 480]
//
// A clip NAME is a raw clip of .scratch/trailer/raw (an indexed copy is made once); a FILE
// is any video (a finished cut in release/media, say).
import fs from 'node:fs';
import path from 'node:path';
import { findFfmpeg, indexed, still, sheet, SCRATCH } from './ff.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ffmpeg = findFfmpeg();
if (!ffmpeg) { console.error('ffmpeg not found (winget install Gyan.FFmpeg, or --ffmpeg <path>)'); process.exit(1); }
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [clip, spec] = pos;
const file = fs.existsSync(clip) ? clip : indexed(ffmpeg, clip);
let times;
if (/^[\d.]+:[\d.]+:[\d.]+$/.test(spec)) { const [a, b, s] = spec.split(':').map(Number); times = []; for (let t = a; t <= b + 1e-6; t += s) times.push(+t.toFixed(3)); }
else times = spec.split(',').map(Number);
const dir = path.join(SCRATCH, 'stills', 'tmp');
const tw = +flag('--tw', 480);
const files = times.map((t, i) => still(ffmpeg, file, t, path.join(dir, `s${String(i).padStart(3, '0')}.jpg`), { width: tw }));
const out = path.resolve(flag('--out', path.join(SCRATCH, 'stills', `sheet-${path.basename(clip).replace(/\.\w+$/, '')}.jpg`)));
await sheet(out, files, { cols: +flag('--cols', 4), tw, th: Math.round(tw * 9 / 16), labels: times.map((t) => `${t.toFixed(2)} s`) });
for (const f of files) fs.unlinkSync(f);
console.log(out);
