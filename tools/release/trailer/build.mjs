#!/usr/bin/env node
// Cut the trailer from the raw clips: ONE command makes every deliverable.
//
//   node tools/release/trailer/build.mjs                 everything, into release/media/
//   node tools/release/trailer/build.mjs --only trailer  one of: trailer, short, vertical, loop, thumbs, shots
//   node tools/release/trailer/build.mjs --review        also: stills at every cut and caption (.scratch/trailer/review/)
//   node tools/release/trailer/build.mjs --draft         a quick, rough encode (for looking at a cut)
//   ... --ffmpeg <path to ffmpeg.exe>                    when it is not on PATH (or set FFMPEG)
//   ... --music <file> [--music-db -24]                  an instrumental bed of your own under the game's sound (none by default)
//
// Needs ffmpeg (winget install Gyan.FFmpeg) and the raw clips of shoot.mjs in
// .scratch/trailer/raw/. The edit itself is cut.mjs: a list of segments, each a stretch of a
// raw clip named by the marks the scene script left in it ('drive+3.6' is 3.6 s after the
// drive was struck), so a re-shoot cuts the same way. Nothing here touches the game.
//
// How a timeline is rendered: the PICTURE of every segment is cut to its own intermediate
// file (constant 60 fps, 1920 x 1080) and the intermediates are joined. The SOUND is mixed
// separately, sample by sample: every segment brings the game's own sound for its stretch
// of the clip, and that sound runs on for a moment under the next picture (its `tail`: the
// announcer finishes the word, the crowd rings out), faded at both ends so no cut clicks.
// The game has no looping sound by design (between a strike and a landing it is silent), so
// the cut is quiet in places; --music <file> lays a bed of your own under it, low. One final
// pass burns the captions in, levels the sound (EBU R128, linear) and encodes H.264 + AAC.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFfmpeg, run, indexed, still, sheet, repo, SCRATCH, RAW, WORK } from './ff.mjs';
import * as CUT from './cut.mjs';

// encoding yields to whatever else this PC is doing (somebody may be playing the game):
// below-normal priority, which ffmpeg inherits
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* not allowed: normal priority */ }

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const ONLY = (flag('--only', '') || '').split(',').filter(Boolean);
const want = (what) => !ONLY.length || ONLY.includes(what);
const REVIEW = args.includes('--review');
const DRAFT = args.includes('--draft');
const MUSIC = flag('--music') ? path.resolve(flag('--music')) : null;
const MUSIC_DB = +flag('--music-db', -24);     // a quick, rough encode for looking at the cut
const OUT = path.resolve(repo, flag('--out', path.join('release', 'media')));
const FPS = 60, W = 1920, H = 1080;

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error([
    'ffmpeg was not found (PATH, the winget folder, C:\\Program Files\\ffmpeg).',
    'Install it once:   winget install --id Gyan.FFmpeg -e',
    'then run again:    node tools/release/trailer/build.mjs',
    '(or name one:      node tools/release/trailer/build.mjs --ffmpeg "C:\\path\\to\\ffmpeg.exe")',
  ].join('\n'));
  process.exit(2);
}
console.log(`ffmpeg: ${ffmpeg}`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// ---------- the raw clips and their marks ----------
const metaCache = new Map();
function meta(clip) {
  if (!metaCache.has(clip)) {
    const f = path.join(RAW, `${clip}.json`);
    if (!fs.existsSync(f)) throw new Error(`no raw clip '${clip}': film it first (node tools/release/trailer/shoot.mjs)`);
    metaCache.set(clip, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return metaCache.get(clip);
}
// 'drive+3.6' | 'banner#2-0.5' (the second mark of that label) | 'banner~PUTT IN TO WIN+0.9'
// (the mark whose text has that) | 12.5 (seconds into the clip)
function at(clip, spec) {
  if (typeof spec === 'number') return spec;
  const m = /^(.*?)([+-]\d+(?:\.\d+)?)?$/.exec(String(spec));
  let label = m[1];
  const off = m[2] ? parseFloat(m[2]) : 0;
  if (/^\d+(\.\d+)?$/.test(label)) return parseFloat(label) + off;
  let nth = 1, text = null;
  const t = /^(.*?)~(.*)$/.exec(label);
  if (t) { label = t[1]; text = t[2]; }
  const n = /^(.*?)#(\d+)$/.exec(label);
  if (n) { label = n[1]; nth = +n[2]; }
  const marks = meta(clip).marks.filter((k) => k.label === label && (!text || String(k.text || '').includes(text)));
  if (marks.length < nth) throw new Error(`clip '${clip}' has no mark '${spec}' (marks: ${[...new Set(meta(clip).marks.map((k) => k.label))].join(', ')})`);
  return Math.round((marks[nth - 1].t + off) * 1000) / 1000;
}

// ---------- cards (captions, end card, lettering) ----------
function renderCards(cards) {
  const dir = path.join(WORK, 'cards');
  const specFile = path.join(WORK, 'cards.json');
  const body = JSON.stringify({ out: dir, cards });
  const stamp = path.join(dir, '.spec');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === body && cards.every((c) => fs.existsSync(path.join(dir, `${c.id}.png`)))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(specFile, body);
  const electron = require(path.join(repo, 'node_modules', 'electron'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [path.join(repo, 'tools', 'release', 'trailer', 'cards.cjs'), specFile], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`the cards did not render:\n${r.stderr}`);
  fs.writeFileSync(stamp, body);
  return dir;
}
const cardsDir = renderCards(CUT.cards);
const card = (id) => path.join(cardsDir, `${id}.png`);

// ---------- one timeline ----------
const X264_MID = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-g', '30', '-an'];
const RATE = 48000;
function resolve(timeline) {
  let t = 0;
  return timeline.segments.map((s, i) => {
    const seg = { ...s, i, start: t };
    if (s.card) seg.dur = s.dur;
    else { seg.in = at(s.clip, s.from); seg.out = at(s.clip, s.to); seg.dur = Math.round((seg.out - seg.in) * FPS) / FPS; }
    if (!(seg.dur > 0)) throw new Error(`segment ${i} (${s.note || s.clip}) has no length: ${JSON.stringify(s)}`);
    if (s.sound && s.sound.clip) seg.soundIn = at(s.sound.clip, s.sound.from);
    t += seg.dur;
    seg.end = t;
    return seg;
  });
}
function renderSegments(name, segs) {
  const dir = path.join(WORK, 'seg', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const s of segs) {
    const out = path.join(dir, `${String(s.i).padStart(3, '0')}.mkv`);
    const d = s.dur.toFixed(4);
    const inputs = [];
    let v;
    if (s.card) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', d, '-i', card(s.card));
      v = `[0:v]scale=${W}:${H},format=yuv420p${s.fadeIn ? `,fade=t=in:st=0:d=${s.fadeIn}` : ''}[v]`;
    } else {
      inputs.push('-ss', s.in.toFixed(3), '-t', (s.dur + 0.1).toFixed(4), '-i', indexed(ffmpeg, s.clip));
      const zoom = s.zoom ? `,crop=iw/${s.zoom}:ih/${s.zoom}:(iw-iw/${s.zoom})*${s.zx ?? 0.5}:(ih-ih/${s.zoom})*${s.zy ?? 0.5}` : '';
      v = `[0:v]fps=${FPS}${zoom},scale=${W}:${H}:flags=lanczos,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[v]`;
    }
    run(ffmpeg, [...inputs, '-filter_complex', v, '-map', '[v]', '-t', d, '-r', String(FPS), ...X264_MID, out]);
    files.push(out);
  }
  return files;
}
// ---------- the sound: mixed here, sample by sample ----------
function pcm(file, from, dur) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-ss', Math.max(0, from).toFixed(3), '-t', dur.toFixed(3), '-i', file, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 29, windowsHide: true });
  if (r.status !== 0) throw new Error(`could not read the sound of ${file}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + (r.stdout.length - (r.stdout.length % 8))));
}
function renderSound(name, segs, timeline) {
  const total = segs[segs.length - 1].end;
  const mix = new Float32Array(Math.ceil(total * RATE) * 2);
  const add = (data, atS, { gain = 1, fadeIn = 0.03, fadeOut = 0.07 } = {}) => {
    const frames = data.length / 2, at0 = Math.round(atS * RATE);
    const fi = Math.max(1, Math.round(fadeIn * RATE)), fo = Math.max(1, Math.round(fadeOut * RATE));
    for (let i = 0; i < frames; i++) {
      const o = at0 + i;
      if (o < 0 || o * 2 + 1 >= mix.length) continue;
      const g = gain * Math.min(1, i / fi) * Math.min(1, (frames - 1 - i) / fo);
      mix[o * 2] += data[i * 2] * g;
      mix[o * 2 + 1] += data[i * 2 + 1] * g;
    }
  };
  for (const s of segs) {
    if (s.sound === 'none' || (s.card && !s.sound)) continue;
    const clip = s.sound && s.sound.clip ? s.sound.clip : s.clip;
    const from = s.sound && s.sound.clip ? s.soundIn : s.in;
    // the sound runs on under the next picture: the default tail, or the segment's own
    const lead = s.lead ?? 0;
    const tail = Math.max(0, Math.min(s.tail ?? timeline.tail ?? 1.0, total - s.end, meta(clip).durationS - (from + s.dur) - 0.05));
    const data = pcm(indexed(ffmpeg, clip), from - lead, s.dur + lead + tail);
    add(data, s.start - lead, { gain: s.gain ?? 1, fadeIn: s.joinSound ? 0.005 : (lead ? Math.min(lead, 0.25) : 0.03), fadeOut: tail > 0.15 ? Math.min(tail, s.tailFade ?? 0.7) : 0.07 });
  }
  // a music bed of the owner's own, when one is named: low, under everything, faded at both ends
  let music = null;
  if (MUSIC) {
    const data = pcm(MUSIC, 0, total);
    const g = 10 ** (MUSIC_DB / 20);
    add(data.subarray(0, Math.min(data.length, mix.length)), 0, { gain: g, fadeIn: 0.8, fadeOut: 2.5 });
    music = { file: MUSIC, db: MUSIC_DB };
  }
  // never over full scale: one gain for the whole mix when the tails stack up
  let peak = 0;
  for (let i = 0; i < mix.length; i++) { const a = Math.abs(mix[i]); if (a > peak) peak = a; }
  if (peak > 0.94) { const k = 0.94 / peak; for (let i = 0; i < mix.length; i++) mix[i] *= k; }
  const out = path.join(WORK, `${name}-mix.wav`);
  const header = Buffer.alloc(44);
  const bytes = mix.length * 4;
  header.write('RIFF', 0); header.writeUInt32LE(36 + bytes, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 8, 28); header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(bytes, 40);
  fs.writeFileSync(out, Buffer.concat([header, Buffer.from(mix.buffer, mix.byteOffset, bytes)]));
  return { file: out, peak, music };
}
function join(name, files) {
  const list = path.join(WORK, `${name}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(WORK, `${name}-joined.mkv`);
  run(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  return out;
}
// EBU R128, measured then applied as one linear gain (no pumping); a true-peak ceiling
function loudness(file) {
  const r = run(ffmpeg, ['-i', file, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=14:print_format=json', '-f', 'null', '-'], { allowFail: true });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr || '');
  if (!m) return null;
  const j = JSON.parse(m[0]);
  return { i: j.input_i, tp: j.input_tp, lra: j.input_lra, thresh: j.input_thresh, offset: j.target_offset };
}
function captionFilters(caps, inputBase, total) {
  // each caption: its PNG, only as long as it is up (faded in and out), shifted to its place
  // on the timeline and laid over the picture
  const parts = [];
  let last = '[0:v]';
  caps.forEach((c, k) => {
    const a = Math.max(0, c.t0), b = Math.min(total, c.t1), d = b - a;
    parts.push(`[${inputBase + k}:v]format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${(d - 0.22).toFixed(3)}:d=0.22:alpha=1,setpts=PTS+${a.toFixed(3)}/TB[c${k}]`);
    parts.push(`${last}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${k}]`);
    last = `[v${k}]`;
  });
  return { parts, last };
}
function encode(name, joined, sound, segs, timeline, outFile, { maxMB = 58 } = {}) {
  const total = segs[segs.length - 1].end;
  const caps = (timeline.captions || []).map((c) => {
    const seg = segs.find((s) => s.id === c.on);
    if (!seg) throw new Error(`caption '${c.card}': no segment with id '${c.on}' in ${name}`);
    const t0 = seg.start + (c.offset || 0);
    return { ...c, t0, t1: c.dur ? t0 + c.dur : (c.until ? segs.find((s) => s.id === c.until).end : seg.end) - (c.early || 0) };
  });
  const inputs = ['-i', joined, '-i', sound.file];
  for (const c of caps) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', (Math.min(total, c.t1) - Math.max(0, c.t0)).toFixed(3), '-i', card(c.card));
  const { parts, last } = captionFilters(caps, 2, total);
  const fadeOut = timeline.fadeOut ? `,fade=t=out:st=${(total - timeline.fadeOut).toFixed(3)}:d=${timeline.fadeOut}` : '';
  parts.push(`${last}format=yuv420p${fadeOut}[vout]`);
  const loud = timeline.silent ? null : loudness(sound.file);
  const vparts = [...parts];
  const audio = [];
  if (!timeline.silent) {
    const ln = loud ? `loudnorm=I=-16:TP=-1.5:LRA=14:measured_I=${loud.i}:measured_TP=${loud.tp}:measured_LRA=${loud.lra}:measured_thresh=${loud.thresh}:offset=${loud.offset}:linear=true` : 'anull';
    parts.push(`[1:a]aformat=channel_layouts=stereo,${ln},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${timeline.fadeOut ? `,afade=t=out:st=${(total - timeline.fadeOut - 0.3).toFixed(3)}:d=${(timeline.fadeOut + 0.3).toFixed(3)}` : ''}[aout]`);
    audio.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  } else audio.push('-an');
  const x264 = ['-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2)];
  const tail = ['-movflags', '+faststart', '-t', total.toFixed(3), outFile];
  let mb;
  if (DRAFT) {
    // a quick look: one fast pass, no size target
    run(ffmpeg, [...inputs, '-filter_complex', parts.join(';'), '-map', '[vout]', ...audio, ...x264, '-preset', 'veryfast', '-crf', '24', ...tail]);
  } else {
    // two passes at the bit rate that keeps the file under maxMB (a forum upload), capped at a
    // rate beyond which 1080p60 game footage gains nothing
    const kbps = Math.min(timeline.maxKbps || 12000, Math.floor((maxMB * 0.97 * 8000) / total - 200));
    const log = path.join(WORK, `${name}-2pass`);
    run(ffmpeg, [...inputs, '-filter_complex', vparts.join(';'), '-map', '[vout]', '-an', ...x264, '-preset', 'slow', '-b:v', `${kbps}k`, '-pass', '1', '-passlogfile', log, '-t', total.toFixed(3), '-f', 'null', '-']);
    run(ffmpeg, [...inputs, '-filter_complex', parts.join(';'), '-map', '[vout]', ...audio, ...x264, '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.8)}k`, '-bufsize', `${kbps * 3}k`, '-pass', '2', '-passlogfile', log, ...tail]);
  }
  mb = fs.statSync(outFile).size / 1e6;
  console.log(`  ${path.relative(repo, outFile)}: ${total.toFixed(2)} s, ${mb.toFixed(1)} MB${loud ? `, sound ${loud.i} LUFS in, levelled to -16` : ''}${sound.music ? `, music bed ${path.basename(sound.music.file)} at ${sound.music.db} dB` : ', no music'}`);
  return { total, caps, mb, loud };
}

function buildTimeline(name, outFile, opts = {}) {
  const timeline = CUT.timelines[name];
  const segs = resolve(timeline);
  console.log(`${name}: ${segs.length} segments, ${segs[segs.length - 1].end.toFixed(2)} s`);
  const files = renderSegments(name, segs);
  const joined = join(name, files);
  const sound = renderSound(name, segs, timeline);
  const res = encode(name, joined, sound, segs, timeline, outFile, opts);
  // what was cut where, for audit-audio.mjs and for anybody checking the edit
  fs.writeFileSync(path.join(WORK, `${name}-timeline.json`), JSON.stringify({ name, file: outFile, total: res.total,
    segments: segs.map((x) => ({ id: x.id, start: x.start, end: x.end, clip: x.clip || null, card: x.card || null, in: x.in ?? null, out: x.out ?? null, note: x.note || '' })),
    captions: res.caps.map((c) => ({ card: c.card, t0: c.t0, t1: c.t1 })) }, null, 2));
  return { name, segs, joined, outFile, ...res };
}

// ---------- the deliverables ----------
const built = {};
if (want('trailer')) built.trailer = buildTimeline('trailer', path.join(OUT, 'sim-clash-trailer.mp4'), { maxMB: 58 });
if (want('short') || want('vertical')) built.short = buildTimeline('short', path.join(OUT, 'sim-clash-trailer-short.mp4'), { maxMB: 30 });

if (want('vertical') && built.short) {
  // 9:16: the whole 16:9 picture across the middle, a blurred, darkened copy of it filling
  // the frame behind, the wordmark above and the address below
  const out = path.join(OUT, 'sim-clash-trailer-short-vertical.mp4');
  const total = built.short.total;
  run(ffmpeg, ['-i', built.short.outFile, '-loop', '1', '-framerate', String(FPS), '-t', total.toFixed(3), '-i', card('vertical'),
    '-filter_complex', `[0:v]split[a][b];[a]scale=-2:1920,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.22:saturation=1.15[bg];[b]scale=1080:-2:flags=lanczos[fg];[bg][fg]overlay=0:(H-h)/2[m];[m][1:v]overlay=0:0,format=yuv420p,setsar=1[v]`,
    '-map', '[v]', '-map', '0:a', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-t', total.toFixed(3), out]);
  console.log(`  ${path.relative(repo, out)}: ${total.toFixed(2)} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  built.vertical = { outFile: out, total };
}

if (want('loop')) {
  // a silent clip that loops without a jump: the last half second is the first half second, cross-faded
  const L = CUT.loop;
  const a = at(L.clip, L.from), b = at(L.clip, L.to), dur = b - a, x = L.cross || 0.5;
  const src = indexed(ffmpeg, L.clip);
  const zoom = L.zoom ? `crop=iw/${L.zoom}:ih/${L.zoom}:(iw-iw/${L.zoom})*${L.zx ?? 0.5}:(ih-ih/${L.zoom})*${L.zy ?? 0.5},` : '';
  const chain = `[0:v]fps=30,${zoom}scale=1280:720:flags=lanczos,format=yuv420p,trim=duration=${(dur + x).toFixed(3)},setpts=PTS-STARTPTS,split[p][q];[p]trim=start=${x}:duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[main];[q]trim=duration=${x},setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=${x}:offset=${(dur - x).toFixed(3)},format=yuv420p[v]`;
  const input = ['-ss', a.toFixed(3), '-t', (dur + x + 0.2).toFixed(3), '-i', src, '-filter_complex', chain, '-map', '[v]', '-an', '-t', dur.toFixed(3)];
  const mp4 = path.join(OUT, 'sim-clash-loop.mp4'), webm = path.join(OUT, 'sim-clash-loop.webm');
  const budget = Math.floor((2.8 * 8000) / dur);   // kbit/s that keeps the file under 3 MB
  const log = path.join(WORK, 'loop-2pass');
  run(ffmpeg, [...input, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${budget}k`, '-pass', '1', '-passlogfile', log, '-f', 'null', '-']);
  run(ffmpeg, [...input, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${budget}k`, '-pass', '2', '-passlogfile', log, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  run(ffmpeg, [...input, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', `${budget}k`, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-pass', '1', '-passlogfile', `${log}-vp9`, '-f', 'null', '-']);
  run(ffmpeg, [...input, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', `${budget}k`, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-pass', '2', '-passlogfile', `${log}-vp9`, webm]);
  for (const f of [mp4, webm]) console.log(`  ${path.relative(repo, f)}: ${dur.toFixed(2)} s, ${(fs.statSync(f).size / 1e6).toFixed(2)} MB (silent, loops)`);
  built.loop = { dur, mp4, webm };
}

if (want('thumbs')) {
  const sharp = require('sharp');
  for (const t of CUT.thumbnails) {
    const frame = path.join(WORK, `thumb-${t.id}.png`);
    run(ffmpeg, ['-ss', at(t.clip, t.at).toFixed(3), '-i', indexed(ffmpeg, t.clip), '-frames:v', '1', frame]);
    let img = sharp(frame);
    if (t.zoom) {
      const w = Math.round(W / t.zoom), h = Math.round(H / t.zoom);
      img = img.extract({ left: Math.round((W - w) * (t.zx ?? 0.5)), top: Math.round((H - h) * (t.zy ?? 0.5)), width: w, height: h }).resize(W, H);
    }
    const base = await img.modulate({ saturation: 1.12 }).toBuffer();
    const out = path.join(OUT, t.file);
    const full = await sharp(base).composite(t.card ? [{ input: card(t.card) }] : []).png().toBuffer();   // (sharp resizes before it composites: two steps)
    await sharp(full).resize(1280, 720).jpeg({ quality: 90, mozjpeg: true }).toFile(out);
    console.log(`  ${path.relative(repo, out)}: 1280 x 720, ${(fs.statSync(out).size / 1e3).toFixed(0)} kB`);
  }
}

// ---------- shots.md: every clip, every cut ----------
if (want('shots')) {
  const lines = ['# Sim Clash trailer: shot list', '',
    'Made by `tools/release/trailer/` (`shoot.mjs` films, `build.mjs` cuts). Every picture and every sound is the game itself,',
    'captured from a hidden window on a private server; the swings were sent by a script through the game\'s Open Connect port',
    '(the way a launch monitor\'s software sends them). No music was added.', '',
    '## Raw clips', '', '| Clip | Scene | Length | Frame rate (page) | Swings and moments (seconds into the clip) |', '| --- | --- | --- | --- | --- |'];
  for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.json')).sort()) {
    const m = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    if (!m.marks || m.name === 'probe') continue;
    const what = m.marks.filter((k) => k.launch || k.label === 'banner' || /^(arm|winner|sudden|start)/.test(k.label)).map((k) => (k.launch
      ? `${k.t.toFixed(1)} **${k.label}** (${k.launch.speed} mph, launch ${k.launch.vla}, start ${k.launch.hla || 0}, spin ${k.launch.spin}, axis ${k.launch.spinAxis || 0})`
      : k.label === 'banner' ? `${k.t.toFixed(1)} banner "${String(k.text || '').replace(/\|/g, '/')}"` : `${k.t.toFixed(1)} ${k.label}`)).join('; ');
    lines.push(`| \`${m.name}\` | ${m.scene || ''}${m.stage ? ` (${m.stage})` : ''} | ${m.durationS.toFixed(1)} s | ${m.pageCadence.fps} fps, ${m.pageCadence.over50ms} gaps over 50 ms | ${what} |`);
  }
  const hms = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  for (const name of ['trailer', 'short']) {
    const segs = built[name] ? built[name].segs : resolve(CUT.timelines[name]);
    lines.push('', `## ${name === 'trailer' ? 'The trailer' : 'The short cut'} (${segs[segs.length - 1].end.toFixed(1)} s)`, '', '| At | Length | Clip | From | To | What |', '| --- | --- | --- | --- | --- | --- |');
    for (const s of segs) lines.push(`| ${hms(s.start)} | ${s.dur.toFixed(2)} | ${s.card ? `card \`${s.card}\`` : `\`${s.clip}\``} | ${s.card ? '' : `${s.in.toFixed(2)} (\`${s.from}\`)`} | ${s.card ? '' : `${s.out.toFixed(2)} (\`${s.to}\`)`} | ${s.note || ''} |`);
    const caps = (CUT.timelines[name].captions || []);
    if (caps.length) lines.push('', `Captions: ${caps.map((c) => `"${CUT.cardText[c.card] || c.card}" (over \`${c.on}\`)`).join('; ')}.`);
  }
  lines.push('', '## The loop', '', `\`${CUT.loop.clip}\` from \`${CUT.loop.from}\` to \`${CUT.loop.to}\`, silent, the end cross-faded into the start.`,
    '', '## Thumbnails', '', ...CUT.thumbnails.map((t) => `- \`${t.file}\`: \`${t.clip}\` at \`${t.at}\`${t.card ? `, lettering "${CUT.cardText[t.card] || t.card}"` : ''}`), '');
  fs.writeFileSync(path.join(OUT, 'shots.md'), lines.join('\n'));
  console.log(`  ${path.relative(repo, path.join(OUT, 'shots.md'))}`);
}

// ---------- review: look at every join and every caption ----------
if (REVIEW) {
  const dir = path.join(SCRATCH, 'review');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['trailer', 'short']) {
    const b = built[name];
    if (!b) continue;
    const times = [], labels = [];
    for (const s of b.segs) {
      if (s.i > 0) { times.push(Math.max(0, s.start - 1.5 / FPS)); labels.push(`${s.start.toFixed(2)} before cut ${s.i}`); }
      times.push(s.start + 1.5 / FPS); labels.push(`${s.start.toFixed(2)} after: ${s.note || s.clip || s.card}`.slice(0, 44));
    }
    for (const c of b.caps) { const mid = (c.t0 + c.t1) / 2; times.push(mid); labels.push(`${mid.toFixed(2)} caption (${(c.t1 - c.t0).toFixed(1)} s)`); }
    times.push(b.total - 0.5); labels.push('last half second');
    const files = times.map((t, i) => still(ffmpeg, b.outFile, t, path.join(dir, 'tmp', `${name}-${String(i).padStart(3, '0')}.jpg`), { width: 480 }));
    const per = 24;
    for (let k = 0; k * per < files.length; k++) {
      await sheet(path.join(dir, `${name}-cuts-${k + 1}.jpg`), files.slice(k * per, (k + 1) * per), { cols: 4, tw: 480, th: 270, labels: labels.slice(k * per, (k + 1) * per) });
    }
    for (const f of files) fs.unlinkSync(f);
    console.log(`  review sheets: ${path.relative(repo, dir)}/${name}-cuts-*.jpg`);
  }
}
