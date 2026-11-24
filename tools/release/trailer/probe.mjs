#!/usr/bin/env node
// Frame cadence of a recorded clip, read straight from the Matroska / WebM container (no
// ffmpeg): every video and audio block's timestamp.
//
//   node tools/release/trailer/probe.mjs <clip.mkv> [more clips...] [--json]
//
// Prints, per clip: duration, video frames, mean frame rate, the gaps between frames
// (median, 95th and 99th percentile, the longest), how many gaps were longer than one and a
// half and three frames of 60 fps, and the audio track's span.
import fs from 'node:fs';
import path from 'node:path';

const MASTERS = new Set([0x18538067, 0x1F43B675, 0x1654AE6B, 0xAE, 0xA0, 0x1549A966, 0xE0, 0xE1]);
const UNKNOWN = -1;

export function probe(file) {
  const buf = fs.readFileSync(file);
  let scaleNs = 1e6;
  const tracks = {};        // number -> { type, codec, width, height }
  const times = {};         // track number -> [ms]
  let cluster = 0;
  let cur = null;
  const vint = (pos, keepMarker) => {
    const first = buf[pos];
    if (first === undefined) return null;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) return null;
    let value = keepMarker ? first : first & (0xFF >> len);
    let allOnes = (first & (0xFF >> len)) === (0xFF >> len);
    for (let i = 1; i < len; i++) { const b = buf[pos + i]; value = value * 256 + b; if (b !== 0xFF) allOnes = false; }
    return { value: !keepMarker && allOnes ? UNKNOWN : value, len };
  };
  const uint = (pos, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[pos + i]; return v; };
  const walk = (start, end) => {
    let pos = start;
    while (pos < end) {
      const id = vint(pos, true);
      if (!id) return;
      const size = vint(pos + id.len, false);
      if (!size) return;
      const body = pos + id.len + size.len;
      const stop = size.value === UNKNOWN ? end : Math.min(end, body + size.value);
      switch (id.value) {
        case 0x2AD7B1: scaleNs = uint(body, size.value); break;
        case 0xE7: cluster = uint(body, size.value); break;
        case 0xAE: cur = {}; walk(body, stop); if (cur.number) tracks[cur.number] = cur; cur = null; break;
        case 0xD7: if (cur) cur.number = uint(body, size.value); break;
        case 0x83: if (cur) cur.type = uint(body, size.value) === 1 ? 'video' : uint(body, size.value) === 2 ? 'audio' : 'other'; break;
        case 0x86: if (cur) cur.codec = buf.toString('latin1', body, body + size.value); break;
        case 0xB0: if (cur) cur.width = uint(body, size.value); break;
        case 0xBA: if (cur) cur.height = uint(body, size.value); break;
        case 0xB5: if (cur) cur.sampleRate = size.value === 8 ? buf.readDoubleBE(body) : buf.readFloatBE(body); break;
        case 0xA3: case 0xA1: {
          const tn = vint(body, false);
          const rel = buf.readInt16BE(body + tn.len);
          (times[tn.value] ||= []).push((cluster + rel) * scaleNs / 1e6);
          break;
        }
        default: if (MASTERS.has(id.value)) walk(body, stop);
      }
      if (size.value === UNKNOWN) { if (!MASTERS.has(id.value)) return; pos = stop; } else pos = body + size.value;
    }
  };
  walk(0, buf.length);
  const out = { file: path.basename(file), bytes: buf.length, tracks: [] };
  for (const [n, t] of Object.entries(tracks)) {
    const ts = (times[n] || []).slice().sort((a, b) => a - b);
    const info = { ...t, blocks: ts.length, firstMs: ts[0] ?? null, lastMs: ts[ts.length - 1] ?? null };
    if (t.type === 'video' && ts.length > 1) {
      const gaps = [];
      for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
      const sorted = gaps.slice().sort((a, b) => a - b);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      info.fps = Math.round((ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000) * 100) / 100;
      info.gapMs = { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] };
      info.gapsOver25ms = gaps.filter((g) => g > 25).length;
      info.gapsOver50ms = gaps.filter((g) => g > 50).length;
      info.worst = gaps.map((g, i) => [g, ts[i]]).filter(([g]) => g > 50).slice(0, 12).map(([g, at]) => `${g} ms at ${(at / 1000).toFixed(2)} s`);
      out.durationS = Math.round((ts[ts.length - 1] - ts[0]) / 10) / 100;
    }
    out.tracks.push(info);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const f of files) {
    const r = probe(f);
    if (process.argv.includes('--json')) { console.log(JSON.stringify(r)); continue; }
    const v = r.tracks.find((t) => t.type === 'video'), a = r.tracks.find((t) => t.type === 'audio');
    console.log(`${r.file}: ${(r.bytes / 1e6).toFixed(1)} MB, ${r.durationS} s`
      + (v ? `; video ${v.codec} ${v.width}x${v.height}, ${v.blocks} frames, ${v.fps} fps, gaps p50 ${v.gapMs.p50} p95 ${v.gapMs.p95} p99 ${v.gapMs.p99} max ${v.gapMs.max} ms, >25 ms: ${v.gapsOver25ms}, >50 ms: ${v.gapsOver50ms}` : '; NO VIDEO')
      + (a ? `; audio ${a.codec} ${a.blocks} blocks ${(a.firstMs / 1000).toFixed(2)}-${(a.lastMs / 1000).toFixed(2)} s` : '; NO AUDIO'));
    if (v && v.worst && v.worst.length) console.log(`   longest gaps: ${v.worst.join(', ')}`);
  }
}
