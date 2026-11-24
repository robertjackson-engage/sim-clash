#!/usr/bin/env node
// A contact sheet of stills (capture.mjs): node tools/arcade-art/trees/sheet.mjs <out.jpg> <a.png> <b.png> ... [--cols 2] [--width 960]
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const cols = +opt('--cols', 2), tw = +opt('--width', 960), th = Math.round(tw * 9 / 16);
const [out, ...files] = args;
const sharp = createRequire(import.meta.url)('sharp');
const rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 82 }).toFile(path.resolve(out));
console.log(`wrote ${path.resolve(out)}`);
