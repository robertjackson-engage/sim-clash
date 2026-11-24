// Finding and running ffmpeg, and the small jobs the trailer tools share (an indexed copy
// of a raw clip, stills, contact sheets).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SCRATCH = path.join(repo, '.scratch', 'trailer');
export const RAW = path.join(SCRATCH, 'raw');
export const WORK = path.join(SCRATCH, 'work');

/**
 * ffmpeg.exe: --ffmpeg <path> or the FFMPEG environment variable, then PATH, then where
 * winget puts Gyan.FFmpeg, then C:\Program Files\ffmpeg. Null: not installed.
 */
export function findFfmpeg(argv = process.argv) {
  const i = argv.indexOf('--ffmpeg');
  const named = (i >= 0 && argv[i + 1]) || process.env.FFMPEG || null;
  if (named) return fs.existsSync(named) ? named : null;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  const found = [];
  const walk = (dir, depth) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === exe) found.push(p);
      else if (e.isDirectory() && depth > 0) walk(p, depth - 1);
    }
  };
  const local = process.env.LOCALAPPDATA;
  if (local) {
    walk(path.join(local, 'Microsoft', 'WinGet', 'Links'), 0);
    try { for (const d of fs.readdirSync(path.join(local, 'Microsoft', 'WinGet', 'Packages'))) if (/ffmpeg/i.test(d)) walk(path.join(local, 'Microsoft', 'WinGet', 'Packages', d), 3); } catch (_) { /* no winget packages */ }
  }
  walk('C:\Program Files\ffmpeg', 2);
  walk('C:\ffmpeg', 2);
  return found[0] || null;
}

export function run(ffmpeg, args, { quiet = true, allowFail = false } = {}) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`ffmpeg failed (${r.status}): ffmpeg ${args.join(' ')}\n${String(r.stderr || '').split(/\r?\n/).slice(-25).join('\n')}`);
  }
  if (!quiet) process.stderr.write(r.stderr || '');
  return r;
}

/** An indexed copy of a raw clip (the recorder's Matroska has no seek index): stream copy, no re-encode. */
export function indexed(ffmpeg, name) {
  const src = ['mkv', 'webm'].map((x) => path.join(RAW, `${name}.${x}`)).find((f) => fs.existsSync(f));
  if (!src) throw new Error(`no raw clip '${name}' in ${RAW}: film it first (node tools/release/trailer/shoot.mjs --only ...)`);
  fs.mkdirSync(WORK, { recursive: true });
  const out = path.join(WORK, `${name}.mkv`);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) run(ffmpeg, ['-i', src, '-map', '0', '-c', 'copy', out]);
  return out;
}

/** One still (JPEG) of `file` at `t` seconds. */
export function still(ffmpeg, file, t, out, { width = 0 } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  run(ffmpeg, ['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2`] : []), '-q:v', '3', out]);
  return out;
}

/** A contact sheet of stills (sharp). labels: burned in under each tile. */
export async function sheet(out, files, { cols = 4, tw = 480, th = 270, labels = null } = {}) {
  const sharp = require('sharp');
  const rows = Math.ceil(files.length / cols);
  const lh = labels ? 22 : 0;
  const tiles = [];
  for (let i = 0; i < files.length; i++) {
    const left = (i % cols) * tw, top = Math.floor(i / cols) * (th + lh);
    tiles.push({ input: await sharp(files[i]).resize(tw, th, { fit: 'contain', background: '#000' }).toBuffer(), left, top });
    if (labels) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${lh}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Consolas, monospace" font-size="14" fill="#ffd21f">${String(labels[i]).replace(/[<&>]/g, ' ')}</text></svg>`;
      tiles.push({ input: Buffer.from(svg), left, top: top + th });
    }
  }
  await sharp({ create: { width: cols * tw, height: rows * (th + lh), channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
  return out;
}
