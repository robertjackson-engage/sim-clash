// Audio plumbing for the arcade voice tools: decode, measure, trim, fade, normalise, encode.
// Pure Node (no ffmpeg needed). The two codecs are dev-only packages installed in THIS
// folder (`npm install --ignore-scripts` here): mpg123-decoder (WASM) and @breezystack/lamejs.
//
// A clip is { ch: [Float32Array, ...], sr }.

import { Mp3Encoder } from '@breezystack/lamejs';
import { MPEGDecoder } from 'mpg123-decoder';

export const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
export const lin = (d) => 10 ** (d / 20);

let decoderPromise = null;
async function decoder() {
  if (!decoderPromise) {
    decoderPromise = (async () => { const d = new MPEGDecoder(); await d.ready; return d; })();
  }
  return decoderPromise;
}

/** Decode an mp3 (Buffer / Uint8Array). Throws when nothing decodes. */
export async function decodeMp3(bytes) {
  const d = await decoder();
  await d.reset();
  const out = d.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!out || !out.samplesDecoded || !out.channelData || !out.channelData.length) {
    throw new Error('mp3 did not decode');
  }
  const errors = Array.isArray(out.errors) ? out.errors.length : 0;
  let ch = out.channelData.map((c) => Float32Array.from(c));
  // the decoder always hands back two channels: a mono file is one channel, twice
  if (ch.length === 2 && mp3Info(bytes).channels === 1) ch = [ch[0]];
  return { ch, sr: out.sampleRate, errors };
}

/** Header facts of the first MPEG audio frame: { channels, sampleRate, kbps, frames } (zeros if none). */
export function mp3Info(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let i = 0;
  // skip an ID3v2 tag
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  let first = null;
  let frames = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3;      // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
    const layer = (b[i + 1] >> 1) & 3;    // 1 = layer III
    const br = (b[i + 2] >> 4) & 15;
    const sri = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sri === 3) { i++; continue; }
    const sampleRate = RATES[ver][sri];
    const kbps = (ver === 3 ? KBPS_V1 : KBPS_V2)[br];
    const pad = (b[i + 2] >> 1) & 1;
    const len = Math.floor(((ver === 3 ? 144000 : 72000) * kbps) / sampleRate) + pad;
    if (len < 24) { i++; continue; }
    if (!first) first = { channels: ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2, sampleRate, kbps };
    frames++;
    i += len;
  }
  return first ? { ...first, frames } : { channels: 0, sampleRate: 0, kbps: 0, frames: 0 };
}

/** Raw signed 16-bit little-endian PCM (what output_format=pcm_* returns), mono. */
export function pcm16ToClip(bytes, sr) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const n = Math.floor(buf.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  return { ch: [x], sr };
}

export function toMono(clip) {
  if (clip.ch.length === 1) return clip;
  const n = clip.ch[0].length;
  const x = new Float32Array(n);
  for (const c of clip.ch) for (let i = 0; i < n; i++) x[i] += c[i] / clip.ch.length;
  return { ch: [x], sr: clip.sr };
}

/** Windowed-sinc resampler (Blackman, 24 zero crossings a side). Fine for short clips. */
export function resample(clip, to) {
  if (clip.sr === to) return clip;
  const ratio = to / clip.sr;
  const cutoff = Math.min(1, ratio) * 0.97;
  const half = 24;
  const ch = clip.ch.map((x) => {
    const n = Math.floor(x.length * ratio);
    const y = new Float32Array(n);
    const span = half / cutoff;
    for (let i = 0; i < n; i++) {
      const pos = i / ratio;
      const lo = Math.max(0, Math.ceil(pos - span));
      const hi = Math.min(x.length - 1, Math.floor(pos + span));
      let acc = 0;
      for (let k = lo; k <= hi; k++) {
        const t = (k - pos) * cutoff;
        const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
        const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
        acc += x[k] * s * w;
      }
      y[i] = acc * cutoff;
    }
    return y;
  });
  return { ch, sr: to };
}

export function peak(clip) {
  let p = 0;
  for (const c of clip.ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; }
  return p;
}

export function gain(clip, g) {
  return { ch: clip.ch.map((c) => c.map((v) => v * g)), sr: clip.sr };
}

/** Per-window (default 5 ms) peak envelope across channels. */
function envelope(clip, winMs = 5) {
  const w = Math.max(1, Math.round((clip.sr * winMs) / 1000));
  const n = clip.ch[0].length;
  const env = new Float32Array(Math.ceil(n / w));
  for (const c of clip.ch) {
    for (let i = 0; i < n; i++) { const a = Math.abs(c[i]); const k = (i / w) | 0; if (a > env[k]) env[k] = a; }
  }
  return { env, w };
}

/**
 * Where the sound starts and ends: the first and last 5 ms window louder than the
 * threshold (relative to the clip's peak, with an absolute floor). Returns samples.
 */
export function activeRange(clip, { relDb = -42, floorDb = -60 } = {}) {
  const { env, w } = envelope(clip);
  const pk = peak(clip);
  const thr = Math.max(pk * lin(relDb), lin(floorDb));
  let a = 0;
  let b = env.length - 1;
  while (a < env.length && env[a] < thr) a++;
  while (b > a && env[b] < thr) b--;
  const n = clip.ch[0].length;
  if (a >= env.length) return { start: 0, end: 0, silent: true };
  return { start: a * w, end: Math.min(n, (b + 1) * w), silent: false };
}

/**
 * Silent stretches INSIDE the sound (between its first and last loud window) of at least
 * minMs, in seconds: [{ atS, lengthS }]. A long hole in a two-word shout usually means
 * the voice said something extra.
 */
export function gaps(clip, { relDb = -38, floorDb = -60, minMs = 300 } = {}) {
  const { env, w } = envelope(clip);
  const pk = peak(clip);
  const thr = Math.max(pk * lin(relDb), lin(floorDb));
  let a = 0;
  let b = env.length - 1;
  while (a < env.length && env[a] < thr) a++;
  while (b > a && env[b] < thr) b--;
  const out = [];
  let run = 0;
  for (let i = a; i <= b; i++) {
    if (env[i] < thr) { run++; continue; }
    if ((run * w * 1000) / clip.sr >= minMs) out.push({ atS: ((i - run) * w) / clip.sr, lengthS: (run * w) / clip.sr });
    run = 0;
  }
  return out;
}

export function slice(clip, start, end) {
  const n = clip.ch[0].length;
  const a = Math.max(0, Math.min(n, Math.round(start)));
  const b = Math.max(a, Math.min(n, Math.round(end)));
  return { ch: clip.ch.map((c) => c.slice(a, b)), sr: clip.sr };
}

/** Cut the silence off both ends, keeping a little air (padStartMs before, padEndMs after). */
export function trim(clip, { relDb = -42, floorDb = -60, padStartMs = 6, padEndMs = 60 } = {}) {
  const r = activeRange(clip, { relDb, floorDb });
  if (r.silent) return slice(clip, 0, 0);
  return slice(clip, r.start - (clip.sr * padStartMs) / 1000, r.end + (clip.sr * padEndMs) / 1000);
}

/** Raised-cosine fades in place on a copy. */
export function fade(clip, { inMs = 3, outMs = 30 } = {}) {
  const out = { ch: clip.ch.map((c) => Float32Array.from(c)), sr: clip.sr };
  const n = out.ch[0].length;
  const ni = Math.min(n, Math.round((clip.sr * inMs) / 1000));
  const no = Math.min(n, Math.round((clip.sr * outMs) / 1000));
  for (const c of out.ch) {
    for (let i = 0; i < ni; i++) c[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ni);
    for (let i = 0; i < no; i++) c[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / no);
  }
  return out;
}

// ---- loudness (ITU-R BS.1770 K-weighting, 400 ms blocks, absolute and relative gates) ----

function kWeight(x, sr) {
  // stage 1: high shelf (+4 dB above ~1.7 kHz); stage 2: high-pass (~38 Hz)
  const biquad = (inp, b0, b1, b2, a1, a2) => {
    const y = new Float64Array(inp.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < inp.length; i++) {
      const v = b0 * inp[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = inp[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

/** Integrated loudness in LUFS. Clips shorter than one 400 ms block are measured whole (ungated). */
export function lufs(clip) {
  const sr = clip.sr;
  const n = clip.ch[0].length;
  if (!n) return -Infinity;
  const weighted = clip.ch.map((c) => kWeight(c, sr));
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const power = (a, b) => {
    let sum = 0;
    for (const w of weighted) { let s = 0; for (let i = a; i < b; i++) s += w[i] * w[i]; sum += s / (b - a); }
    return sum;
  };
  const toL = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
  if (n < block) return toL(power(0, n));
  const powers = [];
  for (let a = 0; a + block <= n; a += hop) powers.push(power(a, a + block));
  const abs = powers.filter((p) => toL(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = toL(abs.reduce((s, p) => s + p, 0) / abs.length) - 10;
  const kept = abs.filter((p) => toL(p) > rel);
  if (!kept.length) return -Infinity;
  return toL(kept.reduce((s, p) => s + p, 0) / kept.length);
}

/**
 * Look-ahead peak limiter: nothing leaves above `ceiling` (linear), with a 4 ms look-ahead
 * so the gain is already down when the peak arrives, and a ~90 ms release.
 */
export function limit(clip, ceiling) {
  const n = clip.ch[0].length;
  const L = Math.max(1, Math.round(clip.sr * 0.004));
  const raw = new Float32Array(n).fill(1);
  let touched = false;
  for (const c of clip.ch) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(c[i]);
      if (a > ceiling) { const g = ceiling / a; if (g < raw[i]) raw[i] = g; touched = true; }
    }
  }
  if (!touched) return clip;
  // minimum over [i - L, i + L]
  const mn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    const a = Math.max(0, i - L);
    const b = Math.min(n - 1, i + L);
    for (let k = a; k <= b; k++) if (raw[k] < m) m = raw[k];
    mn[i] = m;
  }
  // exponential release back toward 1
  const rel = 1 - Math.exp(-1 / (clip.sr * 0.09));
  const sm = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) { g = Math.min(mn[i], g + (1 - g) * rel); sm[i] = g; }
  // box filter of length L (still never above the raw requirement, see mn's window)
  const half = L >> 1;
  const out = clip.ch.map((c) => new Float32Array(n));
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { acc += sm[i]; pre[i + 1] = acc; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const gi = (pre[b] - pre[a]) / (b - a);
    for (let k = 0; k < clip.ch.length; k++) out[k][i] = clip.ch[k][i] * gi;
  }
  return { ch: out, sr: clip.sr };
}

/**
 * Bring a clip to a target loudness under a peak ceiling. The limiter takes a little
 * loudness away, so the gain is re-trimmed twice.
 */
export function normalise(clip, { targetLufs = -16, peakDb = -1.5, maxGainDb = 30 } = {}) {
  const ceiling = lin(peakDb);
  let out = clip;
  for (let pass = 0; pass < 3; pass++) {
    const l = lufs(out);
    if (!Number.isFinite(l)) return out;
    const g = Math.min(maxGainDb, targetLufs - l);
    if (Math.abs(g) < 0.05 && peak(out) <= ceiling) break;
    out = limit(gain(out, lin(g)), ceiling);
  }
  return out;
}

/** mp3 bytes (constant bit rate; mono or stereo). */
export function encodeMp3(clip, kbps = 128) {
  const chans = Math.min(2, clip.ch.length);
  const enc = new Mp3Encoder(chans, clip.sr, kbps);
  const n = clip.ch[0].length;
  const toInt = (x) => {
    const o = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const v = Math.max(-1, Math.min(1, x[i]));
      o[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    }
    return o;
  };
  const left = toInt(clip.ch[0]);
  const right = chans === 2 ? toInt(clip.ch[1]) : null;
  const parts = [];
  const step = 1152;
  for (let i = 0; i < n; i += step) {
    const l = left.subarray(i, i + step);
    const buf = right ? enc.encodeBuffer(l, right.subarray(i, i + step)) : enc.encodeBuffer(l);
    if (buf.length) parts.push(Buffer.from(buf));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

/** The numbers check.mjs reports for a clip. */
export function measure(clip) {
  const n = clip.ch[0].length;
  const r = activeRange(clip, { relDb: -42, floorDb: -60 });
  const pk = peak(clip);
  let over = 0;
  for (const c of clip.ch) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.999) over++;
  // level of the last 10 ms: a clean tail ends near silence
  const tailN = Math.min(n, Math.round(clip.sr * 0.01));
  let tailPk = 0;
  for (const c of clip.ch) for (let i = n - tailN; i < n; i++) { const a = Math.abs(c[i]); if (a > tailPk) tailPk = a; }
  return {
    durationS: n / clip.sr,
    sampleRate: clip.sr,
    channels: clip.ch.length,
    peakDb: db(pk),
    lufs: lufs(clip),
    leadMs: r.silent ? (n / clip.sr) * 1000 : (r.start / clip.sr) * 1000,
    tailMs: r.silent ? 0 : ((n - r.end) / clip.sr) * 1000,
    activeS: r.silent ? 0 : (r.end - r.start) / clip.sr,
    endDb: db(tailPk),
    clipped: over,
    silent: r.silent,
  };
}

// ---- other containers (the free sound packs are wav and ogg) --------------------------------

/** Decode a RIFF/WAVE file: PCM 8/16/24/32 bit or 32-bit float. */
export function decodeWav(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a wav file');
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('latin1', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(body);
      if (tag === 0xfffe && size >= 26) tag = b.readUInt16LE(body + 24);   // WAVE_FORMAT_EXTENSIBLE
      fmt = { tag, channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(b.length, body + size));
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('wav without fmt or data');
  if (fmt.tag !== 1 && fmt.tag !== 3) throw new Error(`wav format ${fmt.tag} is not PCM`);
  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytesPer * fmt.channels));
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytesPer;
      let v;
      if (fmt.tag === 3) v = fmt.bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o);
      else if (fmt.bits === 8) v = (data[o] - 128) / 128;
      else if (fmt.bits === 16) v = data.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      ch[c][i] = v;
    }
  }
  return { ch, sr: fmt.sr, errors: 0 };
}

let vorbisPromise = null;
/** Decode an Ogg Vorbis file. */
export async function decodeOgg(bytes) {
  if (!vorbisPromise) {
    vorbisPromise = (async () => {
      const { OggVorbisDecoder } = await import('@wasm-audio-decoders/ogg-vorbis');
      const d = new OggVorbisDecoder();
      await d.ready;
      return d;
    })();
  }
  const d = await vorbisPromise;
  await d.reset();
  const out = await d.decodeFile(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!out || !out.samplesDecoded) throw new Error('ogg did not decode');
  return { ch: out.channelData.map((c) => Float32Array.from(c)), sr: out.sampleRate, errors: Array.isArray(out.errors) ? out.errors.length : 0 };
}

/** Decode wav, ogg vorbis or mp3 by its first bytes. */
export async function decodeAny(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const magic = b.toString('latin1', 0, 4);
  if (magic === 'RIFF') return decodeWav(b);
  if (magic === 'OggS') return decodeOgg(b);
  if (magic === 'fLaC') throw new Error('flac is not supported');
  return decodeMp3(b);
}

// ---- features (for choosing between candidates nobody here can listen to) --------------------

/** Radix-2 FFT of real input; returns the magnitudes of the first n/2 bins. */
export function spectrum(x) {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/**
 * What a clip sounds like, in numbers: energy by band (fraction of the total), spectral
 * centroid (Hz), how fast it starts (attackMs: from 10 % to 90 % of its peak level) and how
 * its level moves (crestDb: peak over RMS).
 */
export function features(clip) {
  const x = toMono(clip).ch[0];
  const sr = clip.sr;
  const N = 2048;
  const bands = { sub: [20, 120], low: [120, 500], mid: [500, 2000], high: [2000, 6000], air: [6000, 16000] };
  const e = { sub: 0, low: 0, mid: 0, high: 0, air: 0 };
  let cNum = 0;
  let cDen = 0;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const padded = x.length < N ? (() => { const p = new Float32Array(N); p.set(x); return p; })() : x;
  for (let a = 0; a + N <= padded.length; a += N / 2) {
    const frame = new Float64Array(N);
    for (let i = 0; i < N; i++) frame[i] = padded[a + i] * win[i];
    const mag = spectrum(frame);
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sr) / N;
      const p = mag[k] * mag[k];
      cNum += f * p; cDen += p;
      for (const [name, [lo, hi]] of Object.entries(bands)) if (f >= lo && f < hi) e[name] += p;
    }
  }
  const total = Object.values(e).reduce((s, v) => s + v, 0) || 1;
  for (const k of Object.keys(e)) e[k] /= total;
  const w = Math.max(1, Math.round(sr * 0.002));   // envelope in 2 ms windows
  const env = [];
  for (let a = 0; a < x.length; a += w) { let m = 0; for (let i = a; i < Math.min(x.length, a + w); i++) m = Math.max(m, Math.abs(x[i])); env.push(m); }
  let pk = 1e-9;
  for (const v of env) if (v > pk) pk = v;
  const i10 = env.findIndex((v) => v >= 0.1 * pk);
  const i90 = env.findIndex((v) => v >= 0.9 * pk);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / Math.max(1, x.length));
  return { bands: e, centroidHz: cDen ? cNum / cDen : 0, attackMs: (i90 - i10) * 2, peakAtS: (i90 * w) / sr, crestDb: db(pk / (rms || 1e-9)) };
}

/** Voice pitch: median F0 (Hz), its spread in semitones, the share of voiced frames, the 95th percentile. */
export function pitch(clip) {
  const src = toMono(clip);
  const x = (src.sr > 16000 ? resample(src, 16000) : src).ch[0];
  const sr = src.sr > 16000 ? 16000 : src.sr;
  const frame = Math.round(sr * 0.04);
  const hop = Math.round(sr * 0.02);
  const minLag = Math.floor(sr / 420);
  const maxLag = Math.floor(sr / 60);
  const f0 = [];
  let frames = 0;
  let pkAll = 0;
  for (let i = 0; i < x.length; i++) pkAll = Math.max(pkAll, Math.abs(x[i]));
  for (let a = 0; a + frame + maxLag < x.length; a += hop) {
    let e0 = 0;
    for (let i = 0; i < frame; i++) e0 += x[a + i] * x[a + i];
    if (Math.sqrt(e0 / frame) < pkAll * 0.05) continue;
    frames++;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let e1 = 0;
      for (let i = 0; i < frame; i++) { c += x[a + i] * x[a + i + lag]; e1 += x[a + i + lag] * x[a + i + lag]; }
      const r = c / Math.sqrt(e0 * e1 + 1e-12);
      if (r > best * 1.03) { best = r; bestLag = lag; }   // prefer the shorter lag unless clearly better
    }
    if (best > 0.55 && bestLag) f0.push(sr / bestLag);
  }
  if (!f0.length) return { medianHz: 0, spreadSt: 0, voiced: 0, p95Hz: 0 };
  const s = [...f0].sort((p, q) => p - q);
  const med = s[s.length >> 1];
  const st = f0.map((f) => 12 * Math.log2(f / med));
  const sd = Math.sqrt(st.reduce((t, v) => t + v * v, 0) / st.length);
  return { medianHz: med, spreadSt: sd, voiced: f0.length / Math.max(1, frames), p95Hz: s[Math.floor(s.length * 0.95)] };
}
