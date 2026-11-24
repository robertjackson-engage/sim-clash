'use strict';
// Preload of the trailer recorder's hidden window (tools/release/trailer/recorder.cjs).
// Runs in the page's own world (contextIsolation is off for this window only) BEFORE any
// game script, and does three things without touching a game file:
//
//  1. Sound never reaches a playback device. Every AudioContext the page makes is given
//     sinkId { type: 'none' } (Chromium renders it against no device at all), and every
//     connection to ctx.destination is re-pointed at a MediaStreamAudioDestinationNode
//     (the "tap"): the game's master output goes into the recording and nowhere else.
//     (The window is also muted by the main process, and the app runs with --mute-audio.)
//  2. Records the page: video from a capture of this very tab (the 3D canvas AND the DOM
//     HUD, as composited), audio from the tap, through the page's own MediaRecorder.
//     Chunks go to the main process, which writes the file.
//  3. Measures the frame cadence the page really rendered at while a clip was recording.
const { ipcRenderer } = require('electron');

const T = {
  ctx: null, tap: null, tapped: 0, sinkNone: null,
  display: null, recorder: null, clip: null, raf: null,
  mime: null,
};

// ---------- 1. the audio tap ----------
const OrigAC = window.AudioContext || window.webkitAudioContext;
if (OrigAC) {
  class TapAudioContext extends OrigAC {
    constructor(opts = {}) {
      let made = false;
      try { super({ ...opts, sinkId: { type: 'none' } }); made = true; } catch (_) { /* below */ }
      // (a constructor cannot call super() twice: a browser without sinkId 'none' throws
      // before `this` exists only for an unknown dictionary VALUE, never in Chromium 110+)
      if (!made) throw new Error('trailer preload: AudioContext({ sinkId: none }) is not supported');
      T.sinkNone = true;
      T.ctx = this;
      T.tap = this.createMediaStreamDestination();
      T.tap.channelCount = 2;
      this.__tap = T.tap;
      // an analyser on the tap: the level the recording gets, for the proof report
      T.analyser = this.createAnalyser();
      T.analyser.fftSize = 2048;
    }
  }
  window.AudioContext = TapAudioContext;
  window.webkitAudioContext = TapAudioContext;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest && this.context && dest === this.context.destination && this.context.__tap) {
      T.tapped++;
      try { connect.call(this, T.analyser); } catch (_) { /* level meter only */ }
      return connect.call(this, this.context.__tap, ...rest);
    }
    return connect.call(this, dest, ...rest);
  };
}
// nothing else may make a sound either
try { window.speechSynthesis && (window.speechSynthesis.speak = () => {}); } catch (_) { /* none */ }
const OrigPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () { this.muted = true; return OrigPlay.call(this); };

// ---------- 2. the recorder ----------
const MIMES = [
  'video/x-matroska;codecs=avc1.640033,opus',
  'video/x-matroska;codecs=avc1,opus',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
];

async function init({ fps = 60, width = 1920, height = 1080, mime = null } = {}) {
  if (!T.display) {
    T.display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps, max: fps } },
      audio: false,
    });
  }
  T.mime = mime || MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  const track = T.display.getVideoTracks()[0];
  return { mime: T.mime, supported: MIMES.filter((m) => MediaRecorder.isTypeSupported(m)), settings: track.getSettings(), audio: audioState() };
}

function audioState() {
  return { context: T.ctx ? T.ctx.state : 'none', sampleRate: T.ctx ? T.ctx.sampleRate : null, sinkId: T.ctx ? (typeof T.ctx.sinkId === 'object' ? T.ctx.sinkId && T.ctx.sinkId.type : T.ctx.sinkId) : null, tapped: T.tapped };
}

// the peak of the tap right now (0..1): what the recording is being fed
function tapPeak() {
  if (!T.analyser) return 0;
  const buf = new Float32Array(T.analyser.fftSize);
  T.analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  return peak;
}

function start(name, { videoBitsPerSecond = 40_000_000, audioBitsPerSecond = 256_000 } = {}) {
  if (T.recorder) throw new Error(`already recording ${T.clip.name}`);
  if (!T.display) throw new Error('init() first');
  const tracks = [T.display.getVideoTracks()[0]];
  const hasAudio = Boolean(T.tap);
  if (hasAudio) tracks.push(T.tap.stream.getAudioTracks()[0]);
  const mime = hasAudio ? T.mime : T.mime.replace(/,opus$/, '');
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond, audioBitsPerSecond });
  const clip = { name, mime, hasAudio, t0: 0, marks: [], bytes: 0, peak: 0, chain: Promise.resolve(), seq: 0 };
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const n = clip.seq++;
    clip.bytes += e.data.size;
    clip.chain = clip.chain.then(() => e.data.arrayBuffer()).then((ab) => ipcRenderer.send('trailer:chunk', name, n, new Uint8Array(ab)));
  };
  // the page's own frame cadence while this clip records
  const raf = { times: [], on: true };
  const tick = (t) => { if (!raf.on) return; raf.times.push(t); const p = tapPeak(); if (p > clip.peak) clip.peak = p; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  T.raf = raf;
  rec.start(500);
  clip.t0 = performance.now();
  clip.wall = Date.now();
  T.recorder = rec;
  T.clip = clip;
  ipcRenderer.send('trailer:begin', name, mime);
  return { name, mime, hasAudio };
}

function mark(label, extra) {
  if (!T.clip) return null;
  const t = Math.round(performance.now() - T.clip.t0) / 1000;
  T.clip.marks.push({ t, label, ...(extra || {}) });
  return t;
}

async function stop() {
  const rec = T.recorder, clip = T.clip, raf = T.raf;
  if (!rec) return null;
  const durationS = (performance.now() - clip.t0) / 1000;
  raf.on = false;
  await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
  await clip.chain;
  T.recorder = null; T.clip = null; T.raf = null;
  // cadence: frame-to-frame gaps of requestAnimationFrame
  const gaps = [];
  for (let i = 1; i < raf.times.length; i++) gaps.push(raf.times[i] - raf.times[i - 1]);
  gaps.sort((a, b) => a - b);
  const q = (p) => (gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] * 100) / 100 : null);
  const cadence = {
    frames: raf.times.length, fps: gaps.length ? Math.round(gaps.length / ((raf.times[raf.times.length - 1] - raf.times[0]) / 1000) * 100) / 100 : 0,
    gapMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) }, over25ms: gaps.filter((g) => g > 25).length, over50ms: gaps.filter((g) => g > 50).length,
  };
  const meta = { name: clip.name, mime: clip.mime, hasAudio: clip.hasAudio, durationS: Math.round(durationS * 1000) / 1000, startedAt: new Date(clip.wall).toISOString(), bytes: clip.bytes, marks: clip.marks, pageCadence: cadence, tapPeak: Math.round(clip.peak * 1000) / 1000, audio: audioState() };
  ipcRenderer.send('trailer:end', clip.name, meta);
  return meta;
}

window.__trailer = { init, start, stop, mark, audioState, tapPeak, get recording() { return T.clip ? T.clip.name : null; } };
