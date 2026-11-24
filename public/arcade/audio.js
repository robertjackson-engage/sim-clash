/**
 * ArcadeAudio — the sound layer for the arcade HUD.
 *
 * Three kinds of sound, all one-shots (nothing here loops):
 *
 *  1. Synthesized cues (Web Audio, no files): strike, bounce, the grade stings, ...
 *     Dropping an mp3 at `<sfxBase><cue>.mp3` (default /arcade/sfx/strike.mp3, ...)
 *     overrides the synth for that cue: the files are probed once with a HEAD request
 *     when the AudioContext is created, decoded, cached, and played instead.
 *  2. Sampled cues (crowd-roar, applause, fanfare-win, vs-slam, ...): generated one-shots
 *     listed in `<sfxBase>manifest.json` (tools/arcade-voice/generate.mjs sfx), several
 *     takes for the crowd, one picked at random. No file: the cue is silent.
 *  3. The announcer: pre-rendered voice lines in `<voiceBase><pack>/` with a manifest,
 *     spoken through say(). Lines queue and never overlap; the effects duck a little
 *     under the voice. The pack comes from ?voice=<pack> (default "announcer").
 *
 *   audio.say('slice-house');
 *   audio.say([{ name: 'Alex', fallback: 'm-player-1' }, 'm-wins-the-match'], { priority: 3 });
 *   audio.stopVoice();
 *   audio.cue('crowd-roar', { intensity: 1 });
 *
 * Missing files fall back silently (to the synth where there is one). docs/arcade-voice.md.
 *
 *   import { ArcadeAudio } from '/arcade/audio.js';
 *   const sfx = new ArcadeAudio({ volume: 0.8 });
 *   // unlock() is auto-wired to the first pointerdown/keydown on window, but you
 *   // may also call it yourself from any user gesture handler.
 *   sfx.cue('strike', { intensity: 0.9 });
 *   sfx.crowd(0.6);           // crowd murmur/cheer bed, 0..1
 *   sfx.duck(0.7, 1.5);       // pull the bed down 70 % for 1.5 s (slow motion, banners)
 *
 * Signal flow:
 *   cue voices ─┐
 *   crowd ► duck ┼─► sfx duck (down ~4 dB while the announcer speaks) ─► compressor (−6 dB, 12:1) ─┐
 *   reverb send ┘  (shared ConvolverNode "room" with a generated impulse)                          │
 *   announcer ─────────────────────────────────────────────────────────────► soft-clip ceiling ◄──┘
 *                                                                  ─► master (volume×enabled) ─► out
 *   The announcer skips the compressor (its files are already levelled and limited), so a
 *   loud effect never pumps the voice.
 *
 * The mix is decided here, not by the callers (see MIX, COOLDOWN, EXCLUSIVE below): the
 * announcer on top, then impacts, outcome stings, game feel, the crowd, the living world
 * under whatever moment it answers, and the interface quietest; every cue has a cooldown;
 * a category has a voice limit; there is one crowd reaction, one outcome sting and one beat
 * of the world at a time. moment() plays one shot outcome as one moment.
 *
 * Gain staging (measured in Chromium): any single cue peaks ≤ ~0.5 at the cue bus and
 * the crowd bed ≤ ~0.35. The compressor adds its own automatic makeup (~×1.3), and the
 * soft-clip stage after it caps the signal at 0.92, so stacked cues can never clip.
 *
 * Every public method is a no-op when the Web Audio API is unavailable or the
 * context has not been unlocked yet (autoplay policy), and never throws.
 */

import { VoiceQueue, pickTake, nameSlug, packFromQuery, DEFAULT_PACK } from './voice/queue.js';
import { planSwell } from './voice/anticipation.js';

const EPS = 0.0001; // −80 dB floor for exponential ramps (they cannot hit 0)

/**
 * Every cue and the part it plays in the mix. The category decides the level, how much a
 * repeat is varied, how many may sound at once and how soon a cue may fire again: callers
 * just say what happened.
 *   impact  the physical game: club, ball, ground, cup. Loudest after the announcer.
 *   sting   the outcome of a shot or a hole (one at a time: a bigger one replaces a smaller)
 *   feel    rewards, power-ups, transitions, tension
 *   crowd   crowd reactions (one at a time: a roar replaces a gasp, never the other way)
 *   world   the stage answering the game (fireworks, a dragon, the lights). It always plays
 *           WITH a callout or a payoff, so it sits under them: one at a time, no crowd in it
 *   ui      menus and counters. Quietest.
 */
export const CUE_CATEGORY = Object.freeze({
  strike: 'impact', bounce: 'impact', splash: 'impact',
  'cup-drop': 'impact', 'flag-clank': 'impact', 'green-thump': 'impact', 'fairway-bounce': 'impact',
  'sand-thud': 'impact', 'tree-knock': 'impact', 'water-plunk': 'impact', 'lava-sizzle': 'impact',
  'ice-skid': 'impact', 'rough-rustle': 'impact',

  perfect: 'sting', great: 'sting', good: 'sting', ok: 'sting', miss: 'sting', disaster: 'sting', jackpot: 'sting',
  'fanfare-win': 'sting', 'fanfare-hole': 'sting', 'sting-fail': 'sting', 'sting-knockout': 'sting',
  // the match setup flow's big beats
  'start-match': 'sting', 'vs-slam': 'sting', 'coin-land': 'sting', 'stage-sting': 'sting',

  rocket: 'feel', armed: 'feel', coins: 'feel', levelup: 'feel', streak: 'feel', 'slowmo-in': 'feel', 'slowmo-out': 'feel',
  whoosh: 'feel', drumroll: 'feel', 'lobby-open': 'feel', 'coin-flip': 'feel', 'tee-off': 'feel', 'chest-open': 'feel', 'coin-burst': 'feel', 'trick-cast': 'feel',
  'arm-common': 'feel', 'arm-rare': 'feel', 'arm-epic': 'feel', 'confetti-pop': 'feel', riser: 'feel',
  'heartbeat-hit': 'feel', 'streak-up': 'feel', 'streak-break': 'feel',

  gasp: 'crowd', oooh: 'crowd', roar: 'crowd',
  'crowd-roar': 'crowd', 'crowd-cheer': 'crowd', 'crowd-ohh': 'crowd', 'crowd-aww': 'crowd', 'crowd-gasp': 'crowd',
  'crowd-laugh': 'crowd', applause: 'crowd',
  // the swell of anticipation, in four lengths (played by anticipate(), not by cue())
  'crowd-rise-1s': 'crowd', 'crowd-rise-2s': 'crowd', 'crowd-rise-3s': 'crowd', 'crowd-rise-4s': 'crowd',

  'ui-tick': 'ui', 'ui-confirm': 'ui', 'ui-back': 'ui', 'turn-chime': 'ui', 'trophy-tick': 'ui', 'countdown-beep': 'ui',
  // one distinct sound per kind of pick in the lobby (a pick is ONE sound, never tick plus confirm)
  'select-player': 'ui', 'select-format': 'ui', 'select-stage': 'ui', 'toggle-on': 'ui', 'toggle-off': 'ui',
  'drawer-open': 'ui', 'drawer-close': 'ui', 'ui-error': 'ui',

  // course gadgets (public/render/gadget-core.js GADGET_CUES): what the ball hits is an
  // impact, what it flies through or collects is game feel
  'gadget-pad': 'impact', 'gadget-bumper': 'impact', 'gadget-break': 'impact', 'gadget-thud': 'impact',
  'gadget-ring': 'feel', 'gadget-coin': 'feel', 'gadget-warp': 'feel', 'gadget-geyser': 'feel',
  'gadget-strip': 'feel', 'gadget-fan': 'feel', 'gadget-zone': 'feel',

  // the living world (public/render/world-life.js LIVING_CUES)
  'world-shockwave': 'world', 'world-eruption': 'world', 'world-dragon-roar': 'world', 'world-flare': 'world',
  'world-fireworks': 'world', 'world-celebration': 'world', 'world-snap': 'world', 'world-lava-burp': 'world',
  'world-tumbleweed': 'world', 'world-snowman': 'world', 'world-knockout': 'world', 'world-lights-dip': 'world',
  'world-lights-flare': 'world', 'world-finale': 'world',

  // Bullseye, the trick shot duel, instant replays (docs/modes.md)
  'be-thunk': 'impact', 'be-bull': 'sting', 'be-bust': 'sting', 'be-checkout': 'sting',
  'dl-call': 'sting', 'dl-matched': 'sting', 'dl-letter': 'feel', 'dl-no-call': 'feel',
  'replay-in': 'feel', 'replay-out': 'feel', 'replay-offer': 'ui',
});

/** A stage may have its own reveal sting, 'stage-sting-<theme>'; without a file it is 'stage-sting'. */
const STAGE_STING_RX = /^stage-sting-[a-z]+$/;

export const CUE_NAMES = Object.keys(CUE_CATEGORY);

// The original synthesized cues: the only names probed for a hand-dropped <cue>.mp3.
const LEGACY_CUE_NAMES = [
  'strike', 'bounce', 'splash',
  'gasp', 'oooh', 'roar',
  'perfect', 'great', 'good', 'ok', 'miss', 'disaster', 'jackpot',
  'rocket', 'armed', 'coins', 'levelup', 'streak',
  'slowmo-in', 'slowmo-out',
];

// A cue with no synthesizer of its own borrows one until its sample is generated.
const SYNTH_FALLBACK = {
  'green-thump': 'bounce', 'fairway-bounce': 'bounce', 'water-plunk': 'splash',
  'arm-common': 'armed', 'coin-burst': 'coins',
  'fanfare-win': 'jackpot', 'fanfare-hole': 'levelup', 'sting-fail': 'disaster',
  'crowd-roar': 'roar', 'crowd-gasp': 'gasp',
  'select-player': 'ui-confirm', 'select-format': 'ui-confirm', 'select-stage': 'ui-confirm',
  'toggle-on': 'ui-tick', 'toggle-off': 'ui-back', 'drawer-open': 'ui-tick', 'drawer-close': 'ui-back', 'ui-error': 'ui-back',
  'lobby-open': 'whoosh', 'start-match': 'ui-confirm', 'coin-land': 'ui-confirm', 'tee-off': 'whoosh',
};

/** Cues that are silent until their generated sample exists (no synthesizer stands in). */
export const SAMPLE_CUE_NAMES = ['crowd-cheer', 'crowd-ohh', 'crowd-aww', 'crowd-laugh', 'applause',
  'vs-slam', 'drumroll', 'sting-knockout', 'chest-open', 'trick-cast', 'coin-flip', 'stage-sting',
  // every gadget, living-world, Bullseye, duel and replay cue is a recording: none has a synthesizer
  ...Object.keys(CUE_CATEGORY).filter((n) => /^(gadget|world|be|dl|replay)-/.test(n))];

/** Cues that always sound: their own synthesizer, or a borrowed one. */
export const SYNTH_CUE_NAMES = CUE_NAMES.filter((n) => !SAMPLE_CUE_NAMES.includes(n));

// gain: the category's level. voices: how many may sound at once. cooldown: the shortest
// time (s) before the same cue may fire again. rate / vary: random pitch and level spread
// of a sampled take, so a repeat never sounds copy-pasted (none on anything musical).
const MIX = {
  impact: { gain: 1.0, voices: 5, cooldown: 0.04, rate: 0.05, vary: 0.12 },
  sting: { gain: 0.85, voices: 2, cooldown: 0.3, rate: 0, vary: 0 },
  feel: { gain: 0.8, voices: 4, cooldown: 0.08, rate: 0.015, vary: 0.05 },
  crowd: { gain: 0.75, voices: 2, cooldown: 0.5, rate: 0.02, vary: 0.06 },
  world: { gain: 0.68, voices: 2, cooldown: 1.0, rate: 0.02, vary: 0.05 },
  ui: { gain: 0.6, voices: 3, cooldown: 0.03, rate: 0, vary: 0 },
};
// A run of hover ticks should sound like a selector rolling, not one sample repeated. A trail
// of coins moves a little more than other game feel; the chimes and the tape whips stay at pitch.
const VARY = { 'ui-tick': { rate: 0.06, vary: 0.1 }, 'gadget-coin': { rate: 0.03, vary: 0.08 },
  'gadget-zone': { rate: 0, vary: 0 }, 'gadget-ring': { rate: 0.01, vary: 0.05 }, 'replay-in': { rate: 0, vary: 0 }, 'replay-out': { rate: 0, vary: 0 } };
const HARD_HIT = 0.78;   // cue intensity from which a cue's "hard" takes play (a driver, not a wedge)
// ... or the cue's own line: the full coin trail (1, a coin is 0.55), the x3 zone (1, the x2 is
// 0.8), the warp's exit (0.9, its mouth is 0.8). public/render/gadget-core.js cueIntensity().
const HARD_AT = { 'gadget-coin': 0.9, 'gadget-zone': 0.95, 'gadget-warp': 0.85 };
// Cues that come in runs and must not pile up: a new one fades the one before it (60 ms), so
// a trail of coins is a clean run of chimes, a ball rattling between bumpers a run of pops,
// and neither fills its category's voices (the cup must still be heard to drop).
const CHOKE = new Set(['gadget-coin', 'gadget-bumper']);
const MAX_VOICES = 12;   // everything at once; past this only an impact still gets through
const COOLDOWN = {
  strike: 0.12, splash: 0.3, 'water-plunk': 0.3, 'lava-sizzle': 0.5, 'cup-drop': 0.8, 'flag-clank': 0.25,
  coins: 0.15, 'coin-burst': 0.3, 'confetti-pop': 0.2, 'chest-open': 0.5, levelup: 0.5, whoosh: 0.12,
  'vs-slam': 0.5, drumroll: 2, riser: 2.4, 'heartbeat-hit': 0.4, 'arm-rare': 0.2, 'arm-epic': 0.3,
  'ui-tick': 0.03, 'trophy-tick': 0.035, 'turn-chime': 0.5,
  'lobby-open': 0.5, 'start-match': 1, 'coin-flip': 1, 'coin-land': 1, 'stage-sting': 0.5, 'tee-off': 0.5,
  // gadgets: a trail of coins is a run of chimes (the caller lets one through every 80 ms),
  // a ball rattling between bumpers pops each time, the rest cannot repeat inside one contact
  'gadget-coin': 0.06, 'gadget-bumper': 0.07, 'gadget-pad': 0.12, 'gadget-thud': 0.12, 'gadget-ring': 0.15,
  'gadget-warp': 0.15, 'gadget-break': 0.25, 'gadget-strip': 0.25, 'gadget-geyser': 0.4, 'gadget-fan': 0.5, 'gadget-zone': 0.5,
  'be-thunk': 0.1, 'be-bull': 0.5, 'be-bust': 0.5, 'be-checkout': 1, 'dl-call': 0.5, 'dl-letter': 0.2, 'dl-matched': 0.5, 'dl-no-call': 0.5,
  'replay-in': 0.3, 'replay-out': 0.3, 'replay-offer': 0.3,
};
// One crowd reaction and one outcome sting at a time. Inside the window a cue of a higher
// rank replaces the one sounding (which fades out); the same rank or lower is dropped.
const EXCLUSIVE = {
  crowd: { window: 1.2, rank: { roar: 3, 'crowd-roar': 3, 'crowd-cheer': 2, applause: 2, 'crowd-ohh': 2,
    'crowd-laugh': 2, 'crowd-aww': 2, oooh: 1, gasp: 1, 'crowd-gasp': 1 } },
  sting: { window: 0.6, rank: { jackpot: 3, 'fanfare-win': 3, 'sting-knockout': 3, perfect: 2, 'fanfare-hole': 2,
    disaster: 2, 'sting-fail': 2, great: 1, good: 1, miss: 1, ok: 0,
    'vs-slam': 3, 'start-match': 2, 'coin-land': 2, 'stage-sting': 2,
    'be-checkout': 3, 'be-bull': 2, 'be-bust': 2, 'dl-call': 2, 'dl-matched': 2 } },
  // One beat of the living world at a time, ranked as its own reaction bus ranks them
  // (public/render/world-life.js REACTIONS): the finale takes over from anything, a holed
  // ball or a knockout from a great shot's fireworks, and a splash never cuts a dragon off.
  world: { window: 1.0, rank: { 'world-finale': 5, 'world-celebration': 4, 'world-knockout': 4, 'world-lights-dip': 4,
    'world-lights-flare': 4, 'world-eruption': 3, 'world-dragon-roar': 3, 'world-shockwave': 2, 'world-flare': 2,
    'world-fireworks': 2, 'world-snap': 1, 'world-lava-burp': 1, 'world-tumbleweed': 1, 'world-snowman': 1 } },
};
// moment(): when each part of one shot outcome starts, in ms after the impact.
const MOMENT = { sting: 80, crowd: 180, voiceAfterCrowd: 380, voiceAfterSting: 320, voiceAfterImpact: 120 };
const LEGACY_VARY = { rate: 0.03, vary: 0 };   // a hand-dropped override keeps its old ±3 % pitch
// Anticipation and payoff (anticipate() / resolve()). After a payoff no other crowd cue may
// start for a while: the HUD's own crowd reaction to the same shot is the duplicate.
const SWELL_RX = /^crowd-rise-/;
const PAYOFF = { in: { impact: 'cup-drop', crowd: 'crowd-roar', hold: 3.5 }, out: { crowd: 'crowd-ohh', hold: 3.0 }, close: { crowd: 'applause', hold: 2.5 } };
const SWELL_CUT_S = 0.06;    // the fade that cuts the swell on the frame of the outcome

// Announcer levels. The voice files are levelled to −15 LUFS with peaks at −2 dBFS; at this
// gain the loudest peak is ~0.67, under the ceiling's knee (0.7), so the voice is never shaped.
const VOICE = {
  gain: 0.85,
  reverbSend: 0.06,   // a touch of the shared room: a stadium PA, not a booth
  duck: 0.6,          // the effects bus while the announcer speaks (about −4.4 dB)
  duckIn: 0.04,       // time constants (s)
  duckOut: 0.25,
  cacheMax: 96,       // decoded announcer clips kept (about 0.25 MB each)
  // lines worth having decoded before the first swing (every take of each)
  hot: ['nice-shot', 'great-shot', 'perfect', 'terrible', 'slice-house', 'hook-city', 'splash', 'beach',
    'timber', 'ob', 'bomb', 'striped', 'dance-floor', 'so-close', 'worm-burner', 'chunk',
    'm-versus', 'm-get-ready', 'm-tee-off', 'm-youre-up', 'm-player-1', 'm-player-2'],
};
// Sampled effects: generated at −21 LUFS, played a little hotter than a hand-dropped override.
const SAMPLE_GAIN = 0.9;

// Crowd bed tuning (linear gains). Peak of the whole bed ≈ 0.35 at level 1.
const CROWD = {
  bus: 0.46,      // crowd bus → compressor
  murmur: 0.22,   // murmur layer at full level
  cheer: 0.2,     // cheer layer at full level
  whoop: 0.045,   // loudest single whoop / clap
  breathe: 0.2,   // ± slow LFO depth on the whole bed
  reverbSend: 0.12,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const jitter = (f, pct = 0.05) => f * (1 + rnd(-pct, pct)); // ±5 % pitch by default

/** 2.5 s of noise, looped by every noise voice. Brown noise is seam-crossfaded. */
function makeNoiseBuffer(ctx, kind, seconds = 2.5) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  if (kind === 'brown') {
    const fade = Math.floor(sr * 0.05);
    const ext = new Float32Array(n + fade);
    let last = 0;
    for (let i = 0; i < ext.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      ext[i] = last * 3.5;
    }
    for (let i = 0; i < n; i++) d[i] = ext[fade + i];
    // crossfade the tail into the samples that precede the head so the loop is seamless
    for (let k = 0; k < fade; k++) {
      const w = k / fade;
      d[n - fade + k] = d[n - fade + k] * (1 - w) + ext[k] * w;
    }
  } else {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/** Transparent below ±0.7, then a tanh knee that tops out at ±0.92: a hard safety ceiling. */
function makeCeilingCurve(n = 2048) {
  const curve = new Float32Array(n);
  const knee = 0.7;
  const room = 0.27;
  for (let k = 0; k < n; k++) {
    const x = (k / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    curve[k] = Math.sign(x) * y;
  }
  return curve;
}

/** Small-hall impulse: 12 ms pre-delay then exponentially decaying noise (~1.5 s). */
function makeImpulse(ctx, seconds = 1.5, decay = 4.5) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = pre; i < n; i++) {
      const x = (i - pre) / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-decay * x) * (1 - x / seconds);
    }
  }
  return buf; // ConvolverNode.normalize (default true) handles the energy scaling
}

export class ArcadeAudio {
  // ambience: the continuous crowd bed. OFF by default: a synthesized murmur is filtered
  // noise, and left running between shots it reads as wind or hiss, not as a crowd. With
  // it off, crowd() does nothing and only the one-shot cues play. Turn it on only with a
  // recorded crowd loop to play.
  // voice: the announcer pack ('announcer', 'arena', ...). Default: ?voice=<pack> in the page
  // address, else 'announcer'. voiceBase / namesBase / namesApi: where the packs, the
  // rendered player names and the name-rendering API live (namesApi: null turns that off).
  constructor({ sfxBase = '/arcade/sfx/', volume = 0.8, ambience = false, voice = null,
    voiceBase = '/arcade/voice/', namesBase = '/voice/names/', namesApi = '/api/voice/' } = {}) {
    this._ambience = !!ambience;
    this._sfxBase = String(sfxBase || '/arcade/sfx/');
    if (!this._sfxBase.endsWith('/')) this._sfxBase += '/';
    const slash = (s) => (s.endsWith('/') ? s : `${s}/`);
    this._voiceBase = slash(String(voiceBase || '/arcade/voice/'));
    this._namesBase = slash(String(namesBase || '/voice/names/'));
    this._namesApi = namesApi ? slash(String(namesApi)) : null;
    let search = '';
    try { search = typeof window !== 'undefined' && window.location ? window.location.search : ''; } catch (_) { /* no page */ }
    this._voicePack = packFromQuery(`?voice=${encodeURIComponent(voice || '')}`) || packFromQuery(search) || DEFAULT_PACK;
    this._voiceManifest = null;        // the pack's manifest once loaded
    this._voiceManifestP = null;       // Promise of it (null until the context exists)
    this._voiceClips = new Map();      // url -> Promise<clip | null>  (insertion order = age)
    this._voiceLast = new Map();       // line id -> index of the take spoken last
    this._voiceSources = new Set();    // announcer sources that are sounding
    this._nameMiss = new Map();        // name slug -> time of the last 404 (ms)
    this._nameAsked = new Set();       // name slugs a render was requested for
    this._sfx = new Map();             // sampled cue -> { urls, buffers, last }
    this._sfxFetches = new Map();      // sample url -> Promise<AudioBuffer | null>
    this._missing = new Map();         // url -> when it last answered "not found" (ms)
    this._live = new Set();            // cue voices that are sounding: { cat, end, kill }
    this._cueLast = new Map();         // cue name -> when it last fired (context seconds)
    this._choked = new Map();          // a cue that comes in runs -> its voice that is sounding (CHOKE)
    this._held = {};                   // category -> the exclusive cue holding it { rank, at, rec }
    this._curCat = null;               // the category of the cue being started (routes _voice())
    this._lastVoice = null;
    this._momentTimers = new Set();    // pending steps of the current moment()
    this._swell = null;                // the swell of anticipation that is sounding { peakAt, until, stop }
    this._payoffUntil = 0;             // context time until which the payoff owns the crowd
    this._queue = new VoiceQueue({
      load: (item) => this._loadVoiceItem(item),
      play: (clip, done) => this._playVoice(clip, done),
      onActive: (on) => this._duckSfx(on),
    });
    this._volume = clamp(Number(volume) || 0, 0, 1);
    this._enabled = true;
    this._disposed = false;

    this._ctx = null;
    this._samples = new Map(); // cue name → decoded AudioBuffer override
    this._probed = false;

    this._crowd = null;        // crowd graph, built lazily
    this._crowdLevel = 0;
    this._crowdRamp = 0.6;
    this._whoopTimer = 0;

    const w = typeof window !== 'undefined' ? window : null;
    this._AC = w ? (w.AudioContext || w.webkitAudioContext) : null;
    this._supported = !!this._AC;

    this._synth = {
      strike: this._cueStrike, bounce: this._cueBounce, splash: this._cueSplash,
      gasp: this._cueGasp, oooh: this._cueOooh, roar: this._cueRoar,
      perfect: this._cuePerfect, great: this._cueGreat, good: this._cueGood,
      ok: this._cueOk, miss: this._cueMiss, disaster: this._cueDisaster,
      jackpot: this._cueJackpot, rocket: this._cueRocket, armed: this._cueArmed,
      coins: this._cueCoins, levelup: this._cueLevelup, streak: this._cueStreak,
      'slowmo-in': this._cueSlowmoIn, 'slowmo-out': this._cueSlowmoOut,
      'cup-drop': this._cueCupDrop, 'flag-clank': this._cueFlagClank, 'sand-thud': this._cueSandThud,
      'tree-knock': this._cueTreeKnock, 'lava-sizzle': this._cueLavaSizzle, 'ice-skid': this._cueIceSkid,
      'rough-rustle': this._cueRoughRustle,
      'ui-tick': this._cueUiTick, 'ui-confirm': this._cueUiConfirm, 'ui-back': this._cueUiBack,
      'turn-chime': this._cueTurnChime, 'trophy-tick': this._cueTrophyTick, 'countdown-beep': this._cueCountdownBeep,
      'arm-rare': this._cueArmRare, 'arm-epic': this._cueArmEpic, 'confetti-pop': this._cueConfettiPop,
      riser: this._cueRiser, 'heartbeat-hit': this._cueHeartbeatHit, 'streak-up': this._cueStreakUp,
      'streak-break': this._cueStreakBreak, whoosh: this._cueWhoosh,
    };

    // Autoplay policy: the first gesture anywhere unlocks the context.
    this._onGesture = () => { this.unlock(); };
    this._gestureAttached = false;
    if (this._supported) {
      window.addEventListener('pointerdown', this._onGesture, { capture: true, passive: true });
      window.addEventListener('keydown', this._onGesture, { capture: true, passive: true });
      this._gestureAttached = true;
    }
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** Create / resume the AudioContext. Safe to call any number of times. */
  unlock() {
    if (!this._supported || this._disposed) return false;
    if (!this._ctx) {
      try {
        this._ctx = new this._AC({ latencyHint: 'interactive' });
      } catch (_) {
        this._supported = false;
        this._detachGesture();
        return false;
      }
      this._buildGraph();
      this._ctx.onstatechange = () => this._onState();
      // sampled effects first (their manifest says which names need no probe), then the announcer
      this._loadSfxManifest().then(() => this._probeSamples()).catch(() => {});
      this._voiceManifestP = this._loadVoiceManifest();
    }
    if (this._ctx.state === 'suspended') {
      const p = this._ctx.resume();
      if (p && p.then) p.then(() => this._onState(), () => {});
    }
    this._onState();
    return true;
  }

  /** Master mute (nothing is persisted here; the HUD owns the setting). */
  setEnabled(on) {
    this._enabled = !!on;
    if (!this._enabled) {
      // muting also silences the announcer for good: nothing queued may speak when sound returns
      this.stopVoice();
      this._cancelMoment();
      this._endSwell(0.03);
      this._stopCues();
    }
    this._applyMaster();
  }

  setVolume(v) {
    this._volume = clamp(Number(v) || 0, 0, 1);
    this._applyMaster();
  }

  get enabled() { return this._enabled; }
  get volume() { return this._volume; }
  /** 'off' | 'locked' | 'running' — handy for a HUD indicator. */
  get state() {
    if (!this._supported || this._disposed) return 'off';
    if (!this._ctx || this._ctx.state !== 'running') return 'locked';
    return 'running';
  }
  /** Cue names currently backed by an mp3 (an override, or a generated sample) instead of the synth. */
  get loadedSamples() {
    const names = new Set(this._samples.keys());
    for (const [name, e] of this._sfx) if (e.buffers.some(Boolean)) names.add(name);   // (a themed stage sting too)
    return Array.from(names);
  }
  /** The announcer pack in use ('announcer', 'arena', ...). */
  get voicePack() { return this._voicePack; }
  /** Line ids the loaded pack can speak (empty until its manifest has arrived). */
  get voiceLines() { return this._voiceManifest ? Object.keys(this._voiceManifest.lines) : []; }
  /** The announcer is speaking or has lines waiting. */
  get speaking() { return this._queue.busy; }

  /**
   * Fire-and-forget one-shot. Unknown names are ignored. The mix is enforced here, not by
   * the caller: a cue that fires again inside its cooldown is dropped, a category has a
   * limit on how many voices sound at once, and there is one crowd reaction and one outcome
   * sting at a time (a bigger one replaces a smaller one; a smaller or equal one is dropped).
   */
  cue(name, options) {
    const intensity = options && Number.isFinite(options.intensity) ? options.intensity : 0.7;
    this._fire(name, intensity, false);
  }

  /**
   * Start a cue under the mix rules. `force` is the payoff of resolve(): it skips the
   * cooldown and takes the crowd over whatever is sounding. Returns true if it sounded.
   */
  _fire(name, intensity, force) {
    if (!this._ready()) {
      if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
      return false;
    }
    if (!this._enabled) return false; // save the CPU while muted
    if (typeof name === 'string' && !CUE_CATEGORY[name] && STAGE_STING_RX.test(name)) {
      if (!this._sfx.has(name)) name = 'stage-sting';   // no themed file: the generic reveal
    }
    const cat = CUE_CATEGORY[name] || (this._sfx.has(name) && STAGE_STING_RX.test(name) ? 'sting' : null);
    if (!cat) return false;
    try {
      const mix = MIX[cat];
      const now = this._ctx.currentTime;
      // while the gallery is rising, and just after its payoff, that IS the crowd: nothing else joins in
      if (cat === 'crowd' && !force && ((this._swell && now < this._swell.until) || now < this._payoffUntil)) return false;
      // (a cue with its own hard line keeps a separate cooldown for its hard take: the full
      // coin trail lands on the heels of its last coin, and must not be dropped as a repeat)
      const key = HARD_AT[name] != null && Number.isFinite(intensity) && intensity >= HARD_AT[name] ? `${name}!` : name;
      const last = this._cueLast.get(key);
      if (!force && last != null && now - last < (COOLDOWN[name] ?? mix.cooldown)) return false;   // no machine-gunning

      const ex = EXCLUSIVE[cat];
      let held = null;
      let rank = 1;
      if (ex) {
        rank = force ? 9 : ex.rank[name] ?? (STAGE_STING_RX.test(name) ? 2 : 1);
        held = this._held[cat];
        if (held && now - held.at < ex.window) { if (rank <= held.rank) return false; } else held = null;
      }
      if (!held && !force) {
        const { n, total } = this._liveCount(cat);
        if (n >= mix.voices || (total >= MAX_VOICES && cat !== 'impact')) return false;
      }

      const i = clamp(Number.isFinite(intensity) ? intensity : 0.7, 0, 1);
      const t = this._t0();
      this._curCat = cat;
      this._lastVoice = null;
      // a file dropped in by hand under the cue's own name wins, then the generated samples, then the synth
      const override = this._samples.get(name);
      const entry = this._sfx.get(name);
      let played = true;
      if (override) this._playSample(override, t, i, 0.55, LEGACY_VARY);
      else if (entry && this._cueSample(entry, t, i, VARY[name] || mix, HARD_AT[name] ?? HARD_HIT)) { /* a real take is playing */ }
      else {
        const fn = this._synth[name] || this._synth[SYNTH_FALLBACK[name]];
        if (fn) fn.call(this, t, i); else played = false;
      }
      this._curCat = null;
      if (!played) return false;
      this._cueLast.set(key, now);
      if (CHOKE.has(name)) {
        const prev = this._choked.get(key);
        if (prev && prev !== this._lastVoice) prev.kill(0.06);
        this._choked.set(key, this._lastVoice);
      }
      if (ex) {
        if (held && held.rec) held.rec.kill(0.12);
        this._held[cat] = { rank, at: now, rec: this._lastVoice };
      }
      return true;
    } catch (_) {
      this._curCat = null;   // never let an audio hiccup reach the game loop
      return false;
    }
  }

  /**
   * ANTICIPATION. The gallery rising as a ball tracks at the hole: a climbing
   * "aaaaAAAHHH" whose PEAK lands exactly `seconds` from now (the frame the outcome will be
   * known). The recorded swell that best fits is used, never stretched: a long window
   * starts it late, a short one enters part-way up the rise. While it sounds it is the only
   * crowd sound: other crowd cues fade out and none may start.
   *
   *   const h = audio.anticipate({ seconds: 2.4, intensity: 0.9 });   // at the start of the slow motion
   *   audio.resolve('in');                                            // on the frame the ball drops
   *
   * Returns { cue, seconds, startsIn, endsAt, cancel() } or null (locked, muted, no swell
   * files). One swell at a time: a new one cuts the old. If resolve() never comes the swell
   * fades by itself within 0.4 s of its peak. Never throws.
   */
  anticipate(what) {
    try {
      const { seconds = 2, intensity = 0.8 } = what || {};
      if (!this._ready()) {
        if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
        return null;
      }
      if (!this._enabled) return null;
      this._endSwell(SWELL_CUT_S);
      const takes = [];
      for (const [name, e] of this._sfx) {
        if (!SWELL_RX.test(name) || !(e.peakS > 0)) continue;
        const ready = [];
        e.buffers.forEach((b, k) => { if (b) ready.push(k); else this._loadSfxTake(e, k).catch(() => {}); });
        if (ready.length) takes.push({ name, e, ready });
      }
      if (!takes.length) return null;
      const want = clamp(Number(seconds) || 0, 0.2, 60);
      const plan = planSwell(takes.map((x) => x.e.peakS), want);
      if (!plan) return null;
      const pick = takes[plan.index];
      const k = pick.ready[pickTake(pick.ready.length, pick.ready.indexOf(pick.e.last))];
      pick.e.last = k;
      const buffer = pick.e.buffers[k];

      const ctx = this._ctx;
      const now = ctx.currentTime;
      // the swell owns the crowd: whatever crowd is sounding gives way
      for (const rec of Array.from(this._live)) if (rec.cat === 'crowd') rec.kill(0.15);
      const i = clamp(Number.isFinite(intensity) ? intensity : 0.8, 0, 1);
      const level = SAMPLE_GAIN * (0.6 + 0.4 * i);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      const start = now + plan.startIn;
      if (plan.offset > 0) {            // entering part-way up the rise: a short fade in, not a jump
        g.gain.setValueAtTime(EPS, start);
        g.gain.exponentialRampToValueAtTime(level, start + 0.06);
      } else {
        g.gain.setValueAtTime(level, start);
      }
      src.connect(g);
      g.connect(this._catBus.crowd);
      const peakAt = now + want;
      const swell = { cue: pick.name, peakAt, until: peakAt + 0.4, stop: null };
      swell.stop = (fadeS) => {
        try {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(EPS, g.gain.value), t);
          g.gain.setTargetAtTime(0, t, Math.max(0.005, fadeS / 3));
          src.stop(t + fadeS + 0.02);
        } catch (_) { /* already over */ }
      };
      src.onended = () => {
        if (this._swell === swell) this._swell = null;
        try { g.disconnect(); src.disconnect(); } catch (_) { /* ignore */ }
      };
      src.start(start, Math.min(plan.offset, Math.max(0, buffer.duration - 0.05)));
      this._swell = swell;
      return { cue: pick.name, seconds: want, startsIn: plan.startIn, endsAt: peakAt, cancel: () => { if (this._swell === swell) this._endSwell(SWELL_CUT_S); } };
    } catch (_) {
      return null;
    }
  }

  /**
   * PAYOFF, on the frame the outcome is known. Cuts the swell (a 60 ms fade) and fires:
   *   'in'     the ball drops: the cup rattle and the roar, the biggest sound in the game
   *   'out'    a lip-out, a burned edge: the collective "OHHHH" groan
   *   'close'  it finishes close but was never going in: warm applause
   * The payoff takes the crowd over anything sounding, and for a few seconds afterwards any
   * other crowd cue is dropped (the HUD's reaction to the same shot would be a double).
   * Works without a swell. Returns true if the payoff sounded. Never throws.
   */
  resolve(outcome, options) {
    try {
      const p = PAYOFF[outcome];
      if (!p || !this._ready() || !this._enabled) return false;
      const intensity = options && Number.isFinite(options.intensity) ? options.intensity : 1;
      this._endSwell(SWELL_CUT_S);
      if (p.impact) this._fire(p.impact, intensity, false);   // the HUD may already have played it this frame: once is right
      const ok = this._fire(p.crowd, intensity, true);
      this._payoffUntil = this._ctx.currentTime + p.hold;
      return ok;
    } catch (_) {
      return false;
    }
  }

  /** Cut the swell of anticipation, if one is sounding. */
  _endSwell(fadeS) {
    const sw = this._swell;
    this._swell = null;
    if (sw && sw.stop) sw.stop(fadeS);
  }

  /**
   * One shot outcome, mixed as one moment: at most ONE impact, ONE outcome sting, ONE crowd
   * reaction and ONE announcer sentence, started in that order so each is heard: the impact
   * now, the sting 80 ms later, the crowd 180 ms after the impact, the voice once the
   * crowd's attack has passed.
   *
   *   audio.moment({ impact: 'cup-drop', sting: 'jackpot', crowd: 'crowd-roar', say: 'hole-in-one', intensity: 1 });
   *   audio.moment({ impact: 'sand-thud', crowd: 'crowd-aww', say: 'beach' });
   *   audio.moment({ impact: 'fairway-bounce', grade: 'OK' });   // an ordinary shot: the physical sound only
   *
   * Each of impact / sting / crowd is a cue name or { name, intensity }. `say` is anything
   * say() takes, or { line, priority, gapMs }. With `grade: 'OK'` only the impact plays:
   * silence is part of the design. Two moments close together (the HUD's shot callout and
   * the match screen's "wins the hole") do not pile up: the crowd and sting rules of cue()
   * keep one of each, and the two lines queue (or the higher priority cuts in). Never
   * throws; a no-op when audio is locked or muted.
   */
  moment(what) {
    try {
      const { impact = null, crowd = null, sting = null, say = null, intensity = 0.7, grade = null, priority = 1 } = what || {};
      if (!this._ready()) {
        if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
        return false;
      }
      if (!this._enabled) return false;
      const one = (x) => {
        const v = Array.isArray(x) ? x[0] : x;
        if (typeof v === 'string' && v) return { name: v, intensity };
        if (v && typeof v.name === 'string') return { name: v.name, intensity: Number.isFinite(v.intensity) ? v.intensity : intensity };
        return null;
      };
      const hit = one(impact);
      if (hit) this.cue(hit.name, { intensity: hit.intensity });
      if (typeof grade === 'string' && /^ok$/i.test(grade.trim())) return true;

      if (this._momentTimers.size > 12) return true;   // a flood of outcomes: the impact is enough
      const later = (ms, fn) => {
        const id = setTimeout(() => { this._momentTimers.delete(id); try { fn(); } catch (_) { /* ignore */ } }, ms);
        this._momentTimers.add(id);
      };
      const s = one(sting);
      const c = one(crowd);
      if (s) later(MOMENT.sting, () => this.cue(s.name, { intensity: s.intensity }));
      if (c) later(MOMENT.crowd, () => this.cue(c.name, { intensity: c.intensity }));
      if (say) {
        const wrapped = typeof say === 'object' && !Array.isArray(say) && 'line' in say;
        const line = wrapped ? say.line : say;
        const opts = { priority: wrapped && Number.isFinite(say.priority) ? say.priority : priority };
        if (wrapped && Number.isFinite(say.gapMs)) opts.gapMs = say.gapMs;
        const at = c ? MOMENT.crowd + MOMENT.voiceAfterCrowd : s ? MOMENT.voiceAfterSting : hit ? MOMENT.voiceAfterImpact : 0;
        if (at > 0) later(at, () => this.say(line, opts)); else this.say(line, opts);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * The announcer. `line` is a line id ('slice-house'), a sentence of them
   * (['m-player-1', 'm-wins-the-match']), and any element may be { name, fallback }: the
   * player's own name if a clip of it exists, else the fallback line.
   *
   * Sentences queue and play one after another, never overlapping, `gapMs` between lines.
   * A `priority` higher than everything playing and waiting clears the queue and cuts in.
   * A random take is chosen each time, never the same one twice running. A sentence that
   * has not started within `maxWaitMs` is dropped. Silent no-op when audio is locked,
   * muted, or the clip is missing. Never throws.
   */
  say(line, options) {
    try {
      const { priority = 1, gapMs = 120, maxWaitMs = 6000 } = options || {};
      if (!this._ready()) {
        if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
        return false;
      }
      if (!this._enabled) return false;
      return this._queue.say(line, { priority, gapMs, maxWaitMs });
    } catch (_) {
      return false;
    }
  }

  /** Cut the announcer off and forget every line that is waiting (a moment()'s pending steps too). */
  stopVoice() {
    try { this._cancelMoment(); } catch (_) { /* ignore */ }
    try { this._queue.stop(); } catch (_) { /* ignore */ }
    try { this._stopVoiceSources(); } catch (_) { /* ignore */ }
  }

  /**
   * Have lines decoded ahead of the moment (a stage name before its intro, 'm-knockout'
   * when someone must hole out). Ids the pack does not have are ignored.
   */
  preloadVoice(ids) {
    try {
      if (!this._ctx || this._disposed) return;
      const list = Array.isArray(ids) ? ids : [ids];
      Promise.resolve(this._voiceManifestP).then((m) => {
        if (!m) return;
        for (const id of list) {
          const e = typeof id === 'string' ? m.lines[id] : null;
          if (e) for (const f of e.files) this._voiceClip(this._voiceUrl(f));
        }
      }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  /**
   * Ask the server to render a player's name in the announcer's voice (once; it is kept on
   * disk) and have it ready. Resolves true when the clip exists. Without a key, a network
   * or the API it resolves false and say({ name, fallback }) speaks the fallback.
   */
  async prepareName(name) {
    try {
      const slug = nameSlug(name);
      if (!slug || !this._namesApi || typeof fetch !== 'function') return false;
      this._nameAsked.add(slug);
      const res = await fetch(`${this._namesApi}name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: String(name), pack: this._voicePack }),
      });
      const j = await res.json().catch(() => null);
      if (!j || !j.ok) return false;
      this._nameMiss.delete(slug);
      this._missing.delete(this._nameUrl(slug));
      this._voiceClips.delete(this._nameUrl(slug));
      if (this._ctx && !this._disposed) this._voiceClip(this._nameUrl(slug), { name: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Continuous crowd bed level, 0 (silent) … 1 (full cheer), crossfaded over rampSeconds. */
  crowd(level, rampSeconds = 0.6) {
    if (!this._ambience) { this._crowdLevel = 0; return; }   // no continuous bed (see the constructor)
    this._crowdLevel = clamp(Number(level) || 0, 0, 1);
    this._crowdRamp = Math.max(0.02, Number(rampSeconds) || 0.6);
    if (!this._ready()) return; // applied on unlock
    try { this._applyCrowd(this._crowdLevel, this._crowdRamp); } catch (_) { /* ignore */ }
  }

  /**
   * Temporarily lower the crowd bed (slow motion, banner stings). `amount` 0..1 is how
   * much to take away (0 = nothing, 1 = silent); the bed stays down for `seconds` and
   * then recovers by itself. Cues are not affected. Calls replace each other, so
   * duck(0) releases an active duck early.
   */
  duck(amount = 0.6, seconds = 1.2) {
    if (!this._ready() || !this._crowdDuck) return;
    const a = clamp(Number(amount) || 0, 0, 1);
    const hold = clamp(Number(seconds) || 0, 0, 60);
    try {
      const t = this._ctx.currentTime;
      const g = this._crowdDuck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      if (a > 0 && hold > 0) {
        g.setTargetAtTime(1 - a, t, 0.05);           // down in ~150 ms
        g.setTargetAtTime(1, t + 0.15 + hold, 0.25); // back up over ~0.75 s
      } else {
        g.setTargetAtTime(1, t, 0.25);
      }
    } catch (_) { /* ignore */ }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._detachGesture();
    if (this._whoopTimer) { clearTimeout(this._whoopTimer); this._whoopTimer = 0; }
    this.stopVoice();
    this._cancelMoment();
    this._endSwell(0.01);
    this._stopCues();
    const ctx = this._ctx;
    this._ctx = null;
    this._crowd = null;
    this._samples.clear();
    this._sfx.clear();
    this._sfxFetches.clear();
    this._voiceClips.clear();
    this._voiceManifest = null;
    if (ctx) {
      try { ctx.onstatechange = null; ctx.close(); } catch (_) { /* ignore */ }
    }
  }

  // ───────────────────────────── plumbing ─────────────────────────────

  _ready() {
    return !!this._ctx && !this._disposed && this._ctx.state === 'running';
  }

  _onState() {
    if (!this._ctx || this._disposed) return;
    if (this._ctx.state === 'running') {
      this._detachGesture();
      // a crowd level requested before unlock takes effect now
      if (this._crowdLevel > 0 && !this._crowd) {
        try { this._applyCrowd(this._crowdLevel, this._crowdRamp); } catch (_) { /* ignore */ }
      }
    }
  }

  _detachGesture() {
    if (!this._gestureAttached) return;
    this._gestureAttached = false;
    window.removeEventListener('pointerdown', this._onGesture, { capture: true });
    window.removeEventListener('keydown', this._onGesture, { capture: true });
  }

  _buildGraph() {
    const ctx = this._ctx;

    this._master = ctx.createGain();
    this._master.gain.value = this._enabled ? this._volume : 0;
    this._master.connect(ctx.destination);

    // Safety ceiling. The DynamicsCompressor applies automatic makeup gain and lets fast
    // transients overshoot, so a pile-up of cues could exceed 1.0 without this.
    this._ceiling = ctx.createWaveShaper();
    this._ceiling.curve = makeCeilingCurve();
    this._ceiling.connect(this._master);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(this._ceiling);
    this._comp = comp;

    // every effect passes through this gain, which dips while the announcer speaks
    this._sfxDuck = ctx.createGain();
    this._sfxDuck.gain.value = 1;
    this._sfxDuck.connect(comp);

    this._cueBus = ctx.createGain();
    this._cueBus.gain.value = 1;
    this._cueBus.connect(this._sfxDuck);
    // one bus per category: the hierarchy of the mix lives in MIX, not in the callers
    this._catBus = {};
    for (const [cat, m] of Object.entries(MIX)) {
      const g = ctx.createGain();
      g.gain.value = m.gain;
      g.connect(this._cueBus);
      this._catBus[cat] = g;
    }

    // the announcer: straight to the ceiling, past the compressor
    this._voiceBus = ctx.createGain();
    this._voiceBus.gain.value = VOICE.gain;
    this._voiceBus.connect(this._ceiling);

    // crowd bed → bus trim → duck() gain → compressor
    this._crowdDuck = ctx.createGain();
    this._crowdDuck.gain.value = 1;
    this._crowdDuck.connect(this._sfxDuck);
    this._crowdBus = ctx.createGain();
    this._crowdBus.gain.value = CROWD.bus;
    this._crowdBus.connect(this._crowdDuck);

    // shared "room"
    this._reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    this._reverbIn.connect(conv);
    conv.connect(lp);
    lp.connect(wet);
    wet.connect(this._sfxDuck);

    const voiceSend = ctx.createGain();
    voiceSend.gain.value = VOICE.reverbSend;
    this._voiceBus.connect(voiceSend);
    voiceSend.connect(this._reverbIn);

    const crowdSend = ctx.createGain();
    crowdSend.gain.value = CROWD.reverbSend;
    this._crowdDuck.connect(crowdSend);
    crowdSend.connect(this._reverbIn);

    this._white = makeNoiseBuffer(ctx, 'white');
    this._brown = makeNoiseBuffer(ctx, 'brown');
  }

  _applyMaster() {
    if (!this._ctx || !this._master) return;
    const g = this._enabled ? this._volume : 0;
    const t = this._ctx.currentTime;
    this._master.gain.cancelScheduledValues(t);
    this._master.gain.setTargetAtTime(g, t, 0.015);
  }

  /** Start time: a hair of look-ahead plus ±10 ms so repeats never line up exactly. */
  _t0() {
    return this._ctx.currentTime + 0.012 + rnd(-0.01, 0.01);
  }

  /**
   * A voice groups the nodes of one cue: `out` goes to its category's bus (or the bus
   * given) and to the reverb send. Sources are registered with `src()`; when the last one
   * ends every node is disconnected. While it sounds it is counted against its category.
   */
  _voice(send = 0.2, bus = null) {
    const ctx = this._ctx;
    const cat = bus ? null : this._curCat;
    const out = ctx.createGain();
    out.connect(bus || (cat && this._catBus[cat]) || this._cueBus);
    const sendG = ctx.createGain();
    sendG.gain.value = send;
    out.connect(sendG);
    sendG.connect(this._reverbIn);
    const nodes = [out, sendG];
    const sources = [];
    let pending = 0;
    const rec = { cat, end: 0, kill: null };
    const free = () => {
      this._live.delete(rec);
      for (const n of nodes) { try { n.disconnect(); } catch (_) { /* ignore */ } }
      nodes.length = 0;
      sources.length = 0;
    };
    // fade this voice out early (muting, or a bigger crowd reaction taking over)
    rec.kill = (fadeS = 0.04) => {
      try {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0, now, fadeS / 3);
        for (const n of sources) { try { n.stop(now + fadeS + 0.02); } catch (_) { /* already stopped */ } }
        rec.end = Math.min(rec.end || Infinity, now + fadeS);
      } catch (_) { /* ignore */ }
    };
    if (cat) { this._live.add(rec); this._lastVoice = rec; }
    return {
      out,
      track(node) { nodes.push(node); return node; },
      src(node, start, stop, offset) {
        pending++;
        nodes.push(node);
        sources.push(node);
        if (stop > rec.end) rec.end = stop;
        node.onended = () => { if (--pending <= 0) free(); };
        try {
          if (offset != null) node.start(start, offset); else node.start(start);
          node.stop(stop);
        } catch (_) { pending--; }
        return node;
      },
    };
  }

  /** How many cue voices are still sounding: { n: in this category, total }. */
  _liveCount(cat) {
    const now = this._ctx.currentTime;
    let n = 0;
    let total = 0;
    for (const rec of Array.from(this._live)) {
      if (rec.end && rec.end <= now) { this._live.delete(rec); continue; }   // its end was missed: forget it
      total++;
      if (rec.cat === cat) n++;
    }
    return { n, total };
  }

  /** Fade out every cue that is sounding (muting must also cut a five second fanfare short). */
  _stopCues() {
    for (const rec of Array.from(this._live)) rec.kill(0.05);
    this._live.clear();
    this._choked.clear();
    this._held = {};
  }

  _cancelMoment() {
    for (const id of this._momentTimers) clearTimeout(id);
    this._momentTimers.clear();
  }

  /**
   * Click-free envelope on an AudioParam. Short attacks (≤ 50 ms) ramp exponentially
   * from the floor (punchy); longer ones ramp linearly from 0 (a natural swell).
   * Release is always an exponential decay to the floor. Returns the end time.
   */
  _env(param, t, { a = 0.005, peak = 0.2, hold = 0, r = 0.2 } = {}) {
    const p = Math.max(EPS, peak);
    if (a <= 0.05) {
      param.setValueAtTime(EPS, t);
      param.exponentialRampToValueAtTime(p, t + a);
    } else {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(p, t + a);
    }
    if (hold > 0) param.setValueAtTime(p, t + a + hold);
    const end = t + a + hold + r;
    param.exponentialRampToValueAtTime(EPS, end);
    return end;
  }

  _sweep(param, f0, f1, t, dur) {
    param.setValueAtTime(Math.max(1, f0), t);
    if (f1) param.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  }

  /**
   * Oscillator voice. f1 glides (exponential) over `glide` seconds, or jumps at `jump`
   * seconds. Optional lowpass (lp → lpTo over lpT) and vibrato {rate, cents}.
   */
  _osc(v, o) {
    const ctx = this._ctx;
    const { t, type = 'sine', f, f1, glide, jump, detune = 0,
      a = 0.005, peak = 0.2, hold = 0, r = 0.2,
      lp, lpTo, lpT, lpQ = 0.9, vibrato } = o;
    const total = a + hold + r;
    const end = t + total;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f), t);
    if (f1) {
      if (jump != null) osc.frequency.setValueAtTime(Math.max(1, f1), t + jump);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (glide ?? total));
    }
    if (detune) osc.detune.value = detune;

    if (vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vibrato.rate;
      const lg = v.track(ctx.createGain());
      lg.gain.value = vibrato.cents;
      lfo.connect(lg);
      lg.connect(osc.detune);
      v.src(lfo, t, end + 0.02);
    }

    let node = osc;
    if (lp) {
      const filt = v.track(ctx.createBiquadFilter());
      filt.type = 'lowpass';
      filt.Q.value = lpQ;
      this._sweep(filt.frequency, lp, lpTo, t, lpT ?? total);
      node.connect(filt);
      node = filt;
    }
    const g = v.track(ctx.createGain());
    this._env(g.gain, t, { a, peak, hold, r });
    node.connect(g);
    g.connect(v.out);
    v.src(osc, t, end + 0.02);
    return end;
  }

  /**
   * Noise voice from the shared buffers ('white' | 'brown'), through an optional
   * highpass (hp → hpTo), bandpass (bp → bpTo, Q q) and lowpass (lp → lpTo).
   */
  _noise(v, o) {
    const ctx = this._ctx;
    const { t, buf = 'white', a = 0.005, peak = 0.2, hold = 0, r = 0.2,
      hp, hpTo, bp, bpTo, bpT, q = 1, lp, lpTo, lpT, rate } = o;
    const total = a + hold + r;
    const end = t + total;

    const src = ctx.createBufferSource();
    src.buffer = buf === 'brown' ? this._brown : this._white;
    src.loop = true;
    if (rate) src.playbackRate.value = rate;

    let node = src;
    const filt = (type, f0, f1, Q, dur) => {
      const bq = v.track(ctx.createBiquadFilter());
      bq.type = type;
      bq.Q.value = Q;
      this._sweep(bq.frequency, f0, f1, t, dur);
      node.connect(bq);
      node = bq;
    };
    if (hp) filt('highpass', hp, hpTo, 0.7, total);
    if (bp) filt('bandpass', bp, bpTo, q, bpT ?? total);
    if (lp) filt('lowpass', lp, lpTo, 0.8, lpT ?? total);

    const g = v.track(ctx.createGain());
    this._env(g.gain, t, { a, peak, hold, r });
    node.connect(g);
    g.connect(v.out);
    v.src(src, t, end + 0.02, rnd(0, src.buffer.duration - 0.6));
    return end;
  }

  /** Bell-ish chime: fundamental + octave + a slightly sharp 3rd partial. Peak ≈ 1.27 × gain. */
  _chime(v, t, f, { gain = 0.2, r = 0.5, type = 'triangle', bright = 0.4, a = 0.004 } = {}) {
    this._osc(v, { t, type, f, a, peak: gain, r });
    this._osc(v, { t, type: 'sine', f: f * 2, a, peak: gain * bright * 0.5, r: r * 0.7 });
    this._osc(v, { t, type: 'sine', f: f * 3.01, a, peak: gain * bright * 0.18, r: r * 0.4 });
  }

  /** Scatter of tiny high sine pings over `spread` seconds. */
  _sparkle(v, t, count, { fMin = 2200, fMax = 5200, spread = 0.6, gain = 0.045 } = {}) {
    for (let k = 0; k < count; k++) {
      const tk = t + (k / count) * spread + rnd(0, spread / Math.max(1, count));
      this._osc(v, { t: tk, type: 'sine', f: rnd(fMin, fMax), a: 0.002, peak: gain, r: rnd(0.08, 0.2) });
    }
  }

  /** Bright noise transient that makes a sting "speak". */
  _tick(v, t, gain = 0.08, hp = 4000, r = 0.015) {
    this._noise(v, { t, buf: 'white', a: 0.001, peak: gain, r, hp });
  }

  _playSample(buffer, t, intensity, base = 0.55, vary = LEGACY_VARY) {
    const ctx = this._ctx;
    const v = this._voice(0.12);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // a physical sound never repeats exactly: a little pitch and level spread per take
    src.playbackRate.value = 1 + rnd(-vary.rate, vary.rate);
    const g = v.track(ctx.createGain());
    g.gain.value = base * (0.6 + 0.4 * intensity) * (1 + rnd(-vary.vary, vary.vary));
    src.connect(g);
    g.connect(v.out);
    v.src(src, t, t + buffer.duration / src.playbackRate.value + 0.05);
  }

  // ───────────────────────────── sampled effects ─────────────────────────────

  /** Fetch and decode an mp3. Resolves null for a missing or undecodable file. */
  async _fetchBuffer(url) {
    const ctx = this._ctx;
    if (!ctx || typeof fetch !== 'function') return null;
    // a file that was not there a moment ago is not asked for again straight away
    const missed = this._missing.get(url);
    if (missed && Date.now() - missed < 20000) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) { this._missing.set(url, Date.now()); return null; }
      // SPA servers answer unknown paths with index.html — only accept audio-ish types
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (type && !/audio|mpeg|mp3|octet-stream/i.test(type)) return null;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      return !this._disposed && this._ctx === ctx ? buf : null;
    } catch (_) {
      return null;
    }
  }

  /** `<sfxBase>manifest.json`: { cues: { 'crowd-roar': { files: ['crowd-roar.mp3', 'crowd-roar-2.mp3'] } } }. */
  async _loadSfxManifest() {
    if (typeof fetch !== 'function') return;
    let m = null;
    try {
      const res = await fetch(`${this._sfxBase}manifest.json`);
      if (res.ok) m = await res.json();
    } catch (_) { /* no manifest: only the synth and hand-dropped overrides */ }
    if (!m || !m.cues || typeof m.cues !== 'object' || this._disposed) return;
    for (const [name, e] of Object.entries(m.cues)) {
      const files = e && Array.isArray(e.files) ? e.files.filter((f) => typeof f === 'string' && /^[a-z0-9-]+\.mp3$/.test(f)) : [];
      if (!files.length) continue;
      // "hard" takes play when the cue is fired hard (a driver at full speed)
      const hard = e && Array.isArray(e.hard) ? e.hard.filter((f) => typeof f === 'string' && /^[a-z0-9-]+\.mp3$/.test(f)) : [];
      this._sfx.set(name, {
        urls: [...files, ...hard].map((f) => this._sfxBase + f),
        buffers: [...files, ...hard].map(() => null),
        soft: files.length,        // the first `soft` takes are the ordinary ones, the rest the hard ones
        peakS: e && Number(e.peakS) > 0 ? Number(e.peakS) : 0,   // a swell: where its peak is in the file
        last: -1,
      });
    }
    // decode them all in the background, a few at a time: they are short, and a cue cannot wait
    const jobs = [];
    for (const e of this._sfx.values()) e.urls.forEach((_, k) => jobs.push(() => this._loadSfxTake(e, k)));
    const worker = async () => { while (jobs.length) await jobs.shift()(); };
    await Promise.all([worker(), worker(), worker()]);
  }

  async _loadSfxTake(entry, k) {
    if (entry.buffers[k]) return;
    const url = entry.urls[k];
    // one fetch and decode per file, however many cues share it (roar is an alias of crowd-roar)
    let p = this._sfxFetches.get(url);
    if (!p) { p = this._fetchBuffer(url); this._sfxFetches.set(url, p); }
    const buf = await p;
    if (buf) entry.buffers[k] = buf;
    else this._sfxFetches.delete(url);   // missing for now: a later cue may try again
  }

  /** Play a random decoded take of a sampled cue. False when none is ready (the caller may synthesize). */
  _cueSample(entry, t, intensity, mix, hardAt = HARD_HIT) {
    const loaded = [];
    entry.buffers.forEach((b, k) => { if (b) loaded.push(k); else this._loadSfxTake(entry, k).catch(() => {}); });
    if (!loaded.length) return false;
    // a hard hit plays a hard take when there is one; anything else plays the ordinary ones
    const hard = loaded.filter((k) => k >= entry.soft);
    const soft = loaded.filter((k) => k < entry.soft);
    const ready = intensity >= hardAt && hard.length ? hard : soft.length ? soft : hard;
    const k = ready[pickTake(ready.length, ready.indexOf(entry.last))];
    entry.last = k;
    this._playSample(entry.buffers[k], t, intensity, SAMPLE_GAIN, mix);
    return true;
  }

  // ───────────────────────────── the announcer ─────────────────────────────

  _voiceUrl(file) { return `${this._voiceBase}${this._voicePack}/${file}`; }
  _nameUrl(slug) {
    return this._voicePack === DEFAULT_PACK ? `${this._namesBase}${slug}.mp3` : `${this._namesBase}${this._voicePack}/${slug}.mp3`;
  }

  /** The pack's manifest; an unknown pack falls back to the default one. Resolves null when there is none. */
  async _loadVoiceManifest() {
    if (typeof fetch !== 'function') return null;
    const read = async (pack) => {
      try {
        const res = await fetch(`${this._voiceBase}${pack}/manifest.json`);
        if (!res.ok) return null;
        const m = await res.json();
        return m && m.lines && typeof m.lines === 'object' ? m : null;
      } catch (_) {
        return null;
      }
    };
    let m = await read(this._voicePack);
    if (!m && this._voicePack !== DEFAULT_PACK) {
      m = await read(DEFAULT_PACK);
      if (m) this._voicePack = DEFAULT_PACK;
    }
    if (!m || this._disposed) return null;
    const lines = {};
    for (const [id, e] of Object.entries(m.lines)) {
      const files = e && Array.isArray(e.files) ? e.files.filter((f) => typeof f === 'string' && /^[a-z0-9-]+\.mp3$/.test(f)) : [];
      if (files.length) lines[id] = { text: e.text, files };
    }
    this._voiceManifest = { pack: this._voicePack, lines };
    // the likely first lines, decoded before anyone swings (two at a time, in the background)
    const jobs = [];
    for (const id of VOICE.hot) if (lines[id]) for (const f of lines[id].files) jobs.push(this._voiceUrl(f));
    const worker = async () => { while (jobs.length) await this._voiceClip(jobs.shift()); };
    Promise.all([worker(), worker()]).catch(() => {});
    return this._voiceManifest;
  }

  /**
   * A decoded announcer clip: { buffer, offset, duration, gain }. Pack clips are already
   * trimmed and levelled. A player-name clip comes straight from the voice API, so its
   * silence is skipped and its level matched here.
   */
  _voiceClip(url, { name = false } = {}) {
    const hit = this._voiceClips.get(url);
    if (hit) {
      this._voiceClips.delete(url);      // refresh its age
      this._voiceClips.set(url, hit);
      return hit;
    }
    const p = this._fetchBuffer(url).then((buffer) => {
      if (!buffer) { this._voiceClips.delete(url); return null; }
      return name ? levelNameClip(buffer) : { buffer, offset: 0, duration: buffer.duration, gain: 1 };
    }, () => { this._voiceClips.delete(url); return null; });
    this._voiceClips.set(url, p);
    while (this._voiceClips.size > VOICE.cacheMax) this._voiceClips.delete(this._voiceClips.keys().next().value);
    return p;
  }

  /** VoiceQueue's loader: an item -> a clip or null. */
  async _loadVoiceItem(item) {
    if (!this._ctx || this._disposed || !this._enabled) return null;
    if (item.kind === 'name') {
      const slug = nameSlug(item.name);
      if (!slug) return null;
      const missed = this._nameMiss.get(slug);
      if (missed && Date.now() - missed < 15000) return null;
      const clip = await this._voiceClip(this._nameUrl(slug), { name: true });
      if (!clip) {
        this._nameMiss.set(slug, Date.now());
        // not rendered yet: ask for it once, so the next mention has it (this one falls back)
        if (!this._nameAsked.has(slug)) this.prepareName(item.name).catch(() => {});
      }
      return clip;
    }
    const m = await this._voiceManifestP;
    const entry = m && m.lines[item.id];
    if (!entry) return null;
    const k = pickTake(entry.files.length, this._voiceLast.has(item.id) ? this._voiceLast.get(item.id) : -1);
    this._voiceLast.set(item.id, k);
    return this._voiceClip(this._voiceUrl(entry.files[k]));
  }

  /** VoiceQueue's player: start the clip now; returns the function that cuts it off. */
  _playVoice(clip, done) {
    if (!this._ready() || !this._enabled || !clip || !clip.buffer) { done(); return null; }
    const ctx = this._ctx;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const g = ctx.createGain();
    g.gain.value = clip.gain;
    src.connect(g);
    g.connect(this._voiceBus);
    let state = 0;   // 0 sounding, 1 cut off (fading), 2 over
    const release = () => { try { g.disconnect(); src.disconnect(); } catch (_) { /* ignore */ } };
    const stop = () => {
      if (state !== 0) return;
      state = 1;
      this._voiceSources.delete(stop);
      try {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.012);   // a 40 ms fade, not a click; onended frees the nodes
        src.stop(now + 0.06);
      } catch (_) { release(); }
    };
    src.onended = () => {
      const natural = state === 0;
      state = 2;
      this._voiceSources.delete(stop);
      release();
      if (natural) done();
    };
    this._voiceSources.add(stop);
    try {
      src.start(t, clip.offset, clip.duration);
    } catch (_) {
      state = 2;
      this._voiceSources.delete(stop);
      release();
      done();
      return null;
    }
    return stop;
  }

  _stopVoiceSources() {
    for (const stop of Array.from(this._voiceSources)) stop();
    this._voiceSources.clear();
  }

  /** The effects dip while the announcer speaks and come back when the queue runs dry. */
  _duckSfx(on) {
    if (!this._ctx || !this._sfxDuck) return;
    try {
      const t = this._ctx.currentTime;
      const g = this._sfxDuck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(on ? VOICE.duck : 1, t, on ? VOICE.duckIn : VOICE.duckOut);
    } catch (_) { /* ignore */ }
  }

  /** Look for <sfxBase><cue>.mp3 once; a hit replaces that cue's synth. */
  async _probeSamples() {
    if (this._probed || typeof fetch !== 'function') return;
    this._probed = true;
    const ctx = this._ctx;
    // only the original synthesized cues; <cue>.mp3 is skipped when it is itself a generated take (oooh.mp3)
    const generated = (name) => { const e = this._sfx.get(name); return !!e && e.urls.includes(this._sfxBase + name + '.mp3'); };
    await Promise.all(LEGACY_CUE_NAMES.filter((name) => !generated(name)).map(async (name) => {
      const url = this._sfxBase + name + '.mp3';
      try {
        const head = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
        if (!head.ok) return;
        // SPA servers answer unknown paths with index.html — only accept audio-ish types
        const type = head.headers.get('content-type') || '';
        if (type && !/audio|mpeg|mp3|octet-stream/i.test(type)) return;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(data);
        if (!this._disposed && this._ctx === ctx) this._samples.set(name, buf);
      } catch (_) {
        // no file (or undecodable): the synth stays in charge of this cue
      }
    }));
  }

  // ───────────────────────────── crowd bed ─────────────────────────────

  _ensureCrowd() {
    if (this._crowd) return this._crowd;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const c = {};

    // whole-bed "breathing": gain 1 ± slow LFOs, plus a faster flutter for chatter texture
    c.breath = ctx.createGain();
    c.breath.gain.value = 1;
    c.breath.connect(this._crowdBus);
    const lfo = (rate, depth) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(c.breath.gain);
      o.start(t);
      return o;
    };
    c.lfos = [lfo(0.11, CROWD.breathe * 0.6), lfo(0.237, CROWD.breathe * 0.4), lfo(4.3, 0.05)];

    c.murmur = ctx.createGain();
    c.murmur.gain.value = EPS;
    c.murmur.connect(c.breath);
    c.cheer = ctx.createGain();
    c.cheer.gain.value = EPS;
    c.cheer.connect(c.breath);

    const band = (src, type, f, Q, g, dest) => {
      const bq = ctx.createBiquadFilter();
      bq.type = type;
      bq.frequency.value = f;
      bq.Q.value = Q;
      const gn = ctx.createGain();
      gn.gain.value = g;
      src.connect(bq);
      bq.connect(gn);
      gn.connect(dest);
    };

    // murmur: brown noise shaped into three vowel-ish bands (brown has little energy up
    // there, hence the band gains)
    const brown = ctx.createBufferSource();
    brown.buffer = this._brown;
    brown.loop = true;
    band(brown, 'bandpass', 280, 0.8, 2.5, c.murmur);
    band(brown, 'bandpass', 620, 1.6, 4.0, c.murmur);
    band(brown, 'bandpass', 1100, 1.2, 5.0, c.murmur);

    // cheer: brighter white-noise bands
    const white = ctx.createBufferSource();
    white.buffer = this._white;
    white.loop = true;
    band(white, 'bandpass', 1600, 0.6, 1.0, c.cheer);
    band(white, 'highpass', 3500, 0.7, 0.3, c.cheer);
    band(white, 'bandpass', 700, 1.0, 0.5, c.cheer);

    brown.start(t, rnd(0, 1.5));
    white.start(t, rnd(0, 1.5));
    c.brown = brown;
    c.white = white;
    this._crowd = c;
    return c;
  }

  _applyCrowd(level, ramp) {
    const c = this._ensureCrowd();
    const t = this._ctx.currentTime;
    // murmur is full by level 0.5 (perceptual curve so a low bed is still audible);
    // the cheer layer fades in above 0.3
    const murmur = level <= 0 ? EPS : CROWD.murmur * Math.pow(Math.min(1, level / 0.5), 0.6);
    const cheer = CROWD.cheer * Math.max(0, (level - 0.3) / 0.7);
    for (const [param, target] of [[c.murmur.gain, murmur], [c.cheer.gain, cheer]]) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(Math.max(EPS, param.value), t);
      param.exponentialRampToValueAtTime(Math.max(EPS, target), t + ramp);
    }
    if (level >= 0.3 && !this._whoopTimer) this._scheduleWhoop();
  }

  _scheduleWhoop() {
    if (this._whoopTimer) clearTimeout(this._whoopTimer);
    this._whoopTimer = 0;
    if (this._disposed || !this._crowd || this._crowdLevel < 0.3) return;
    const lvl = this._crowdLevel;
    const delay = rnd(160, 900) / (0.35 + lvl); // sparse at 0.3, lively at 1
    this._whoopTimer = setTimeout(() => {
      this._whoopTimer = 0;
      if (!this._ready() || !this._enabled) { this._scheduleWhoop(); return; }
      try { this._whoop(this._crowdLevel); } catch (_) { /* ignore */ }
      this._scheduleWhoop();
    }, delay);
  }

  /** One random crowd event: a voiced whoop, a whistle blip or a clap. */
  _whoop(level) {
    const t = this._t0();
    const v = this._voice(0.3, this._crowdBus);
    const g = CROWD.whoop * (0.4 + 0.6 * level) / CROWD.bus; // compensate the bus gain
    const pick = Math.random();
    if (pick < 0.45) {
      const f = rnd(230, 340);
      this._osc(v, { t, type: 'sawtooth', f, f1: f * rnd(1.4, 1.8), glide: 0.22,
        a: 0.04, peak: g * 0.8, hold: 0.05, r: 0.25, lp: 650, lpTo: 1100 });
    } else if (pick < 0.75) {
      const f = rnd(1400, 2600);
      this._osc(v, { t, type: 'sine', f, f1: f * 1.25, glide: 0.1, a: 0.02, peak: g * 0.7, r: 0.14 });
    } else {
      this._noise(v, { t, buf: 'white', a: 0.001, peak: g, r: 0.03, hp: 1800, bp: 3000, q: 0.8 });
    }
  }

  // ───────────────────────────── cues ─────────────────────────────
  // Each takes (t, intensity 0..1). Target: summed peak ≤ ~0.6 at the cue bus.

  _cueStrike(t, i) {
    const v = this._voice(0.12);
    // crack: bright noise whose filter falls as it dies
    this._noise(v, { t, buf: 'white', a: 0.0015, peak: 0.2 + 0.22 * i, r: 0.025 + 0.06 * i,
      bp: 1500 + 3500 * i, bpTo: 600 + 800 * i, bpT: 0.06, q: 0.7 });
    // body thump
    this._osc(v, { t, type: 'sine', f: jitter(160 + 60 * i), f1: 55, glide: 0.07,
      a: 0.002, peak: 0.12 + 0.16 * i, r: 0.1 + 0.08 * i });
    // metallic click on hard hits
    if (i > 0.35) this._osc(v, { t, type: 'triangle', f: jitter(2600 + 1500 * i), a: 0.001, peak: 0.08 * i, r: 0.012 });
  }

  _cueBounce(t, i) {
    const v = this._voice(0.1);
    this._noise(v, { t, buf: 'brown', a: 0.003, peak: 0.16 + 0.14 * i, r: 0.05 + 0.05 * i, lp: 500 + 400 * i });
    this._osc(v, { t, type: 'sine', f: jitter(120 + 40 * i), f1: 45, glide: 0.09, a: 0.003, peak: 0.14 + 0.1 * i, r: 0.1 });
  }

  _cueSplash(t, i) {
    const v = this._voice(0.35);
    // plop
    this._osc(v, { t, type: 'sine', f: jitter(520), f1: 140, glide: 0.09, a: 0.004, peak: 0.18, r: 0.12 });
    // swoosh: band-pass sweeping down
    this._noise(v, { t: t + 0.01, buf: 'white', a: 0.03, peak: 0.3 + 0.1 * i, hold: 0.05, r: 0.55 + 0.3 * i,
      bp: 2600, bpTo: 350, bpT: 0.6, q: 1.1 });
    // droplets
    const drops = 3 + Math.round(3 * i);
    for (let k = 0; k < drops; k++) {
      const f = rnd(1100, 2600);
      this._osc(v, { t: t + rnd(0.12, 0.55), type: 'sine', f, f1: f * 1.4, glide: 0.04, a: 0.002, peak: 0.05, r: 0.08 });
    }
  }

  _cueGasp(t, i) {
    const v = this._voice(0.3);
    this._noise(v, { t, buf: 'white', a: 0.22, peak: 0.26 + 0.08 * i, hold: 0.04, r: 0.28,
      hp: 1200, bp: 1500, bpTo: 3800, bpT: 0.3, q: 0.8 });
    this._noise(v, { t, buf: 'brown', a: 0.2, peak: 0.08, r: 0.3, bp: 500, q: 1.2 });
  }

  _cueOooh(t, i) {
    const v = this._voice(0.4);
    const rise = 1.1 + 0.2 * i;
    this._noise(v, { t, buf: 'brown', a: rise, peak: 0.2, hold: 0.35, r: 0.6, bp: 420, bpTo: 700, bpT: rise, q: 0.7 });
    this._noise(v, { t, buf: 'white', a: rise, peak: 0.12 + 0.08 * i, hold: 0.35, r: 0.6, bp: 1500, q: 0.6 });
    // "ooo" vowel: detuned saws under a low formant
    const base = jitter(200);
    [1, 1.012, 1.5, 0.503].forEach((m, k) => {
      const f = base * m * rnd(0.99, 1.01);
      this._osc(v, { t: t + k * 0.03, type: 'sawtooth', f, f1: f * 1.08, glide: rise,
        a: rise * 0.9, peak: 0.035, hold: 0.35, r: 0.6, lp: 550, lpTo: 800, lpT: rise });
    });
  }

  _cueRoar(t, i) {
    const v = this._voice(0.45);
    const len = 2.2 + 0.8 * i;
    this._noise(v, { t, buf: 'white', a: 0.35, peak: 0.26 + 0.06 * i, hold: len * 0.45, r: len * 0.5,
      bp: 1300, bpTo: 900, bpT: len, q: 0.4 });
    this._noise(v, { t, buf: 'brown', a: 0.3, peak: 0.16, hold: len * 0.45, r: len * 0.5, bp: 380, q: 0.7 });
    // whistles
    const whistles = 3 + Math.round(3 * i);
    for (let k = 0; k < whistles; k++) {
      const f = rnd(1700, 3100);
      this._osc(v, { t: t + rnd(0.2, len * 0.7), type: 'sine', f, f1: f * rnd(1.15, 1.4), glide: 0.2,
        a: 0.03, peak: 0.06, hold: 0.05, r: 0.25 });
    }
    // whoops
    const whoops = 2 + Math.round(2 * i);
    for (let k = 0; k < whoops; k++) {
      const f = rnd(230, 330);
      this._osc(v, { t: t + rnd(0.1, len * 0.6), type: 'sawtooth', f, f1: f * 1.6, glide: 0.2,
        a: 0.04, peak: 0.045, hold: 0.05, r: 0.25, lp: 700, lpTo: 1200 });
    }
  }

  _cuePerfect(t, i) {
    const v = this._voice(0.5);
    const root = jitter(523.25, 0.03); // C5, whole chord moves together
    [1, 1.25, 1.5].forEach((m, k) => this._chime(v, t + k * 0.085, root * m, { gain: 0.19, r: k === 2 ? 1.1 : 0.55 }));
    this._tick(v, t, 0.1);
    this._sparkle(v, t + 0.2, 6 + Math.round(4 * i), { gain: 0.04, spread: 0.6 });
  }

  _cueGreat(t, i) {
    const v = this._voice(0.45);
    const root = jitter(587.33, 0.03); // D5 → A5
    this._chime(v, t, root, { gain: 0.2, r: 0.45 });
    this._chime(v, t + 0.1, root * 1.5, { gain: 0.2, r: 0.9 });
    this._tick(v, t, 0.09);
    this._sparkle(v, t + 0.2, 2 + Math.round(2 * i), { gain: 0.035, spread: 0.35 });
  }

  _cueGood(t, _i) {
    const v = this._voice(0.4);
    this._chime(v, t, jitter(880, 0.03), { gain: 0.24, r: 0.6, bright: 0.6 });
    this._tick(v, t, 0.06);
  }

  _cueOk(t, _i) {
    const v = this._voice(0.15);
    this._osc(v, { t, type: 'triangle', f: jitter(1150), a: 0.001, peak: 0.14, r: 0.04 });
    this._tick(v, t, 0.05, 3000, 0.01);
  }

  _cueMiss(t, _i) {
    const v = this._voice(0.3);
    const a4 = jitter(440, 0.03);
    this._osc(v, { t, type: 'triangle', f: a4, a: 0.004, peak: 0.2, hold: 0.08, r: 0.3, lp: 1800 });
    // second note a major third down, with a sour detuned twin
    const f4 = a4 * 0.7937;
    this._osc(v, { t: t + 0.19, type: 'triangle', f: f4, a: 0.004, peak: 0.18, hold: 0.1, r: 0.6, lp: 1600 });
    this._osc(v, { t: t + 0.19, type: 'triangle', f: f4, detune: -25, a: 0.004, peak: 0.07, hold: 0.1, r: 0.6, lp: 1600 });
    this._tick(v, t, 0.05, 3000, 0.012);
  }

  _cueDisaster(t, i) {
    const v = this._voice(0.35);
    const dur = 0.9 + 0.3 * i;
    const f0 = jitter(262, 0.03);
    // sad trombone: two detuned saws sliding down an octave, with vibrato, filter closing
    for (const det of [0, 9]) {
      this._osc(v, { t, type: 'sawtooth', f: f0, f1: f0 * 0.5, glide: dur, detune: det,
        a: 0.04, peak: 0.13, hold: dur * 0.3, r: dur * 0.8,
        lp: 1300, lpTo: 450, lpT: dur, vibrato: { rate: 5.5, cents: 18 } });
    }
    // womp
    const tw = t + dur * 0.75;
    this._osc(v, { t: tw, type: 'sine', f: 95, f1: 38, glide: 0.35, a: 0.02, peak: 0.28, r: 0.45 });
    this._noise(v, { t: tw, buf: 'brown', a: 0.02, peak: 0.1, r: 0.3, lp: 250 });
  }

  _cueJackpot(t, i) {
    const v = this._voice(0.5);
    const root = jitter(523.25, 0.02);
    // fanfare arpeggio up two octaves
    [1, 1.25, 1.5, 2, 2.5, 3, 4].forEach((m, k) => this._chime(v, t + k * 0.07, root * m, { gain: 0.13, r: 0.3, bright: 0.5 }));
    // sustained chord
    [2, 2.5, 3].forEach((m) => this._chime(v, t + 0.5, root * m, { gain: 0.09, r: 1.6 }));
    this._osc(v, { t: t + 0.5, type: 'triangle', f: root, a: 0.01, peak: 0.1, hold: 0.3, r: 1.2 });
    // roar-like tail
    this._noise(v, { t: t + 0.3, buf: 'white', a: 0.35, peak: 0.15, hold: 0.9, r: 1.2, bp: 1500, q: 0.5 });
    this._noise(v, { t: t + 0.3, buf: 'brown', a: 0.35, peak: 0.08, hold: 0.9, r: 1.2, bp: 400, q: 0.7 });
    this._tick(v, t, 0.1);
    this._sparkle(v, t + 0.4, 10 + Math.round(6 * i), { spread: 1.6, gain: 0.045, fMin: 2500, fMax: 6000 });
  }

  _cueRocket(t, i) {
    const v = this._voice(0.2);
    const dur = 0.95 + 0.25 * i;
    // resonant whoosh sweeping up
    this._noise(v, { t, buf: 'white', a: 0.12, peak: 0.3, hold: dur * 0.7, r: dur * 0.35,
      bp: 260, bpTo: 4200, bpT: dur, q: 2.2 });
    // rising sub + gritty engine
    this._osc(v, { t, type: 'sine', f: 42, f1: 115, glide: dur, a: 0.15, peak: 0.22, hold: dur * 0.6, r: dur * 0.4 });
    this._osc(v, { t, type: 'sawtooth', f: 58, f1: 190, glide: dur, a: 0.1, peak: 0.09, hold: dur * 0.6, r: dur * 0.4,
      lp: 350, lpTo: 900, lpT: dur });
  }

  _cueArmed(t, _i) {
    const v = this._voice(0.15);
    this._osc(v, { t, type: 'square', f: jitter(1050), f1: 1600, glide: 0.035, a: 0.002, peak: 0.1, hold: 0.02, r: 0.05, lp: 4500 });
    this._osc(v, { t, type: 'sine', f: jitter(2100), a: 0.002, peak: 0.09, r: 0.06 });
    this._tick(v, t, 0.05, 5000, 0.01);
  }

  _cueCoins(t, i) {
    const v = this._voice(0.25);
    const n = 3 + Math.round(7 * i);
    let tk = t;
    for (let k = 0; k < n; k++) {
      const f = jitter(988, 0.03) * Math.pow(1.03, k); // B5, creeping up the cascade
      this._osc(v, { t: tk, type: 'sine', f, f1: f * 1.335, jump: 0.028, a: 0.002, peak: 0.16, hold: 0.03, r: 0.2 });
      this._osc(v, { t: tk, type: 'triangle', f: f * 2, a: 0.002, peak: 0.04, r: 0.12 });
      tk += 0.055 + rnd(-0.01, 0.012);
    }
  }

  _cueLevelup(t, _i) {
    const v = this._voice(0.55);
    const root = jitter(523.25, 0.02);
    [1, 1.25, 1.5, 2].forEach((m, k) => this._chime(v, t + k * 0.13, root * m, { gain: 0.17, r: k === 3 ? 1.3 : 0.45 }));
    // bright pad: detuned saw pairs, filter opening
    for (const m of [1, 1.25, 1.5]) {
      for (const det of [-7, 7]) {
        this._osc(v, { t, type: 'sawtooth', f: root * m, detune: det, a: 0.35, peak: 0.028, hold: 0.9, r: 0.9,
          lp: 700, lpTo: 3200, lpT: 1.0 });
      }
    }
    this._tick(v, t, 0.08);
    this._sparkle(v, t + 0.45, 7, { spread: 0.9, gain: 0.04 });
  }

  _cueStreak(t, i) {
    const v = this._voice(0.4);
    const f = 660 * Math.pow(2, i) * rnd(0.98, 1.02); // 660 Hz at streak 0 → 1320 Hz at 10+
    this._chime(v, t, f, { gain: 0.2, r: 0.3, bright: 0.5 });
    this._chime(v, t + 0.065, f * 1.5, { gain: 0.2, r: 0.5, bright: 0.5 });
    this._tick(v, t, 0.07);
    if (i > 0.5) this._sparkle(v, t + 0.1, Math.round(2 + 4 * i), { fMin: f * 2, fMax: Math.min(9000, f * 5), spread: 0.3, gain: 0.035 });
  }

  // ── the physical game (stand-ins until the generated samples exist; summed peak ≤ ~0.5) ──

  /** The ball rattling into the cup: a few hollow knocks, quicker and quieter, then it settles. */
  _cueCupDrop(t, i) {
    const v = this._voice(0.18);
    const k = 0.75 + 0.25 * i;
    [0, 0.085, 0.15, 0.2, 0.238].forEach((dt, n) => {
      const g = k * Math.pow(0.72, n);
      const f = jitter(430 - 22 * n, 0.04);
      this._osc(v, { t: t + dt, type: 'sine', f, f1: f * 0.8, glide: 0.03, a: 0.001, peak: 0.2 * g, r: 0.05 });
      this._noise(v, { t: t + dt, buf: 'white', a: 0.001, peak: 0.1 * g, r: 0.022, bp: jitter(950, 0.08), q: 3 });
    });
    this._osc(v, { t: t + 0.27, type: 'sine', f: 150, f1: 90, glide: 0.08, a: 0.004, peak: 0.1 * k, r: 0.09 });
  }

  /** Ball on the flagstick: a short inharmonic metal ring. */
  _cueFlagClank(t, i) {
    const v = this._voice(0.3);
    const f = jitter(1450, 0.04);
    const k = 0.7 + 0.3 * i;
    [[1, 0.16, 0.45], [2.76, 0.1, 0.32], [5.4, 0.055, 0.2], [8.93, 0.03, 0.1]].forEach(([m, g, r]) => {
      this._osc(v, { t, type: 'sine', f: f * m, a: 0.001, peak: g * k, r });
    });
    this._tick(v, t, 0.1 * k, 3000, 0.012);
  }

  /** Ball plugging in a bunker: a dull thud and a spray of grains. */
  _cueSandThud(t, i) {
    const v = this._voice(0.08);
    this._noise(v, { t, buf: 'brown', a: 0.003, peak: 0.24 + 0.1 * i, r: 0.11, lp: jitter(360, 0.1) });
    this._noise(v, { t: t + 0.01, buf: 'white', a: 0.01, peak: 0.05 + 0.03 * i, r: 0.12, hp: 2500 });
    this._osc(v, { t, type: 'sine', f: jitter(95), f1: 50, glide: 0.07, a: 0.003, peak: 0.1, r: 0.09 });
  }

  /** Ball on a tree trunk: a hollow woody knock and a few leaves. */
  _cueTreeKnock(t, i) {
    const v = this._voice(0.2);
    const f = jitter(620, 0.08);
    this._osc(v, { t, type: 'sine', f, f1: f * 0.7, glide: 0.04, a: 0.001, peak: 0.2 + 0.06 * i, r: 0.07 });
    this._osc(v, { t, type: 'triangle', f: f * 2.3, a: 0.001, peak: 0.06, r: 0.03 });
    this._noise(v, { t, buf: 'brown', a: 0.002, peak: 0.12, r: 0.06, lp: 900 });
    this._noise(v, { t: t + 0.05, buf: 'white', a: 0.03, peak: 0.04, r: 0.24, hp: 3500 });
  }

  /** Ball into lava: a heavy plop and one short hiss of steam that dies away. */
  _cueLavaSizzle(t, i) {
    const v = this._voice(0.25);
    this._osc(v, { t, type: 'sine', f: jitter(300), f1: 85, glide: 0.14, a: 0.004, peak: 0.2, r: 0.16 });
    this._noise(v, { t: t + 0.04, buf: 'white', a: 0.03, peak: 0.12 + 0.05 * i, hold: 0.15, r: 0.6 + 0.3 * i,
      hp: 2200, bp: 5200, bpTo: 2600, bpT: 0.8, q: 0.6 });
    this._noise(v, { t: t + 0.02, buf: 'brown', a: 0.02, peak: 0.08, r: 0.3, lp: 300 });
  }

  /** Ball on ice: a glassy tick and a short scrape. */
  _cueIceSkid(t, i) {
    const v = this._voice(0.3);
    const f = jitter(2400, 0.05);
    this._osc(v, { t, type: 'sine', f, a: 0.001, peak: 0.1, r: 0.07 });
    this._osc(v, { t, type: 'sine', f: f * 1.51, a: 0.001, peak: 0.05, r: 0.05 });
    this._tick(v, t, 0.09, 4500, 0.01);
    this._noise(v, { t: t + 0.03, buf: 'white', a: 0.03, peak: 0.05 + 0.03 * i, hold: 0.12, r: 0.22, hp: 5000, bp: 7000, bpTo: 5200, q: 1.2 });
  }

  /** Ball into long grass: a soft swish. */
  _cueRoughRustle(t, i) {
    const v = this._voice(0.08);
    this._noise(v, { t, buf: 'white', a: 0.02, peak: 0.09 + 0.05 * i, r: 0.16, bp: jitter(2600, 0.1), bpTo: 1500, q: 0.5 });
    this._noise(v, { t, buf: 'brown', a: 0.004, peak: 0.12, r: 0.08, lp: 480 });
  }

  // ── game feel ──

  _cueUiTick(t, _i) {
    const v = this._voice(0.04);
    this._osc(v, { t, type: 'triangle', f: jitter(1800, 0.02), a: 0.001, peak: 0.12, r: 0.025 });
    this._tick(v, t, 0.04, 4000, 0.008);
  }

  _cueUiConfirm(t, _i) {
    const v = this._voice(0.2);
    const f = jitter(880, 0.01);
    this._chime(v, t, f, { gain: 0.15, r: 0.12 });
    this._chime(v, t + 0.07, f * 1.5, { gain: 0.17, r: 0.3 });
  }

  _cueUiBack(t, _i) {
    const v = this._voice(0.1);
    const f = jitter(520, 0.01);
    this._osc(v, { t, type: 'triangle', f, f1: f * 0.75, glide: 0.09, a: 0.003, peak: 0.16, r: 0.14, lp: 1800 });
  }

  /** The other player's turn: two bell notes, a fourth apart. */
  _cueTurnChime(t, _i) {
    const v = this._voice(0.45);
    const f = jitter(659.25, 0.01);
    this._chime(v, t, f, { gain: 0.17, r: 0.5 });
    this._chime(v, t + 0.16, f * 1.335, { gain: 0.19, r: 0.9 });
    this._tick(v, t, 0.05);
  }

  /** One tick of a counter running up: intensity 0..1 raises the pitch as the count climbs. */
  _cueTrophyTick(t, i) {
    const v = this._voice(0.08);
    const f = 1300 * Math.pow(2, i * 0.5) * rnd(0.99, 1.01);
    this._osc(v, { t, type: 'sine', f, a: 0.001, peak: 0.11, r: 0.04 });
    this._tick(v, t, 0.03, 6000, 0.006);
  }

  _cueCountdownBeep(t, i) {
    const v = this._voice(0.1);
    const f = i > 0.9 ? 1320 : 880;   // intensity 1 is the "go" beep, an octave-and-a-bit up
    this._osc(v, { t, type: 'square', f, a: 0.003, peak: 0.1, hold: 0.09 + 0.2 * (i > 0.9), r: 0.06, lp: 3200 });
    this._osc(v, { t, type: 'sine', f, a: 0.003, peak: 0.1, hold: 0.09 + 0.2 * (i > 0.9), r: 0.06 });
  }

  /** Arming a rare ball: the armed blip, a bright fifth and a shimmer. */
  _cueArmRare(t, i) {
    this._cueArmed(t, i);
    const v = this._voice(0.35);
    const f = jitter(784, 0.01);
    this._chime(v, t + 0.05, f, { gain: 0.12, r: 0.25 });
    this._chime(v, t + 0.12, f * 1.5, { gain: 0.13, r: 0.5 });
    this._sparkle(v, t + 0.15, 4, { gain: 0.03, spread: 0.3 });
  }

  /** Arming an epic ball: a rising surge under a three-note fanfare and sparks. */
  _cueArmEpic(t, i) {
    const v = this._voice(0.4);
    const f = jitter(523.25, 0.01);
    this._osc(v, { t, type: 'sine', f: 48, f1: 130, glide: 0.5, a: 0.12, peak: 0.16, hold: 0.25, r: 0.35 });
    this._noise(v, { t, buf: 'white', a: 0.3, peak: 0.1, r: 0.25, bp: 400, bpTo: 4500, bpT: 0.5, q: 1.8 });
    [1, 1.5, 2].forEach((m, k) => this._chime(v, t + 0.12 + k * 0.09, f * m, { gain: 0.11, r: k === 2 ? 0.9 : 0.3, bright: 0.5 }));
    this._sparkle(v, t + 0.4, 6 + Math.round(4 * i), { gain: 0.035, spread: 0.6 });
  }

  /** A party popper: one pop and the paper fluttering down. */
  _cueConfettiPop(t, i) {
    const v = this._voice(0.3);
    this._noise(v, { t, buf: 'white', a: 0.001, peak: 0.26, r: 0.06, bp: jitter(1800, 0.1), q: 0.6 });
    this._osc(v, { t, type: 'sine', f: 180, f1: 70, glide: 0.07, a: 0.002, peak: 0.14, r: 0.08 });
    this._sparkle(v, t + 0.08, 5 + Math.round(4 * i), { gain: 0.03, spread: 0.5, fMin: 2600, fMax: 6500 });
  }

  /** One rise (never a loop): 1.8 to 2.3 s climbing in pitch and level, stopping at its peak. */
  _cueRiser(t, i) {
    const v = this._voice(0.3);
    const dur = 1.8 + 0.5 * i;
    this._noise(v, { t, buf: 'white', a: dur, peak: 0.2, r: 0.06, bp: 300, bpTo: 5000, bpT: dur, q: 1.6 });
    this._osc(v, { t, type: 'sawtooth', f: 110, f1: 440, glide: dur, a: dur, peak: 0.06, r: 0.05, lp: 600, lpTo: 3200, lpT: dur });
    this._osc(v, { t, type: 'sine', f: 55, f1: 220, glide: dur, a: dur, peak: 0.12, r: 0.05 });
  }

  /** One heartbeat (lub-dub) for a must-make moment. */
  _cueHeartbeatHit(t, i) {
    const v = this._voice(0.12);
    const k = 0.75 + 0.25 * i;
    this._osc(v, { t, type: 'sine', f: 62, f1: 40, glide: 0.1, a: 0.006, peak: 0.3 * k, r: 0.15 });
    this._osc(v, { t: t + 0.19, type: 'sine', f: 55, f1: 36, glide: 0.12, a: 0.006, peak: 0.2 * k, r: 0.2 });
    this._noise(v, { t, buf: 'brown', a: 0.004, peak: 0.07 * k, r: 0.08, lp: 140 });
  }

  /** The streak grows: three quick rising notes (intensity raises the key). */
  _cueStreakUp(t, i) {
    const v = this._voice(0.4);
    const f = 660 * (1 + 0.5 * i) * rnd(0.99, 1.01);
    [1, 1.25, 1.5].forEach((m, k) => this._chime(v, t + k * 0.055, f * m, { gain: 0.14, r: k === 2 ? 0.45 : 0.18, bright: 0.5 }));
    this._tick(v, t, 0.05);
    this._sparkle(v, t + 0.16, 3, { gain: 0.03, spread: 0.25, fMin: f * 2, fMax: Math.min(9000, f * 5) });
  }

  /** The streak is gone: a note falling away and a small fizzle. */
  _cueStreakBreak(t, _i) {
    const v = this._voice(0.3);
    const f = jitter(660, 0.02);
    this._osc(v, { t, type: 'triangle', f, f1: f / 3, glide: 0.35, a: 0.004, peak: 0.16, r: 0.36, lp: 1600 });
    this._osc(v, { t, type: 'triangle', f, f1: f / 3, glide: 0.35, detune: -30, a: 0.004, peak: 0.06, r: 0.36, lp: 1600 });
    this._noise(v, { t: t + 0.02, buf: 'white', a: 0.01, peak: 0.07, r: 0.14, hp: 3200 });
  }

  /** A screen wipe: one airy swish (~0.3 s). */
  _cueWhoosh(t, i) {
    const v = this._voice(0.15);
    this._noise(v, { t, buf: 'white', a: 0.1, peak: 0.16 + 0.06 * i, hold: 0.02, r: 0.2, bp: jitter(500), bpTo: 3800, bpT: 0.3, q: 1.4 });
  }

  /** Time sagging into slow motion: a soft whoosh and tone bending down two octaves (~0.4 s). */
  _cueSlowmoIn(t, i) {
    const v = this._voice(0.35);
    const k = 0.7 + 0.3 * i;
    this._noise(v, { t, buf: 'white', a: 0.06, peak: 0.2 * k, hold: 0.04, r: 0.34,
      bp: jitter(2600), bpTo: 280, bpT: 0.42, q: 1.6 });
    const f = jitter(620);
    this._osc(v, { t, type: 'sine', f, f1: f * 0.25, glide: 0.42, a: 0.03, peak: 0.12 * k, hold: 0.05, r: 0.36 });
    this._osc(v, { t, type: 'triangle', f: f * 1.5, f1: f * 0.375, glide: 0.42, a: 0.03, peak: 0.04 * k, r: 0.3,
      lp: 2200, lpTo: 500, lpT: 0.4 });
    // sub settling in underneath
    this._osc(v, { t: t + 0.12, type: 'sine', f: 90, f1: 48, glide: 0.3, a: 0.08, peak: 0.1 * k, r: 0.3 });
  }

  /** The mirror image: swells while bending back up, ending on a small air release. */
  _cueSlowmoOut(t, i) {
    const v = this._voice(0.35);
    const k = 0.7 + 0.3 * i;
    this._noise(v, { t, buf: 'white', a: 0.3, peak: 0.2 * k, r: 0.12,
      bp: 280, bpTo: jitter(2800), bpT: 0.4, q: 1.6 });
    const f = jitter(620);
    this._osc(v, { t, type: 'sine', f: f * 0.25, f1: f, glide: 0.38, a: 0.28, peak: 0.12 * k, r: 0.14 });
    this._osc(v, { t, type: 'triangle', f: f * 0.375, f1: f * 1.5, glide: 0.38, a: 0.28, peak: 0.04 * k, r: 0.12,
      lp: 500, lpTo: 2400, lpT: 0.38 });
    this._tick(v, t + 0.38, 0.04 * k, 5000, 0.03);
  }
}

/**
 * A player-name clip arrives un-trimmed and at whatever level the voice API chose: find
 * where the voice starts and stops, and the gain that brings it to the pack's level
 * (about −17 dB RMS over the spoken part, peaks no higher than −2 dBFS).
 */
export function levelNameClip(buffer) {
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const n = d.length;
  const win = Math.max(1, Math.round(sr * 0.005));
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (!(peak > 0.001)) return { buffer, offset: 0, duration: buffer.duration, gain: 1 };
  const thr = Math.max(peak * 0.01, 0.001);     // 40 dB under the peak
  let a = 0;
  let b = n - 1;
  while (a < n && Math.abs(d[a]) < thr) a++;
  while (b > a && Math.abs(d[b]) < thr) b--;
  a = Math.max(0, a - win);
  b = Math.min(n - 1, b + win * 12);            // keep 60 ms of tail
  let sum = 0;
  for (let i = a; i <= b; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / Math.max(1, b - a + 1));
  const want = 0.141;                           // −17 dB RMS
  const gain = Math.min(rms > 0 ? want / rms : 1, 0.794 / peak, 8);
  return { buffer, offset: a / sr, duration: (b - a + 1) / sr, gain };
}

export default ArcadeAudio;
