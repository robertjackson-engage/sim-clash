'use strict';
// The second sound pass (docs/arcade-voice.md): every cue name and announcer line id the
// game's own code can ask for either has a file, or is on an explicit list here with the
// reason it has none; and the mix rules for the gadget and living-world cues, under a fake
// Web Audio (no sound is ever made).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO = path.join(__dirname, '..');
const PUBLIC = path.join(REPO, 'public');
const mod = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const audioMod = () => mod('public/arcade/audio.js');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));

// ───────────────── cues the game calls that have NO file, on purpose ─────────────────
// Each still sounds: audio.js synthesizes it. A cue leaves this list by gaining a file.
const SYNTHESIZED = {
  good: 'a single small chime under a GOOD callout: the synthesized one is in tune with nothing and needs to be',
  ok: 'a tick; an ordinary shot gets no sting at all, so it is almost never heard',
  miss: 'two falling notes: small, clean, and already what it should be',
  'slowmo-in': 'time bending down: a pitch glide is what a synthesizer does best, and it follows the cue intensity',
  'slowmo-out': 'the mirror image of slowmo-in',
  // not called by the game any more (arm-common / coin-burst / streak-up replaced them); they
  // remain as the stand-ins those cues fall back to if their files go missing
  armed: 'legacy, uncalled: the fallback behind arm-common',
  coins: 'legacy, uncalled: the fallback behind coin-burst',
  streak: 'legacy, uncalled',
};
// Cue names the code may ask for that are silent by design: none today.
const SILENT = {};

// ───────────────── reading the call sites out of the source ─────────────────

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const clientFiles = () => walk(PUBLIC)
  .filter((f) => f.endsWith('.js') && !/[\\/](vendor|node_modules|sfx|voice)[\\/]/.test(f) && path.basename(f) !== 'audio.js')
  .map((f) => ({ rel: path.relative(REPO, f).replace(/\\/g, '/'), src: fs.readFileSync(f, 'utf8') }));

/** The source text from `at` up to the first of `stops` outside any bracket or string. */
function span(src, at, stops) {
  let depth = 0;
  let quote = null;
  for (let i = at; i < src.length && i < at + 900; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return src.slice(at, i); depth--; } else if (depth === 0 && stops.includes(c)) return src.slice(at, i);
  }
  return src.slice(at, Math.min(src.length, at + 900));
}
/** The ids written in a piece of source: plain ones, and `prefix-${x}suffix` families. */
function idsIn(text) {
  const t = text.replace(/[!=]==?\s*(['"])[^'"]*\1/g, ' ').replace(/(['"])[^'"]*\1\s*[!=]==?/g, ' ');   // a compared string is not an id
  const ids = [...t.matchAll(/(['"])([a-z0-9]+(?:-[a-z0-9]+)*)\1/g)].map((m) => m[2]);
  const families = [...t.matchAll(/`([a-z0-9-]*)\$\{[^}]*\}([a-z0-9-]*)`/g)].map((m) => `${m[1]}*${m[2]}`);
  return { ids, families };
}
function collect(files, patterns, stops) {
  const found = new Map();   // id -> first place seen
  const families = new Map();
  for (const { rel, src } of files) {
    for (const rx of patterns) {
      for (const m of src.matchAll(rx)) {
        const got = idsIn(span(src, m.index + m[0].length, stops));
        for (const id of got.ids) if (!found.has(id)) found.set(id, rel);
        for (const f of got.families) if (!families.has(f)) families.set(f, rel);
      }
    }
  }
  return { found, families };
}

test('cues: every cue the game asks for by name has a recording, or is on the synthesized list with a reason', async () => {
  const { CUE_CATEGORY, CUE_NAMES, SAMPLE_CUE_NAMES, SYNTH_CUE_NAMES } = await audioMod();
  const manifest = readJson('public/arcade/sfx/manifest.json');
  const files = clientFiles();
  // audio.cue('x'), this._cue(a ? 'x' : 'y', ...), a local cue('x'): the first argument
  const calls = collect(files, [/(?:\b_cue|\.cue|\bcue)\??\.?\(/g], [',']);
  // moment({ impact, sting, crowd }) and the tables that name a cue ({ kind: 'cue', cue: 'gasp' }, GRADES)
  const stacks = collect(files.filter((f) => /(?:_moment|\.moment)\(|kind: 'cue'/.test(f.src)), [/\b(?:impact|sting|crowd|cue)\s*:\s*/g], [',']);
  const { GADGET_CUES } = await mod('public/render/gadget-core.js');
  const { LIVING_CUES, REACTIONS } = await mod('public/render/world-life.js');
  const asked = new Map([...stacks.found, ...calls.found]);
  for (const c of GADGET_CUES) asked.set(c, 'public/render/gadget-core.js');
  for (const c of LIVING_CUES) asked.set(c, 'public/render/world-life.js');
  assert.ok(asked.size > 60, `the scan found the game's cues (${asked.size})`);
  for (const must of ['strike', 'ui-tick', 'crowd-ohh', 'fanfare-win', 'vs-slam', 'jackpot', 'gasp', 'slowmo-in', 'gadget-coin', 'world-finale']) assert.ok(asked.has(must), `the scan sees ${must}`);

  const noFile = [];
  for (const [name, where] of asked) {
    if (SILENT[name]) continue;
    assert.ok(CUE_CATEGORY[name], `${name} (${where}) is a cue audio.js knows: an unknown name is silent`);
    const e = manifest.cues[name];
    if (e && e.files.length) { for (const f of e.files) assert.ok(fs.existsSync(path.join(PUBLIC, 'arcade', 'sfx', f)), `${f} is on disk`); continue; }
    noFile.push(name);
    assert.ok(SYNTHESIZED[name], `${name} (${where}) has no recording and is not on the synthesized list`);
  }
  // families: `arm-${tier}` and a stage's own sting (which falls back to stage-sting)
  for (const [fam] of [...calls.families, ...stacks.families]) {
    if (fam === 'arm-*') { for (const tier of ['common', 'rare', 'epic']) assert.ok(manifest.cues[`arm-${tier}`], `arm-${tier}`); } else assert.equal(fam, 'stage-sting-*', `an unexpected family of cues: ${fam}`);
  }
  // the list is honest: everything on it is a known cue with a synthesizer and no file, and
  // it is exactly the set of cues that have no file
  for (const name of Object.keys(SYNTHESIZED)) {
    assert.ok(SYNTH_CUE_NAMES.includes(name), `${name} has a synthesizer`);
    assert.ok(!manifest.cues[name], `${name} has a recording now: take it off the synthesized list`);
    assert.ok(SYNTHESIZED[name].length > 10, `${name} says why`);
  }
  assert.deepEqual(CUE_NAMES.filter((n) => !manifest.cues[n]).sort(), Object.keys(SYNTHESIZED).sort(), 'every cue without a file is accounted for');
  assert.deepEqual(noFile.sort(), ['good', 'miss', 'ok', 'slowmo-in', 'slowmo-out'], 'what the game still plays from the synthesizer');
  assert.deepEqual(Object.keys(SILENT), [], 'nothing the game asks for is silent');

  // the gadget and living-world tables, name by name: a recording each, none borrowed
  for (const c of [...GADGET_CUES, ...LIVING_CUES]) {
    assert.ok(SAMPLE_CUE_NAMES.includes(c), `${c} is a recording, not a synthesizer`);
    assert.ok(manifest.cues[c] && !manifest.cues[c].alias, `${c} has its own file`);
  }
  for (const c of LIVING_CUES) assert.equal(CUE_CATEGORY[c], 'world', `${c} is mixed as the world`);
  for (const r of Object.values(REACTIONS)) if (r.cue) assert.equal(CUE_CATEGORY[r.cue], 'world');
  for (const [c, cat] of Object.entries({ 'gadget-pad': 'impact', 'gadget-bumper': 'impact', 'gadget-break': 'impact', 'gadget-thud': 'impact',
    'gadget-ring': 'feel', 'gadget-coin': 'feel', 'gadget-warp': 'feel', 'gadget-geyser': 'feel', 'gadget-strip': 'feel', 'gadget-fan': 'feel', 'gadget-zone': 'feel' })) {
    assert.equal(CUE_CATEGORY[c], cat, `${c} is mixed as ${cat}`);
  }
  // takes where a sound comes round: coins and bumpers three, a full trail and the x3 zone and the warp's exit their own
  assert.equal(manifest.cues['gadget-coin'].files.length, 3);
  assert.deepEqual(manifest.cues['gadget-coin'].hard, ['gadget-coin-hard.mp3']);
  assert.equal(manifest.cues['gadget-bumper'].files.length, 3);
  assert.deepEqual(manifest.cues['gadget-zone'].hard, ['gadget-zone-hard.mp3']);
  assert.deepEqual(manifest.cues['gadget-warp'].hard, ['gadget-warp-hard.mp3']);
  // the ids docs/modes.md asks for (Bullseye, the duel, the replays) are ready for their callers
  for (const c of ['be-thunk', 'be-bull', 'be-bust', 'be-checkout', 'dl-call', 'dl-letter', 'dl-matched', 'dl-no-call', 'replay-in', 'replay-out', 'replay-offer']) {
    assert.ok(CUE_CATEGORY[c] && manifest.cues[c], `${c} is registered and has a file`);
  }
});

test('announcer: every line id the game asks for is in the shipped pack', async (t) => {
  const { LINES, STAGES, POWERUPS } = await mod('tools/arcade-voice/lines.mjs');
  const pack = readJson('public/arcade/voice/announcer/manifest.json');
  const has = (id) => !!pack.lines[id] && pack.lines[id].files.every((f) => fs.existsSync(path.join(PUBLIC, 'arcade', 'voice', 'announcer', f)));
  const files = clientFiles().filter((f) => /^public\/(arcade\/|app\.js)/.test(f.rel));
  const calls = collect(files, [/(?:\b_say|\.say)\??\.?\(/g, /\bline\.push\(/g], []);
  const props = collect(files, [/\bsay\s*:\s*/g, /\bvoice\s*[:=]\s*/g, /\bfallback\s*:\s*/g], [',', ';']);
  const asked = new Map([...props.found, ...calls.found]);
  t.diagnostic(`line ids written in the client: ${[...asked.keys()].sort().join(' ')}`);
  assert.ok(asked.size >= 30, `the scan found the game's lines (${asked.size})`);
  for (const must of ['m-versus', 'm-knockout', 'm-for-the-win', 'm-to-tie', 'p-skins', 'p-to-stay-alive', 'p-for-the-skins', 'p-takes-the-skin', 'p-skin-carries',
    'p-is-out', 'p-the-final', 'p-farthest-is-out', 'p-wins-the-game', 'p-stroke-race', 'p-elimination', 'm-new-record',
    // Bullseye, the duel and the replays call their own lines now (docs/arcade-voice.md, "Bullseye, the duel, replays")
    'be-bullseye', 'be-double', 'be-treble', 'be-bust', 'be-check-out', 'be-can-anyone-answer', 'be-nearest-the-pin',
    'dl-call-your-shot', 'dl-match-it', 'dl-matched', 'dl-letter', 'dl-one-letter-left', 'dl-spelled-it', 'dl-no-call',
    'm-replay', 'm-shot-of-the-match', 'm-highlights']) assert.ok(asked.has(must), `the scan sees ${must}`);
  for (const [id, where] of asked) assert.ok(has(id), `${id} (${where}) is in the pack`);
  // the families built at run time
  const families = new Set([...calls.families.keys(), ...props.families.keys()]);
  for (const fam of families) assert.ok(['stage-*', 'm-hole-*', 'pu-*', 'm-player-*', 'm-player-*-wins'].includes(fam), `an unexpected family of lines: ${fam}`);
  for (const fam of ['stage-*', 'm-hole-*', 'pu-*', 'm-player-*', 'm-player-*-wins']) assert.ok(families.has(fam), `the scan sees ${fam}`);
  for (const [id] of STAGES) assert.ok(has(`stage-${id}`), `stage-${id}`);
  for (const [id] of POWERUPS) assert.ok(has(`pu-${id}`), `pu-${id}`);
  for (let n = 1; n <= 9; n++) assert.ok(has(`m-hole-${n}`), `m-hole-${n}`);
  for (let slot = 1; slot <= 4; slot++) { assert.ok(has(`m-player-${slot}`), `m-player-${slot}`); assert.ok(has(`m-player-${slot}-wins`), `m-player-${slot}-wins`); }
  // Bullseye's round lines are picked from a table (public/arcade/bullseye.js _turn), which the scan does not read
  for (const id of ['be-round-2', 'be-round-3', 'be-round-4', 'be-round-5', 'be-round-6', 'be-final-round']) assert.ok(has(id), id);
  // callouts are said by the id the server sends (lib/arcade.js, lib/gadgets.js)
  const arcade = require('../lib/arcade.js');
  for (const table of [arcade.CALLOUTS, arcade.GADGET_CALLOUTS]) for (const [id, c] of Object.entries(table)) assert.ok(has((c && c.voice) || id), `callout ${id}`);
  // and the putt / chip-in lines the brief asked about
  for (const id of ['m-for-the-win', 'm-to-tie', 'm-putt-in-to-win', 'm-chip-in-to-win', 'm-putt-in-to-tie', 'm-chip-in-to-tie']) assert.ok(has(id), id);
  // every line of the catalogue is spoken, with two takes or three
  for (const l of LINES) {
    assert.ok(has(l.id), `${l.id} is in the pack`);
    assert.ok(pack.lines[l.id].files.length >= 2, `${l.id} has ${pack.lines[l.id].files.length} take(s)`);
  }
});

// ───────────────────────── the mix, under a fake Web Audio ─────────────────────────

function fakePage(files) {
  const made = { sources: [], gains: [], oscs: [] };
  const param = (value = 0) => ({ value, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.target = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => ({ to: [], connect(n) { this.to.push(n); return n; }, disconnect() { this.to = []; }, ...extra });
  class Ctx {
    constructor() { this.currentTime = 10; this.state = 'running'; this.sampleRate = 48000; this.destination = node(); Ctx.last = this; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { const g = node({ gain: param(1) }); made.gains.push(g); return g; }
    createWaveShaper() { return node({ curve: null }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createConvolver() { return node({ buffer: null }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(), Q: param() }); }
    createOscillator() { const o = node({ type: 'sine', frequency: param(), detune: param(), started: null, start(t) { this.started = t; }, stop() {} }); made.oscs.push(o); return o; }
    createBuffer(ch, n, sr) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / sr, sampleRate: sr, getChannelData: (c) => d[c] }; }
    createBufferSource() { const s = node({ buffer: null, loop: false, playbackRate: param(1), started: null, start(t) { this.started = { t }; }, stop(t) { this.stopped = t; } }); made.sources.push(s); return s; }
    decodeAudioData(ab) { const name = Buffer.from(ab).toString('utf8'); return Promise.resolve({ name, duration: 1.5, sampleRate: 48000, getChannelData: () => new Float32Array(4800) }); }
  }
  const prev = { window: globalThis.window, fetch: globalThis.fetch };
  globalThis.window = { AudioContext: Ctx, addEventListener() {}, removeEventListener() {}, location: { search: '' } };
  globalThis.fetch = async (url) => {
    const body = files[String(url)];
    if (body == null) return { ok: false, status: 404, headers: { get: () => 'text/plain' }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const isJson = typeof body === 'object';
    const buf = Buffer.from(isJson ? JSON.stringify(body) : body);
    return { ok: true, status: 200, headers: { get: () => (isJson ? 'application/json' : 'audio/mpeg') }, json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
  const restore = () => { if (prev.window === undefined) delete globalThis.window; else globalThis.window = prev.window; globalThis.fetch = prev.fetch; };
  return { Ctx, made, restore };
}
const tick = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/** A fake site serving the real sfx manifest, every file answering with its own name. */
function shippedSfx(drop = []) {
  const manifest = readJson('public/arcade/sfx/manifest.json');
  const files = { '/arcade/sfx/manifest.json': manifest };
  for (const e of Object.values(manifest.cues)) for (const f of [...e.files, ...(e.hard || [])]) if (!drop.some((rx) => rx.test(f))) files[`/arcade/sfx/${f}`] = f.replace(/\.mp3$/, '');
  return files;
}

test('mix: the living world plays under the moment it answers: its own quiet bus, one beat at a time, never the crowd', async (t) => {
  const page = fakePage(shippedSfx());
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const played = () => page.made.sources.filter((s) => s.started && s.buffer && typeof s.buffer.name === 'string').map((s) => s.buffer.name);
  const g = (cat) => a._catBus[cat].gain.value;
  assert.ok(g('world') < g('crowd') && g('world') < g('feel') && g('world') > g('ui'), 'the world sits under the crowd and the game feel');
  assert.equal(a._catBus.world.to[0], a._cueBus, 'and ducks under the announcer with every other effect');

  // a recorded take, on the world bus, at pitch (give or take two per cent)
  a.cue('world-fireworks', { intensity: 0.75 });
  assert.deepEqual(played(), ['world-fireworks']);
  const src = page.made.sources.filter((s) => s.started).at(-1);
  assert.equal(src.to[0].to[0].to[0], a._catBus.world);
  assert.equal(src.loop, false, 'a one-shot');
  assert.ok(Math.abs(src.playbackRate.value - 1) <= 0.021);

  // one beat at a time: a smaller one is dropped behind it, a bigger one takes over (the first fades out)
  const first = a._held.world.rec;
  ctx.currentTime += 0.3;
  a.cue('world-snap');
  assert.deepEqual(played(), ['world-fireworks'], 'a splash does not talk over the fireworks');
  a.cue('world-finale', { intensity: 1 });
  assert.deepEqual(played(), ['world-fireworks', 'world-finale']);
  assert.ok(first.end <= ctx.currentTime + 0.13, 'the fireworks fade as the finale takes over');
  assert.equal(a._held.world.rank, 5);
  ctx.currentTime += 0.5;
  a.cue('world-dragon-roar');
  assert.equal(played().length, 2, 'nothing cuts in on the finale');
  // and it cannot repeat itself straight away
  ctx.currentTime += 0.4;
  a.cue('world-finale');
  assert.equal(played().length, 2);

  // SUDDEN DEATH: the dip, and 1.5 s later the flare, both sound
  ctx.currentTime += 10;
  a.cue('world-lights-dip', { intensity: 0.75 });
  ctx.currentTime += 1.5;
  a.cue('world-lights-flare', { intensity: 0.9 });
  assert.deepEqual(played().slice(-2), ['world-lights-dip', 'world-lights-flare']);

  // a holed ball: the payoff owns the crowd; the stage's celebration 0.8 s later still plays,
  // on its own bus, and the crowd does not react a second time
  ctx.currentTime += 10;
  assert.equal(a.resolve('in'), true);
  ctx.currentTime += 0.8;
  const before = played().length;
  a.cue('world-celebration', { intensity: 1 });
  assert.equal(played().at(-1), 'world-celebration');
  a.cue('crowd-cheer');
  a.cue('applause');
  assert.equal(played().length, before + 1, 'one crowd: the roar');
  assert.equal(played().filter((n) => /^crowd-roar/.test(n)).length, 1);
  // ... and with a sting on top there is still one of each
  a.cue('jackpot');
  a.cue('perfect');
  assert.equal(played().filter((n) => n === 'jackpot' || n === 'perfect').length, 1, 'one sting');

  // while the announcer speaks every effect, the world included, is ducked
  assert.equal(a._sfxDuck.to.length > 0, true);
  a.dispose();
});

test('mix: gadget cues: a trail of coins chimes, the full trail lands on top of it, hard takes at each cue\'s own line', async (t) => {
  const page = fakePage(shippedSfx());
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const { cueFor, cueIntensity, COIN_CUE_GAP_MS } = await mod('public/render/gadget-core.js');
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const played = () => page.made.sources.filter((s) => s.started && s.buffer && typeof s.buffer.name === 'string').map((s) => s.buffer.name);
  const fire = (ev) => a.cue(cueFor(ev), { intensity: cueIntensity(ev) });

  // seven coins, one every 80 ms (what the caller's gate lets through): seven chimes, never the same take twice running
  for (let i = 0; i < 7; i++) { fire({ kind: 'coins', effect: 'coin' }); ctx.currentTime += COIN_CUE_GAP_MS / 1000; }
  const coins = played();
  assert.equal(coins.length, 7);
  assert.ok(coins.every((n) => /^gadget-coin(-[23])?$/.test(n)), coins.join(' '));
  for (let i = 1; i < coins.length; i++) assert.notEqual(coins[i], coins[i - 1]);
  // two in the same instant are one
  fire({ kind: 'coins', effect: 'coin' });
  fire({ kind: 'coins', effect: 'coin' });
  assert.equal(played().length, 8);
  // the full trail arrives with the last coin and is its own sound, not a dropped repeat
  fire({ kind: 'coins', effect: 'full' });
  assert.equal(played().at(-1), 'gadget-coin-hard');
  fire({ kind: 'coins', effect: 'full' });
  assert.equal(played().filter((n) => n === 'gadget-coin-hard').length, 1, 'and it too sounds once');
  const coinSrc = page.made.sources.filter((s) => s.started && s.buffer.name === 'gadget-coin').at(-1);
  assert.equal(coinSrc.to[0].to[0].to[0], a._catBus.feel, 'a coin is game feel');

  // x2 and x3 multiplier rings; the mouth of a warp and its exit
  ctx.currentTime += 5;
  fire({ kind: 'zone', mult: 2 });
  assert.equal(played().at(-1), 'gadget-zone');
  ctx.currentTime += 5;
  fire({ kind: 'zone', mult: 3 });
  assert.equal(played().at(-1), 'gadget-zone-hard');
  ctx.currentTime += 5;
  fire({ kind: 'warp', effect: 'in' });
  assert.equal(played().at(-1), 'gadget-warp');
  ctx.currentTime += 0.5;
  fire({ kind: 'warp-exit' });
  assert.equal(played().at(-1), 'gadget-warp-hard');

  // a ball rattling between bumpers pops every time; what it hits is an impact, varied in pitch
  ctx.currentTime += 5;
  const n0 = played().length;
  for (let i = 0; i < 4; i++) { fire({ kind: 'bumper' }); ctx.currentTime += 0.09; }
  assert.equal(played().length, n0 + 4);
  const bump = page.made.sources.filter((s) => s.started && /^gadget-bumper/.test(s.buffer.name)).at(-1);
  assert.equal(bump.to[0].to[0].to[0], a._catBus.impact);
  // a smash and a wall that held; mud; a ring, a pad, a geyser, a strip, a fan: one sound each
  for (const [ev, name] of [[{ kind: 'breakable', effect: 'smash' }, /^gadget-break/], [{ kind: 'breakable', effect: 'hold' }, /^gadget-thud/], [{ kind: 'ring' }, /^gadget-ring/],
    [{ kind: 'pad' }, /^gadget-pad/], [{ kind: 'geyser' }, /^gadget-geyser$/], [{ kind: 'strip' }, /^gadget-strip$/], [{ kind: 'fan' }, /^gadget-fan$/], [{ kind: 'mud' }, /^gadget-thud/]]) {
    ctx.currentTime += 3;
    const n = played().length;
    fire(ev);
    assert.equal(played().length, n + 1, JSON.stringify(ev));
    assert.match(played().at(-1), name);
  }
  // a kind with no sound of its own asks for nothing, and nothing throws
  assert.equal(cueFor({ kind: 'ice' }), null);
  assert.doesNotThrow(() => a.cue(null, { intensity: 0.8 }));
  a.dispose();
});

test('mix: a new cue with no file is silent (no synthesizer stands in), and an unknown name is still a no-op', async (t) => {
  const page = fakePage(shippedSfx([/^gadget-/, /^world-/, /^be-/, /^dl-/, /^replay-/]));
  t.after(page.restore);
  const { ArcadeAudio, SAMPLE_CUE_NAMES } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const sounded = () => page.made.sources.filter((s) => s.started).length + page.made.oscs.filter((o) => o.started != null).length;
  const before = sounded();
  for (const name of SAMPLE_CUE_NAMES.filter((n) => /^(gadget|world|be|dl|replay)-/.test(n))) {
    ctx.currentTime += 3;
    assert.doesNotThrow(() => a.cue(name, { intensity: 1 }));
  }
  for (const name of ['world-nothing', 'gadget-', 'be-x', 'no-such-cue', '', undefined, 42, {}]) assert.doesNotThrow(() => a.cue(name));
  assert.equal(sounded(), before, 'not a sound');
  // the cues that kept their synthesizer still sound without a file
  for (const name of ['good', 'ok', 'miss', 'slowmo-in', 'slowmo-out', 'bounce', 'jackpot']) {
    ctx.currentTime += 3;
    const n = sounded();
    a.cue(name);
    assert.ok(sounded() > n, `${name} sounds`);
  }
  a.dispose();
});
