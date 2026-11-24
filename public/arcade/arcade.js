// Arcade layer — client HUD + FX (arcade golf on a real launch monitor).
//
// Everything here lives in one <div id="arcade"> inside #hud (which app.js CSS-zooms to
// the window, so this layout is in the same 1680×945 design pixels as the rest of the
// HUD). The server grades each shot (SSE `arcade`); this file turns that into a shouted
// callout banner, points, coins, XP, a combo meter that heats up and breaks, a ball dock
// (the bay's inventory in solo play, the loadout of whoever is up in a match), chests,
// level-ups, challenges and a scripted crowd that builds while the ball rolls toward the cup.
//
// Who stands where: the players are at a hitting mat four metres from a projector, so
// everything that matters is big, and nothing sits on the middle of the picture for long.
//   top band      coins · level · combo meter (solo; the match header takes this band in a match)
//   upper centre  the callout banner, the armed / record flashes, the curse warning
//   bottom centre the ball dock (a hotbar: 1 to 9), its tray opens upward
// The dock, the challenges and the warnings step aside while a ball is in the air.
//
// Timing: every cue is placed on the clock of the sim.points[].t this file is handed,
// and nothing is derived from physics. feel.js may already have time-warped the shot for
// slow motion (it rewrites points[].t, flightTime and event times, and lists its windows
// in sim.slowmo, in that same warped time); the last point's t is "ball at rest".
// The client animates the ball along those points in real time, EXCEPT that
// render/scene.js plays paths longer than 14 s at `dur / 14` speed. wallMsFor() mirrors
// that one rule; pass { timeScale } or { wallMs } to onShot() if the scene changes.
// The callout lands when its outcome is on screen (calloutMoment): a holed ball as it
// drops, a splash as it hits the water, everything else when the ball has stopped.
//
// Audio: an ArcadeAudio instance (audio.js) is handed in by the integrator. Every call
// is guarded, so the UI works with no audio at all, and with an engine that has no say().
// Sound is placed with restraint: one moment, one stack (at most one impact, one crowd
// reaction, one sting and one voice line), each on the frame where the thing visibly
// lands (the banner's slam, the chest lid, the meter breaking), never on a repeat, and an
// ordinary shot (OK, no callout) gets none: silence is contrast. _moment() hands the stack
// to audio.moment() when the engine has one, else spaces it out itself.

const YD = 0.9144;                   // metres per yard
const SWELL_YD = 15;                 // the crowd starts to rise inside this (rolling ball)
const MAX_PARTICLES = 140;
const MUTE_KEY = 'open-birdie.arcade.muted';
const SCENE_MAX_WALL_S = 14;         // render/scene.js: a path longer than this is sped up
const BAR_SLOTS = 9;                 // the hotbar: keys 1 to 9
const TRAY_COLS = 5;

// The catalogue as arcade v2 fixes it (docs/dev/arcade-v2-contract.md, section 5). The server's
// snapshot wins field by field; this is the fallback for what it leaves out (an older
// server sends no kind and no colour) and for a page with no server at all.
const FALLBACK_CATALOGUE = [
  { id: 'rocket',     kind: 'ball',  name: 'Rocket',     emoji: '🚀', rarity: 'epic',      color: '#ff7a1a', tagline: 'Strap a booster to it. A normal drive flies 500 yards.' },
  { id: 'sticky',     kind: 'ball',  name: 'Sticky',     emoji: '🍯', rarity: 'common',    color: '#f0a81e', tagline: 'Lands and stops dead.' },
  { id: 'magnet',     kind: 'ball',  name: 'Magnet',     emoji: '🧲', rarity: 'rare',      color: '#e2416b', tagline: 'The cup is three yards wide. Get it close and it drops.' },
  { id: 'windcutter', kind: 'ball',  name: 'Windcutter', emoji: '🌪️', rarity: 'common',    color: '#58e0e6', tagline: 'What wind? This ball never feels it.' },
  { id: 'laser',      kind: 'ball',  name: 'Laser',      emoji: '🎯', rarity: 'rare',      color: '#b6ff2e', tagline: 'Dead straight. Your slice, gone.' },
  { id: 'moonball',   kind: 'ball',  name: 'Moonball',   emoji: '🌙', rarity: 'common',    color: '#c9d4ff', tagline: 'Into orbit, down like a feather.' },
  { id: 'bouncy',     kind: 'ball',  name: 'Bouncy',     emoji: '🏀', rarity: 'common',    color: '#38d17a', tagline: 'Hits the ground and keeps on going.' },
  { id: 'fireball',   kind: 'ball',  name: 'Fireball',   emoji: '🔥', rarity: 'epic',      color: '#ff3a1c', tagline: 'Hot and long, with a huge run-out.' },
  { id: 'ghost',      kind: 'ball',  name: 'Ghost',      emoji: '👻', rarity: 'rare',      color: '#a9b8ff', tagline: 'Flies straight through the trees.' },
  { id: 'skipper',    kind: 'ball',  name: 'Skipper',    emoji: '🌊', rarity: 'rare',      color: '#2fa8ff', tagline: 'Skips across water like a stone.' },
  { id: 'yoyo',       kind: 'ball',  name: 'Yo-Yo',      emoji: '🪀', rarity: 'rare',      color: '#c05cff', tagline: 'Rips back with spin.' },
  { id: 'homing',     kind: 'ball',  name: 'Homing',     emoji: '🛰️', rarity: 'epic',      color: '#ff4fa8', tagline: 'Bends toward the pin in flight.' },
  { id: 'titan',      kind: 'ball',  name: 'Titan',      emoji: '🗿', rarity: 'epic',      color: '#9aa7bd', tagline: '+25 % speed and it cannot curve.' },
  { id: 'feather',    kind: 'ball',  name: 'Feather',    emoji: '🪶', rarity: 'common',    color: '#f4efdc', tagline: 'Floats: a big carry and a soft landing.' },
  { id: 'gold',       kind: 'ball',  name: 'Golden',     emoji: '👑', rarity: 'legendary', color: '#ffd21f', tagline: 'Double points and double coins.' },
  { id: 'gust',       kind: 'trick', name: 'Gust',       emoji: '💨', rarity: 'rare',      color: '#7ad7f0', tagline: 'A 25 mph crosswind on their next shot.' },
  { id: 'tiny-cup',   kind: 'trick', name: 'Tiny Cup',   emoji: '🕳️', rarity: 'rare',      color: '#ffb84a', tagline: 'Their cup shrinks.' },
  { id: 'fog',        kind: 'trick', name: 'Fog',        emoji: '🌫️', rarity: 'rare',      color: '#b9c4d2', tagline: 'Their yardages vanish.' },
];
const FALLBACK_BY_ID = new Map(FALLBACK_CATALOGUE.map((p) => [p.id, p]));

// what the announcer shouts for each id (contract, section 5): also what the dock prints
const SPOKEN = {
  rocket: 'ROCKET BALL', sticky: 'STICKY BALL', magnet: 'MAGNET BALL', windcutter: 'WIND CUTTER', laser: 'LASER BALL',
  moonball: 'MOON BALL', bouncy: 'BOUNCY BALL', fireball: 'FIREBALL', ghost: 'GHOST BALL', skipper: 'SKIPPER',
  yoyo: 'YO-YO BALL', homing: 'HOMING BALL', titan: 'TITAN BALL', feather: 'FEATHER BALL', gold: 'GOLDEN BALL',
  gust: 'GUST', 'tiny-cup': 'TINY CUP', fog: 'FOG',
};
// a trick waiting on the player who is up: what the warning chip says
const CURSES = {
  gust: { title: 'GUST INCOMING', sub: '25 MPH CROSSWIND ON THIS SHOT' },
  'tiny-cup': { title: 'TINY CUP', sub: 'THE CUP HAS SHRUNK FOR THIS SHOT' },
  fog: { title: 'FOGGED IN', sub: 'YOUR YARDAGES ARE GONE' },
};

const GRADES = {
  JACKPOT:  { text: 'JACKPOT!!!',    cue: 'jackpot',  tone: 'epic' },
  PERFECT:  { text: 'PERFECT SHOT!', cue: 'perfect',  tone: 'good' },
  GREAT:    { text: 'GREAT SHOT!',   cue: 'great',    tone: 'good' },
  GOOD:     { text: 'GOOD',          cue: 'good',     tone: 'neutral' },
  OK:       { text: 'OK',            cue: 'ok',       tone: 'neutral' },
  MISS:     { text: 'MISS',          cue: 'miss',     tone: 'bad' },
  DISASTER: { text: 'DISASTER',      cue: 'disaster', tone: 'bad' },
};
const TONES = ['epic', 'good', 'neutral', 'bad', 'funny'];
// how long the banner stays once the ball has stopped (ms): loud ones a little longer, none long
const TONE_HOLD = { epic: 4200, good: 3200, neutral: 2600, bad: 3000, funny: 3600 };
const TONE_FONT = { epic: 124, good: 108, neutral: 88, bad: 104, funny: 108 };   // design px, one line
// ms from a banner appearing to its slam landing (the keyframes in arcade.css): the sound goes there
const TONE_HIT = { epic: 330, good: 275, neutral: 160, bad: 350, funny: 340 };
const CROWD_AFTER_MS = 150;          // the crowd answers the hit ...
const VOICE_AFTER_MS = 250;          // ... and the announcer answers the crowd
const CROWD_GAP_MS = 1100;           // never two crowd reactions on top of each other
const CROWD_CUES = new Set(['gasp', 'oooh', 'roar', 'crowd-roar', 'crowd-cheer', 'crowd-ohh', 'crowd-aww', 'crowd-gasp', 'crowd-laugh', 'applause']);
const HOLED_IDS = new Set(['hole-in-one', 'holed-out', 'chip-in', 'drained', 'in-the-hole']);
const NEAR_MISS_IDS = new Set(['robbed', 'so-close']);
// callouts that only repeat the grade: no grade chip under them
const PLAIN_IDS = new Set(['perfect', 'great-shot', 'nice-shot']);
// the stickers that bounce beside a funny callout (cosmetic; an unknown id gets none)
const STICKERS = {
  'slice-house': ['🏠', '🏡'], 'hook-city': ['🏙️', '🪝'], shank: ['🦛', '🦛'], 'worm-burner': ['🪱', '🔥'],
  'sky-ball': ['🎈', '☁️'], chunk: ['⛏️', '🥔'], splash: ['💦', '🐟'], lava: ['🌋', '🫠'], ob: ['👋', '🚪'],
  beach: ['🏖️', '🦀'], timber: ['🌲', '🪓'], terrible: ['🙈', '💀'], robbed: ['😱', '🕳️'], 'so-close': ['🤏', '😬'],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v) => (Number.isFinite(v) ? v : null);
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a colour as CSS: '#rrggbb', or the number the trail uses (lib/arcade.js sends 0xff5a1f)
const safeColor = (c, fb = '#ffd21f') => {
  if (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0xffffff) return `#${c.toString(16).padStart(6, '0')}`;
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fb;
};
const safeId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function pinOf(state) {
  const p = state?.pin;
  if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) return [p[0], p[1]];
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x, p.y];
  return null;
}

// ---------------------------------------------------------------- pure helpers (exported for tests)

// sim seconds -> wall milliseconds, the way render/scene.js plays the ball
export function wallMsFor(shot, opts = {}) {
  if (typeof opts.wallMs === 'function') return opts.wallMs;
  const pts = shot?.sim?.points || [];
  const dur = pts.length ? pts[pts.length - 1].t : 0;
  const scale = Number.isFinite(opts.timeScale) && opts.timeScale > 0
    ? opts.timeScale
    : (dur > SCENE_MAX_WALL_S ? SCENE_MAX_WALL_S / dur : 1);
  return (t) => Math.max(0, t * scale * 1000);
}

// when a sim event happens: its own t, else the time of the nearest path point
function eventTime(ev, pts, fallback) {
  if (Number.isFinite(ev?.t)) return ev.t;
  if (!pts.length || !Number.isFinite(ev?.x) || !Number.isFinite(ev?.y)) return fallback;
  let best = fallback, bd = Infinity;
  for (const p of pts) {
    const d = (p.x - ev.x) ** 2 + (p.y - ev.y) ** 2;
    if (d < bd) { bd = d; best = p.t; }
  }
  return best;
}

// what a bounce sounds like, by what it landed on
function bounceCue(surface) {
  const s = String(surface || '').toLowerCase();
  if (/green/.test(s)) return 'green-thump';
  if (/bunker|sand/.test(s)) return 'sand-thud';
  if (/ice|frozen/.test(s)) return 'ice-skid';
  return 'fairway-bounce';
}

// The crowd script: what the crowd does, and when (sim seconds), for one shot.
// Pure, so the demo page can print it. Returns { items:[{t, kind, ...}], meta }.
//   kind 'cue'   -> { cue, intensity }
//   kind 'crowd' -> { level, ramp }   (continuous murmur target)
//   kind 'fx'    -> { fx: 'holed' | 'splash' }
//   kind 'slowmo'-> { on, reason, rate }   (a sim.slowmo window opens / closes)
//   kind 'stop'  -> the ball has stopped (the last point's t)
// All times are the times of the points handed in: an already time-warped shot (feel.js)
// needs no special handling, and no speed or duration is assumed from physics.
export function buildCrowdScript(shot, pin) {
  const sim = shot?.sim || {};
  const pts = Array.isArray(sim.points) ? sim.points : [];
  const items = [];
  const n = pts.length;
  const dur = n ? pts[n - 1].t : 0;
  const ft = clamp(fin(sim.flightTime) ?? dur, 0, dur);
  const isPutt = !!sim.isPutt;
  const events = Array.isArray(sim.events) ? sim.events : [];
  const push = (t, item) => items.push({ t: clamp(t, 0, Math.max(dur, 0.01)), ...item });

  const distYd = pin
    ? (p) => Math.hypot(pin[0] - p.x, pin[1] - p.y) / YD
    : null;

  // slow-motion windows (feel.js), in the same already-warped time as the points
  const slowmo = (Array.isArray(sim.slowmo) ? sim.slowmo : [])
    .map((w) => ({
      t0: clamp(fin(w?.t0) ?? NaN, 0, dur), t1: clamp(fin(w?.t1) ?? NaN, 0, dur),
      rate: fin(w?.rate), reason: typeof w?.reason === 'string' ? w.reason : '',
    }))
    .filter((w) => Number.isFinite(w.t0) && Number.isFinite(w.t1) && w.t1 - w.t0 > 0.05)
    .sort((a, b) => a.t0 - b.t0)
    .slice(0, 8);
  const windowAt = (t) => slowmo.find((w) => t >= w.t0 && t < w.t1) || null;

  // --- flight: a murmur that lifts with a big carry, an "oooh" at the apex of a bomb
  const carry = fin(sim.carryYd) ?? 0;
  if (!isPutt && ft > 1.2) {
    push(0.15, { kind: 'crowd', level: clamp(0.08 + carry / 900, 0.08, 0.35), ramp: ft * 0.8 });
    if (carry >= 265) {
      let apexT = ft / 2, apexY = -Infinity;
      for (const p of pts) { if (p.t <= ft && p.z > apexY) { apexY = p.z; apexT = p.t; } }
      push(apexT, { kind: 'cue', cue: 'oooh', intensity: clamp((carry - 240) / 90, 0.3, 0.9) });
    }
  }

  // --- the server's own events: bounces, trees, water, the cup
  let holedT = null;
  const bounceTs = [];
  let gaspDone = false;
  const sorted = events.map((ev) => ({ ev, t: eventTime(ev, pts, ft) })).sort((a, b) => a.t - b.t);
  for (const { ev, t } of sorted) {
    const type = ev.type;
    const surface = String(ev.surface || '').toLowerCase();
    if (type === 'bounce') {
      // the landing and the two hops after it, each with the sound of what it hit
      if (bounceTs.length < 3 && (bounceTs.length === 0 || t - bounceTs[bounceTs.length - 1] >= 0.25)) {
        bounceTs.push(t);
        const k = bounceTs.length - 1;
        push(t, { kind: 'cue', cue: bounceCue(surface), intensity: clamp(0.9 - k * 0.3, 0.2, 1) });
      }
      if (!gaspDone && /bunker|sand|water|ob|out/.test(surface)) {
        gaspDone = true;
        push(t - 0.12, { kind: 'cue', cue: 'gasp', intensity: 0.7 });
      }
    } else if (type === 'tree') {
      if (!gaspDone) { gaspDone = true; push(t - 0.05, { kind: 'cue', cue: 'gasp', intensity: 0.85 }); }
      push(t, { kind: 'cue', cue: 'tree-knock', intensity: 0.8 });
    } else if (type === 'water') {
      if (!gaspDone) { gaspDone = true; push(t - 0.35, { kind: 'cue', cue: 'gasp', intensity: 0.9 }); }
      push(t, { kind: 'cue', cue: 'splash', intensity: 1 });
      push(t, { kind: 'fx', fx: 'splash' });
      push(t + 0.05, { kind: 'crowd', level: 0.05, ramp: 1.2 });
    } else if (type === 'holed') {
      holedT = t;
    }
  }
  const holed = !!shot?.holed || holedT !== null;
  if (holed && holedT === null) holedT = dur;

  // a landing in trouble with no event to say so
  if (!gaspDone && !isPutt && /water|bunker|sand|ob/.test(String(shot?.lie || '').toLowerCase())) {
    push(ft, { kind: 'cue', cue: 'gasp', intensity: 0.6 });
  }

  // --- the roll: the swell as the ball closes on the cup
  let minD = Infinity, tMin = dur, tSwell = null, swellLevel = 0, swellOooh = 0;
  if (distYd && n) {
    const rollStart = ft + 0.15 * Math.max(0, dur - ft);     // putts: let the roll breathe first
    // "still moving" = ground left to cover. Not a speed: a slow-motion window divides
    // every apparent speed, and the ball is no less alive for it.
    const left = new Float64Array(n);
    for (let i = n - 2; i >= 0; i--) left[i] = left[i + 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (p.t < ft) continue;
      const d = distYd(p);
      if (d < minD) { minD = d; tMin = p.t; }
      if (tSwell === null && d < SWELL_YD && p.t >= rollStart && (left[i] > 0.3 || i === n - 1)) tSwell = p.t;
    }
  } else {
    const finalD = fin(shot?.distToPinYd);
    if (finalD !== null) {
      minD = finalD;
      if (finalD < SWELL_YD) tSwell = ft + 0.55 * Math.max(0, dur - ft);
    }
  }
  const stopT = holedT ?? dur;
  if (tSwell !== null && tSwell < stopT) {
    const closeness = clamp(1 - minD / SWELL_YD, 0, 1);
    swellLevel = 0.35 + 0.55 * closeness;
    swellOooh = 0.4 + 0.6 * closeness;
    push(tSwell, { kind: 'crowd', level: swellLevel, ramp: Math.max(0.3, stopT - tSwell) });
    push(tSwell, { kind: 'cue', cue: 'oooh', intensity: swellOooh });
  } else tSwell = null;
  // a lip-out / a ball that dies on the edge
  if (!holed && minD < 1.0 && tMin < dur - 0.15) {
    push(tMin + 0.15, { kind: 'cue', cue: 'gasp', intensity: 1 });
  }
  if (holed) {
    push(holedT, { kind: 'cue', cue: 'cup-drop', intensity: 1 });
    push(holedT, { kind: 'cue', cue: 'roar', intensity: 1 });
    push(holedT, { kind: 'crowd', level: 1, ramp: 0.2 });
    push(holedT, { kind: 'fx', fx: 'holed' });
  }

  // --- slow motion: the picture says so, and the crowd holds its breath *up*: the swell
  // is carried through each window instead of running out before the ball gets there
  for (const w of slowmo) {
    push(w.t0, { kind: 'slowmo', on: true, reason: w.reason, rate: w.rate, len: w.t1 - w.t0 });
    const inSwell = tSwell !== null && w.t1 > tSwell && w.t0 < stopT;
    const from = inSwell ? Math.max(w.t0, tSwell) : w.t0;
    const until = inSwell ? Math.min(w.t1, stopT) : w.t1;
    if (until - from > 0.05) {
      // a little above the swell, but short of the roar: that needs somewhere to go
      const level = inSwell ? Math.max(swellLevel, Math.min(0.92, swellLevel + 0.1)) : 0.3;
      push(from + 0.01, { kind: 'crowd', hold: true, level, ramp: until - from });
      // (the one-shot "oooh" is not renewed inside a long window: no sound repeats on a clock)
    }
  }
  // nothing lets the crowd down inside a window: a drop waits for real time to resume
  for (const it of items) {
    if (it.kind !== 'crowd' || it.hold || it.level >= 0.2) continue;
    const w = windowAt(it.t);
    if (w) it.t = w.t1;
  }
  for (const w of slowmo) push(w.t1, { kind: 'slowmo', on: false });

  push(dur, { kind: 'stop' });
  items.sort((a, b) => a.t - b.t);
  return {
    items,
    meta: {
      dur, flightTime: ft, isPutt, holed, holedT, minDistYd: Number.isFinite(minD) ? minD : null,
      tMin: Number.isFinite(minD) ? tMin : null, swellT: tSwell, bounces: bounceTs.length, slowmo,
    },
  };
}

// The shot's callout, checked: { id, text, tone, voice } or null. An unknown tone reads
// as neutral; a callout with no text is no callout (the grade label leads instead).
export function calloutOf(ev) {
  const c = ev?.callout;
  if (!c || typeof c !== 'object') return null;
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (!text) return null;
  const id = safeId(c.id);
  return { id, text: text.slice(0, 40), tone: TONES.includes(c.tone) ? c.tone : 'neutral', voice: typeof c.voice === 'string' && c.voice ? c.voice : (id || null) };
}

// The crowd one-shot for a callout (contract, section 5): the near misses first, then the tone.
export function crowdCueFor(callout, pick = Math.random) {
  if (!callout) return null;
  if (NEAR_MISS_IDS.has(callout.id)) return 'crowd-ohh';
  switch (callout.tone) {
    case 'epic': return 'crowd-roar';
    case 'good': return pick() < 0.5 ? 'crowd-cheer' : 'applause';
    case 'bad': return 'crowd-aww';
    case 'funny': return 'crowd-laugh';
    default: return null;
  }
}

// When (sim seconds) a callout may be shouted: never before the ball gets there.
//   'launch' a rocket-type ball leaving (BLAST OFF!)
//   'holed'  as the ball drops          'water' as it hits the water
//   'tree'   as it hits the trunk       'lip'   as it burns the edge
//   'stop'   everything else: the ball has stopped
// A tree or a lip-out that still has seconds of rolling left waits for the stop instead,
// so the banner never sits over a moving ball for long.
export function calloutMoment(callout, shot, meta) {
  const dur = meta?.dur ?? 0;
  const at = (t, kind) => ({ t: clamp(t, 0, dur), kind });
  if (!callout || !(dur > 0)) return at(dur, 'stop');
  const pts = shot?.sim?.points || [];
  const events = Array.isArray(shot?.sim?.events) ? shot.sim.events : [];
  const first = (type) => {
    let best = null;
    for (const e of events) {
      if (e?.type !== type) continue;
      const t = eventTime(e, pts, meta.flightTime ?? dur);
      if (best === null || t < best) best = t;
    }
    return best;
  };
  const soon = (t) => t !== null && dur - t <= 3.5;
  if (callout.id === 'blast-off') return at(Math.min(0.35, dur), 'launch');
  if (HOLED_IDS.has(callout.id) && meta.holedT != null) return at(meta.holedT, 'holed');
  if (callout.id === 'splash' || callout.id === 'lava') { const t = first('water'); if (t !== null) return at(t, 'water'); }
  if (callout.id === 'timber') { const t = first('tree'); if (soon(t)) return at(t, 'tree'); }
  if (callout.id === 'robbed' && meta.minDistYd != null && meta.minDistYd < 1 && meta.tMin != null) {
    const t = meta.tMin + 0.2;
    if (t < dur - 0.3 && soon(t)) return at(t, 'lip');
  }
  return at(dur, 'stop');
}

// A long callout goes on two lines, split at the space nearest its middle.
export function splitCallout(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (s.length <= 14 || !s.includes(' ')) return [s];
  let best = -1, bd = Infinity;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ' ') continue;
    const d = Math.abs(i - (s.length - 1) / 2);
    if (d < bd) { bd = d; best = i; }
  }
  return [s.slice(0, best), s.slice(best + 1)];
}

// The combo meter: 0..5 lit segments and a state. ON FIRE at 3, UNSTOPPABLE at 5 (the
// callout table's thresholds).
export function heatOf(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  return {
    streak: n, level: Math.min(5, n),
    state: n >= 5 ? 'inferno' : n >= 3 ? 'fire' : n >= 2 ? 'warm' : 'cold',
    label: n >= 5 ? 'UNSTOPPABLE' : n >= 3 ? 'ON FIRE' : n >= 2 ? 'HEATING UP' : 'STREAK',
  };
}

// The name on the dock and in the flashes: what the announcer shouts for it.
export function ballName(pu) {
  if (!pu) return '';
  if (SPOKEN[pu.id]) return SPOKEN[pu.id];
  const n = String(pu.name || pu.id || '').toUpperCase();
  return pu.kind === 'trick' || /BALL$/.test(n) ? n : `${n} BALL`;
}

// A server catalogue entry over the fallback for its id.
function mergeCatalogue(list) {
  return list.filter((p) => p && typeof p === 'object' && p.id != null).map((p) => {
    const fb = FALLBACK_BY_ID.get(p.id) || {};
    return {
      ...fb, ...p, id: String(p.id),
      kind: p.kind === 'trick' || p.kind === 'ball' ? p.kind : (fb.kind || 'ball'),
      emoji: p.emoji || fb.emoji || '✨', tagline: p.tagline || fb.tagline || '',
      rarity: safeId(p.rarity || fb.rarity || 'common') || 'common',
      color: safeColor(p.color, fb.color || '#ffd21f'),
      name: p.name || fb.name || String(p.id),
    };
  });
}

/**
 * What the ball dock shows, from the bay's snapshot, the catalogue and the match state.
 *   mode 'solo'    the bay's inventory (count per ball; Infinity when `unlimited`)
 *   mode 'match'   the loadout of the player who is up, in 'play' or 'tiebreak'
 *   mode 'hidden'  a match is on but nobody may arm (intro, result, power-ups off)
 * Item states: 'armed' | 'ready' | 'empty' (solo: none owned) | 'used' (match: spent) |
 * 'locked' (match: no charges left, the opponent already carries a curse, or this is a
 * free-ball tee shot; solo: a trick, which is for matches only).
 * Match details follow docs/match.md: `charges: null` is unlimited; a trick is spent when
 * cast and sits on the target as `cursedWith` (one curse on a player at a time); on a
 * stage with `freeBall` every player's first stroke is that ball for free (`freeId`), and
 * a ball they armed themselves is kept for later (`heldId`).
 * `bar` is the hotbar (keys 1 to 9, left to right); `rest` is what only the tray shows.
 * `keys` maps an id to { label, digit, shift }: 1..9 for the bar, shift+1..9 for the next
 * nine that can be armed.
 * `opts.freeBall` (solo play only): the course's free ball when the hole's first stroke is
 * still to come (a rocket hole played outside a match). Same shape as in a match: `freeId`
 * leads the dock, the other balls are locked for that shot, the bay's armed ball is `heldId`.
 */
export function dockModel(snap, catalogue, match, opts = {}) {
  const cat = Array.isArray(catalogue) ? catalogue : [];
  const allBalls = cat.filter((p) => p.kind !== 'trick');
  const allTricks = cat.filter((p) => p.kind === 'trick');
  const live = !!match && typeof match === 'object' && match.aborted !== true;
  const out = {
    mode: 'solo', inMatch: live, playerId: null, playerName: '', slot: 0, oppId: null, oppName: '',
    charges: null, unlimited: false, armedId: null, freeId: null, heldId: null, cursedWith: null, oppCursedWith: null,
    balls: [], tricks: [], bar: [], rest: [], keys: new Map(),
  };
  const finishKeys = () => {
    const barIds = new Set(out.bar.map((it) => it.pu.id));
    out.bar.forEach((it, i) => out.keys.set(it.pu.id, { label: String(i + 1), digit: i + 1, shift: false }));
    out.rest = [...out.balls, ...out.tricks].filter((it) => !barIds.has(it.pu.id));
    out.rest.filter((it) => it.state === 'ready' || it.state === 'armed').slice(0, 9)
      .forEach((it, i) => out.keys.set(it.pu.id, { label: `⇧${i + 1}`, digit: i + 1, shift: true }));
    return out;
  };
  // the bar takes the first `cap` balls that can be armed; an armed ball is always on it
  const pickBar = (items, cap) => {
    const usable = items.filter((it) => it.state === 'ready' || it.state === 'armed');
    const bar = usable.slice(0, cap);
    const armed = usable.find((it) => it.state === 'armed');
    if (armed && !bar.includes(armed)) bar[bar.length - 1] = armed;
    return bar;
  };

  if (live) {
    const players = Array.isArray(match.players) ? match.players : [];
    const me = players.find((p) => p && p.id === match.currentPlayerId) || null;
    const playing = match.phase === 'play' || match.phase === 'tiebreak';
    const powerups = match.options?.powerups ?? 'loadout';
    if (!playing || !me || powerups === 'off') { out.mode = 'hidden'; return out; }
    const opp = players.find((p) => p && p.id !== me.id) || null;
    out.mode = 'match';
    out.playerId = me.id; out.playerName = String(me.name || `Player ${me.slot || 1}`);
    out.slot = me.slot === 2 ? 2 : me.slot === 1 ? 1 : (players.indexOf(me) === 1 ? 2 : 1);
    out.oppId = opp?.id ?? null; out.oppName = opp ? String(opp.name || `Player ${opp.slot || 2}`) : 'OPPONENT';
    out.unlimited = powerups === 'unlimited' || me.charges == null;
    out.charges = out.unlimited ? Infinity : Math.max(0, Math.floor(Number(me.charges) || 0));
    out.cursedWith = me.cursedWith || null;
    out.oppCursedWith = opp?.cursedWith || null;
    // a rocket hole: this player's first stroke on the stage is the stage's ball, for free
    const free = match.stage && match.stage.freeBall && Number(me.strokes) === 0 ? String(match.stage.freeBall) : null;
    out.freeId = free && allBalls.some((p) => p.id === free) ? free : null;
    out.heldId = out.freeId ? (me.armedPowerup || null) : null;
    out.armedId = out.freeId || me.armedPowerup || null;
    const used = new Set(out.unlimited || !Array.isArray(me.usedPowerups) ? [] : me.usedPowerups);
    const ballState = (pu) => (pu.id === out.armedId ? 'armed' : out.freeId ? 'locked' : used.has(pu.id) ? 'used'
      : (out.charges === 0 && !out.armedId ? 'locked' : 'ready'));
    const trickState = (pu) => (used.has(pu.id) ? 'used' : (out.charges === 0 || out.oppCursedWith ? 'locked' : 'ready'));
    out.balls = allBalls.map((pu) => ({ pu, count: null, state: ballState(pu) }));
    out.tricks = allTricks.map((pu) => ({ pu, count: null, state: trickState(pu) }));
    // the tricks keep their three slots (spent ones greyed), the balls fill what is left
    out.bar = [...pickBar(out.balls, BAR_SLOTS - Math.min(3, out.tricks.length)), ...out.tricks.slice(0, 3)];
    return finishKeys();
  }

  const s = snap || {};
  const inv = s.inventory || {};
  out.unlimited = s.unlimited === true;
  const soloFree = opts && opts.freeBall && s.enabled !== false ? String(opts.freeBall) : null;
  out.freeId = soloFree && allBalls.some((p) => p.id === soloFree) ? soloFree : null;
  out.heldId = out.freeId && s.armed && s.armed !== out.freeId ? s.armed : null;
  out.armedId = out.freeId || s.armed || null;
  out.balls = allBalls.map((pu) => {
    const count = out.unlimited ? Infinity : Math.max(0, inv[pu.id] | 0);
    return { pu, count, state: pu.id === out.armedId ? 'armed' : out.freeId ? 'locked' : count > 0 ? 'ready' : 'empty' };
  });
  out.tricks = allTricks.map((pu) => ({ pu, count: null, state: 'locked' }));
  out.bar = pickBar(out.balls, BAR_SLOTS);
  return finishKeys();
}

// Challenges that have just been completed, and ones that are new, between two snapshots.
// (No previous list: nothing is "just" anything, the panel simply appears.)
export function challengeDiff(prev, next) {
  const list = Array.isArray(next) ? next.filter((c) => c && c.id != null) : [];
  if (!Array.isArray(prev)) return { completed: [], fresh: [] };
  const before = new Map(prev.filter((c) => c && c.id != null).map((c) => [String(c.id), c]));
  const completed = [], fresh = [];
  for (const c of list) {
    const was = before.get(String(c.id));
    if (!was) fresh.push(String(c.id));
    else if (c.done && !was.done) completed.push(String(c.id));
  }
  return { completed, fresh };
}

// A record the server attached to the grade, if it did: { label, value } or null. The
// contract names no field for it, so several plausible shapes are read and nothing is
// made up when none is there.
export function recordOf(ev) {
  const r = ev?.record ?? (Array.isArray(ev?.records) ? ev.records[0] : null) ?? ev?.award?.record ?? null;
  if (!r) return null;
  if (typeof r === 'string') return { label: r.toUpperCase().slice(0, 40), value: '' };
  if (typeof r !== 'object') return null;
  const label = r.label || r.text || r.title || String(r.id || r.kind || '').replace(/[-_]+/g, ' ');
  if (!label) return null;
  return { label: String(label).toUpperCase().slice(0, 40), value: r.value != null ? String(r.value).slice(0, 24) : '' };
}

// ---------------------------------------------------------------- the HUD
export class ArcadeUI {
  constructor({ hud, audio, fetchJson, ballScreen = null, worldScreen = null } = {}) {
    this.hud = hud || document.getElementById('hud') || document.body;
    this.audio = audio || null;
    this.ballScreen = typeof ballScreen === 'function' ? ballScreen : null;   // v2:qa () => { x, y } of the ball on screen (client px), or null
    this.fetchJson = fetchJson || (async (url, opts) => {
      const r = await fetch(url, opts);
      return r.ok ? r.json() : null;
    });
    // v2:playability the rescue drop: (x, y) of the course -> { x, y } on screen (client px) or
    // null, for the ghost marker
    this.worldScreen = typeof worldScreen === 'function' ? worldScreen : null;
    this.game = null;          // the game state (setGameState): canDrop, rescue, drop
    this.dropArmed = false;    // a drop that costs a stroke was pressed once: the next press takes it
    this.dropBusy = false;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }

    this.snap = { enabled: true, coins: 0, xp: 0, level: 1, xpToNext: 100, streak: 0, bestStreak: 0, shots: 0, inventory: {}, armed: null, powerups: FALLBACK_CATALOGUE };
    this.catalogue = FALLBACK_CATALOGUE;
    this.match = null;         // the match state (setMatch), or null: solo play
    this.model = dockModel(this.snap, this.catalogue, null);
    this.pin = null;
    this.shot = null;          // the shot in the air / rolling
    this.arcadeEv = null;      // its grade, when it has arrived
    this.stopped = true;       // has the ball stopped
    this.holdHud = false;      // the HUD numbers wait for the reveal to count them in
    this.timers = new Set();   // crowd script + reveal timers
    this.hudTimers = new Set();// small UI timers (flashes, cards)
    this.live = 0;             // live particles
    this.shownCoins = 0;
    this.shownStreak = 0;      // what the combo meter shows
    this.shownLevel = 1;
    this.shownChal = undefined;// the challenges on screen (undefined: never had any)
    this.hasState = false;     // the first snapshot sets the counters, later ones count up
    this.revealing = false;    // a grade reveal is on screen
    this.trayOpen = false;
    this.trayCursor = 0;
    this.called = null;        // { ev, kind }: the callout already shouted for this grade
    this.lastCrowdAt = -1e9;   // wall ms of the last crowd one-shot (CROWD_GAP_MS)
    this.momentAt = null;      // ms into the shot at which its callout (and crowd) will land
    this.hoverId = null;       // the dock slot under the pointer (ui-tick on a change)
    this.disposed = false;

    this._build();
    this._onKey = (e) => this._key(e);
    // capture: with the tray open the arrows and Enter are ours, not the aim's
    window.addEventListener('keydown', this._onKey, true);
    // v2:qa the armed tab stands on the middle of the dock, and that is where the ball lies (the
    // address camera frames it just above the bar: public/render/see-over.js): the ball that has
    // just changed its skin was hidden behind the tab that says so. A few times a second: is the
    // ball under it? Then the tab lifts clear.
    this._ballWatch = this.ballScreen && typeof setInterval === 'function' ? setInterval(() => this._watchBall(), 350) : null;
    // v2:playability the drop button follows the ball coming to rest and the reveal ending, and
    // its ghost marker follows the camera
    this._dropWatch = typeof setInterval === 'function' ? setInterval(() => this._renderDrop(), 300) : null;
    if (this._dropWatch && typeof this._dropWatch.unref === 'function') this._dropWatch.unref();
    this._load();
  }

  _watchBall() {
    if (this.disposed || !this.dockHead) return;
    const chip = this.dockHead.querySelector('.arc-dock-armed');
    let lift = false;
    if (chip && this.stopped) {
      let p = null;
      try { p = this.ballScreen(); } catch { p = null; }
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        const c = chip.getBoundingClientRect(), h = this.dockHead.getBoundingClientRect();   // the tab's x, the row's y (the row does not move)
        lift = p.x > c.left - 14 && p.x < c.right + 14 && p.y > h.top - 16 && p.y < h.bottom + 8;
      }
    }
    this.dockHead.classList.toggle('arc-lift', lift);
    // (v2:final the round porthole the dock used to get when the ball was behind the BAR is gone:
    // the address camera keeps the ball above the bar on every tee, uphill ones too)
  }

  // ---------------------------------------------------------------- DOM
  _build() {
    const root = el('div');
    root.id = 'arcade';
    root.classList.toggle('arc-muted', this.muted);
    root.setAttribute('aria-label', 'Arcade');
    this.root = root;

    // top band: coins · level + xp · the combo meter
    const top = el('div', 'arc-top');
    top.innerHTML = `
      <div class="arc-stat arc-stat-coins" title="Coins">
        <span class="arc-coin-ico">🪙</span><b class="num" data-arc="coins">0</b>
      </div>
      <div class="arc-stat arc-stat-level" title="Level and XP">
        <span class="arc-lvl"><i>LV</i><b class="num" data-arc="level">1</b></span>
        <span class="arc-xp-wrap"><span class="arc-xp"><span class="arc-xp-fill" data-arc="xpfill"></span></span><span class="arc-xp-text num" data-arc="xptext">0 / 100</span></span>
      </div>
      <div class="arc-stat arc-combo h-cold" data-arc="combo" title="Streak of GREAT or better">
        <span class="arc-flame" data-arc="flame">🔥</span>
        <b class="num arc-combo-n" data-arc="streak">x0</b>
        <span class="arc-combo-side"><span class="arc-combo-lbl" data-arc="heatlbl">STREAK</span><span class="arc-heat" data-arc="heat"><i></i><i></i><i></i><i></i><i></i></span></span>
      </div>`;
    root.append(top);
    this.statsEl = top;

    // challenges (only when the snapshot carries them): a small tab that opens into the
    // panel when there is news (a shot moved one on, one was completed) or when it is tapped
    this.chalEl = el('div', 'arc-chal hidden');
    this.chalEl.setAttribute('aria-label', 'Challenges');
    this.chalEl.innerHTML = '<button type="button" class="arc-ch-head" aria-expanded="false"><span>CHALLENGES</span><span class="arc-ch-minis"></span></button><div class="arc-ch-rows"></div>';
    this.chalRows = this.chalEl.querySelector('.arc-ch-rows');
    this.chalEl.querySelector('.arc-ch-head').onclick = () => {
      this.chalPinned = !this.chalEl.classList.contains('open');
      clearTimeout(this.chalPeekH);
      this._openChal(this.chalPinned);
      this._cue(this.chalPinned ? 'ui-confirm' : 'ui-back', { intensity: 0.6 });
    };
    root.append(this.chalEl);

    // a trick waiting on the player who is up
    this.curseEl = el('div', 'arc-curse hidden');
    this.curseEl.setAttribute('role', 'status');
    root.append(this.curseEl);

    // bottom centre: the ball dock (hotbar) and its tray
    this.scrimEl = el('div', 'arc-tray-scrim');
    this.scrimEl.onclick = () => this.toggleTray(false, { sound: true });
    root.append(this.scrimEl);
    this.trayEl = el('div', 'arc-tray hidden');
    this.trayEl.setAttribute('role', 'dialog');
    this.trayEl.setAttribute('aria-label', 'All balls');
    root.append(this.trayEl);
    const dock = el('div', 'arc-dock');
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Power-up balls');
    this.dockEl = dock;
    this.dockHead = el('div', 'arc-dock-head');
    this.dockBar = el('div', 'arc-dock-bar');
    dock.append(this.dockHead, this.dockBar);
    root.append(dock);
    const onPick = (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'tray') this.toggleTray(undefined, { sound: true });
        else if (act.dataset.act === 'mute') this.setMuted(!this.muted);
        return;
      }
      const b = e.target.closest('[data-id]');
      if (b) this.arm(b.dataset.id);
    };
    dock.addEventListener('click', onPick);
    this.trayEl.addEventListener('click', onPick);
    dock.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.arc-slot[data-id]');
      const id = b ? b.dataset.id : null;
      if (id && id !== this.hoverId) this._cue('ui-tick', { intensity: 0.5 });
      this.hoverId = id;
    });
    dock.addEventListener('pointerleave', () => { this.hoverId = null; });
    const onPoint = (e) => {
      const b = e.target.closest('.arc-cell[data-i]');
      if (b) this._setCursor(Number(b.dataset.i), true);
    };
    this.trayEl.addEventListener('pointerover', onPoint);
    this.trayEl.addEventListener('focusin', onPoint);

    // upper centre: the callout, what it earned, why
    const stage = el('div', 'arc-stage');
    this.bannerEl = el('div', 'arc-banner hidden');
    this.subEl = el('div', 'arc-sub hidden');
    this.reasonsEl = el('div', 'arc-reasons hidden');
    stage.append(this.bannerEl, this.subEl, this.reasonsEl);
    root.append(stage);
    this.stageEl = stage;

    // slow motion, the fire of a streak and the fog of a trick: their own element, first in
    // #hud, so they sit over the 3D view and UNDER every HUD panel
    this.slowTag = el('div', 'arc-slowmo-tag');
    this.slowTag.innerHTML = '<i></i><span>SLOW-MO</span><b class="num"></b><em></em>';
    root.append(this.slowTag);
    this.cineEl = el('div', 'arc-cine');
    this.cineEl.id = 'arcade-cine';
    this.cineEl.setAttribute('aria-hidden', 'true');
    this.cineEl.innerHTML = `<span class="arc-fire-veil">${'<i></i>'.repeat(8)}</span><span class="arc-fog-veil"><i></i><i></i></span>
      <span class="arc-cine-bar top"></span><span class="arc-cine-bar bottom"></span>`;
    this.hud.prepend(this.cineEl);

    // top-centre flash ("🚀 ROCKET BALL!")
    this.flashEl = el('div', 'arc-flash hidden');
    root.append(this.flashEl);

    // particles
    this.fxEl = el('div', 'arc-fx');
    root.append(this.fxEl);

    // a chest of new balls
    this.chestEl = el('div', 'arc-chest hidden');
    root.append(this.chestEl);

    // level up
    this.levelEl = el('div', 'arc-levelup hidden');
    root.append(this.levelEl);

    // v2:playability the rescue drop: DROP ON THE LINE by the aim control (bottom left), and
    // a ghost marker over the 3D view where the ball would go
    this.dropEl = el('button', 'arc-drop hidden');
    this.dropEl.type = 'button';
    this.dropEl.innerHTML = '<span class="arc-drop-ico" aria-hidden="true"></span><span class="arc-drop-txt"><b></b><i></i></span><kbd>R</kbd>';
    this.dropEl.onclick = () => this._dropPress();
    root.append(this.dropEl);
    this.ghostEl = el('div', 'arc-drop-ghost hidden');
    this.ghostEl.setAttribute('aria-hidden', 'true');
    this.ghostEl.innerHTML = '<i></i><span></span>';
    root.append(this.ghostEl);

    this.hud.append(root);
    if (this.muted) { try { this.audio?.setEnabled?.(false); } catch { /* an audio engine without it */ } }
    this._renderDock();
    this._renderTop(this.snap, { animate: false });
  }

  async _load() {
    try {
      const s = await this.fetchJson('/api/arcade');
      if (s && typeof s === 'object' && !this.disposed) this.onState(s);
    } catch { /* server without the arcade layer: the fallback catalogue stands */ }
  }

  // ---------------------------------------------------------------- state
  setGameState(state) {
    const p = pinOf(state);
    if (p) this.pin = p;
    if (state && Number.isFinite(state.distToPinYd)) this.distToPinYd = state.distToPinYd;
    this.game = state && typeof state === 'object' ? state : null;   // v2:playability
    this._renderDrop();
  }

  // Solo play on a rocket hole (app.js: the course geometry's arcade.freeBall while the
  // hole's first stroke is still to come): the dock leads with FREE <BALL>. null: none.
  setFreeBall(id) {
    const next = id ? String(id) : null;
    if (next === (this.freeBall || null)) return;
    this.freeBall = next;
    this._renderDock();
  }

  onState(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const prev = this.snap;
    this.snap = { ...prev, ...snapshot, inventory: snapshot.inventory || prev.inventory || {} };
    if (Array.isArray(snapshot.powerups) && snapshot.powerups.length) this.catalogue = mergeCatalogue(snapshot.powerups);
    this.root.classList.toggle('arc-disabled', snapshot.enabled === false);
    this._renderDock();
    if (!this.holdHud) this._renderTop(this.snap, { animate: this.hasState });
    if (!this.holdHud && !this.holdChal) this._renderChallenges({ animate: this.hasState });
    this.hasState = true;
  }

  // The match state (app.js hands it over where it flushes it to the match UI), or null.
  // While a match is in 'play' or 'tiebreak' the dock is the loadout of whoever is up and
  // arms through POST /api/match/arm; the solo coin / XP / combo strip steps aside for the
  // match header for as long as there is a match.
  setMatch(state) {
    const before = this.model;
    this.match = state && typeof state === 'object' ? state : null;
    this._renderDock();
    const m = this.model;
    if (before.mode !== m.mode || before.playerId !== m.playerId) {
      this.toggleTray(false);
      if (m.mode === 'match') { this.dockEl.classList.remove('arc-turn'); void this.dockEl.offsetWidth; this.dockEl.classList.add('arc-turn'); }
    }
    this._renderTop(this.snap, { animate: false });
    this._renderChallenges({ animate: false });
    this._renderDrop();   // v2:playability
  }

  // ---------------------------------------------------------------- v2:playability the rescue drop
  // DROP ON THE LINE: the server offers it in the game state (canDrop, rescue, drop: { x, y,
  // free, cost, distToPinYd }): the ball back on the hole's line, on mown ground. It costs
  // a stroke (two presses: the second confirms) or nothing when the game judges the lie
  // dead (FREE DROP, one press, shown loud). Offered while the ball is at rest and it is
  // somebody's swing: never in the air, on a result screen or in a sudden death.
  _dropOffer() {
    const g = this.game;
    if (!g || !g.canDrop || !g.drop || this.snap.enabled === false || !this.stopped || this.revealing) return null;
    const m = this.match;
    if (m && !m.aborted && m.phase !== 'play') return null;
    return g.drop;
  }

  _renderDrop() {
    if (this.disposed || !this.dropEl) return;
    const d = this._dropOffer();
    if (!d) this.dropArmed = false;
    const free = Boolean(d && d.free);
    const key = d ? `${free ? 'f' : 'p'}|${this.dropArmed ? 1 : 0}|${this.dropBusy ? 1 : 0}|${d.distToPinYd}` : '';
    if (key !== this._dropKey) {
      this._dropKey = key;
      if (!d) this.dropEl.className = 'arc-drop hidden';
      else {
        const yd = Number.isFinite(d.distToPinYd) ? ` · ${Math.round(d.distToPinYd)} YD OUT` : '';
        this.dropEl.className = `arc-drop${free ? ' arc-drop-free' : ''}${this.dropArmed ? ' arc-drop-armed' : ''}`;
        this.dropEl.disabled = this.dropBusy;
        this.dropEl.querySelector('b').textContent = free ? 'FREE DROP' : this.dropArmed ? 'PRESS AGAIN: +1' : 'DROP ON THE LINE';
        this.dropEl.querySelector('i').textContent = free ? `STUCK? BACK ON THE LINE · NO PENALTY` : this.dropArmed ? `BACK ON THE LINE${yd}` : 'BACK ON THE FAIRWAY · +1 STROKE';
        this.dropEl.title = free ? 'This lie is dead: take a free drop back on the line (R)' : 'Drop back on the line of the hole for one stroke: press twice (R)';
        this.ghostEl.querySelector('span').textContent = free ? 'FREE DROP' : 'DROP';
      }
    }
    // the ghost marker: where the ball would go
    let p = null;
    if (d && this.worldScreen) { try { p = this.worldScreen(d.x, d.y); } catch { p = null; } }
    const r = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? this.root.getBoundingClientRect() : null;
    if (r && r.width > 0 && p.x > r.left + 20 && p.x < r.right - 20 && p.y > r.top + 60 && p.y < r.bottom - 20) {
      const k = this.root.offsetWidth > 0 ? r.width / this.root.offsetWidth : 1;   // #hud is zoomed
      this.ghostEl.className = `arc-drop-ghost${free ? ' arc-drop-free' : ''}${this.dropArmed ? ' arc-drop-armed' : ''}`;
      this.ghostEl.style.left = `${((p.x - r.left) / k).toFixed(0)}px`;
      this.ghostEl.style.top = `${((p.y - r.top) / k).toFixed(0)}px`;
    } else if (!this.ghostEl.classList.contains('hidden')) this.ghostEl.className = 'arc-drop-ghost hidden';
  }

  // one press takes a free drop; a drop that costs a stroke is armed by the first press
  // (for five seconds) and taken by the second
  _dropPress() {
    const d = this._dropOffer();
    if (!d || this.dropBusy) return;
    if (d.free || this.dropArmed) { this._takeDrop(); return; }
    this.dropArmed = true;
    this._cue('ui-tick', { intensity: 0.8 });
    clearTimeout(this._dropT);
    this._dropT = setTimeout(() => { this.dropArmed = false; this._renderDrop(); }, 5000);
    this.hudTimers.add(this._dropT);
    this._renderDrop();
  }

  async _takeDrop() {
    const m = this.match && !this.match.aborted && this.match.phase === 'play' ? this.match : null;
    this.dropBusy = true;
    this.dropArmed = false;
    clearTimeout(this._dropT);
    this._renderDrop();
    let res = null;
    try {
      res = await this.fetchJson(m ? '/api/match/drop' : '/api/drop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m ? { playerId: m.currentPlayerId } : {}),
      });
    } catch { res = null; }
    this.dropBusy = false;
    if (this.disposed) return;
    if (res && res.ok) this._cue('ui-confirm', { intensity: 1 });
    else this._flash('NO DROP FROM HERE', 'warn', 1500);
    this._renderDrop();
  }

  // The 'drop' event (a drop was taken, here or on another screen): the banner.
  onDrop(ev) {
    if (this.disposed || !ev || this.snap.enabled === false) return;
    this.dropArmed = false;
    const free = ev.free === true;
    this._showBanner(free ? 'FREE DROP' : 'DROP · +1', { tone: free ? 'good' : 'neutral', gradeKey: 'ok', id: 'drop' });
    clearTimeout(this._dropBannerT);
    this._dropBannerT = setTimeout(() => { if (!this.revealing) this._hideBanner(); }, 2200);
    this.hudTimers.add(this._dropBannerT);
    this._renderDrop();
  }

  _renderTop(s, { animate } = {}) {
    const q = (k) => this.statsEl.querySelector(`[data-arc="${k}"]`);
    const coins = Math.max(0, Math.round(s.coins || 0));
    if (animate && coins !== this.shownCoins) this._countTo(q('coins'), this.shownCoins, coins, 600);
    else q('coins').textContent = fmtInt(coins);
    this.shownCoins = coins;
    this.shownLevel = s.level ?? 1;
    q('level').textContent = String(this.shownLevel);
    // lib/arcade.js: levelXp of levelSpan into this level. Older shape: xp of xpToNext.
    const need = Math.max(1, fin(s.levelSpan) ?? fin(s.xpToNext) ?? 100);
    const xp = clamp(fin(s.levelXp) ?? fin(s.xp) ?? 0, 0, need);
    q('xpfill').style.transform = `scaleX(${(xp / need).toFixed(4)})`;
    q('xptext').textContent = `${fmtInt(xp)} / ${fmtInt(need)}`;
    return this._setStreak(Math.max(0, s.streak || 0), animate);
  }

  // The combo meter: lit segments, the flame, the ON FIRE state of the whole HUD.
  // Returns { from, to } so the reveal can shout about it.
  _setStreak(n, animate) {
    const from = this.shownStreak;
    const h = heatOf(n);
    this.shownStreak = h.streak;
    const combo = this.statsEl.querySelector('[data-arc="combo"]');
    const q = (k) => this.statsEl.querySelector(`[data-arc="${k}"]`);
    q('streak').textContent = `x${h.streak}`;
    q('heatlbl').textContent = h.label;
    [...q('heat').children].forEach((seg, i) => seg.classList.toggle('on', i < h.level));
    combo.classList.remove('h-cold', 'h-warm', 'h-fire', 'h-inferno');
    combo.classList.add(`h-${h.state}`);
    q('flame').textContent = h.state === 'inferno' ? '🔥🔥' : '🔥';
    const onFire = h.streak >= 3 && !this.model.inMatch && this._fxOn();
    this.root.classList.toggle('arc-on-fire', onFire);
    this.root.classList.toggle('arc-inferno', onFire && h.state === 'inferno');
    this.cineEl.classList.toggle('fire', onFire);
    this.cineEl.classList.toggle('inferno', onFire && h.state === 'inferno');
    if (animate && h.streak !== from) {
      const cls = h.streak > from ? 'heat-up' : (from >= 2 && h.streak === 0 ? 'broke' : '');
      if (cls) {
        combo.classList.remove('heat-up', 'broke'); void combo.offsetWidth; combo.classList.add(cls);
        const hnd = setTimeout(() => combo.classList.remove(cls), 1400); this.hudTimers.add(hnd);
        // the number punches out at 240 ms (arc-heat-pop); a break flashes red at once
        const up = cls === 'heat-up';
        if (!this.model.inMatch && (!up || h.streak >= 2)) {
          const snd = setTimeout(() => this._cue(up ? 'streak-up' : 'streak-break', { intensity: up ? clamp(h.streak / 6, 0.3, 1) : 1 }), this.reduced ? 0 : (up ? 240 : 80));
          this.hudTimers.add(snd);
        }
      }
    }
    return { from, to: h.streak };
  }

  // ---------------------------------------------------------------- the dock
  _tok(it, key) {
    const pu = it.pu;
    const count = it.count === Infinity ? '∞' : (it.count == null ? '' : String(it.count));
    return `<span class="arc-tok k-${pu.kind === 'trick' ? 'trick' : 'ball'} r-${esc(pu.rarity || 'common')} s-${it.state}" style="--c:${safeColor(pu.color)}">`
      + `<span class="arc-tok-ball"><span class="arc-tok-emoji">${esc(pu.emoji)}</span></span>`
      + (count !== '' ? `<span class="arc-tok-count num">${count}</span>` : '')
      + (it.state === 'used' ? '<span class="arc-tok-stamp">USED</span>' : '')
      + (key ? `<span class="arc-tok-key num">${esc(key.label)}</span>` : '')
      + '</span>';
  }

  // why it cannot be armed
  _lockText(it, m) {
    if (m.mode !== 'match') return m.freeId && it.pu.kind !== 'trick' ? 'FREE BALL THIS SHOT' : 'MATCH PLAY ONLY';
    if (it.pu.kind === 'trick') return m.charges === 0 ? 'NO CHARGES LEFT' : `${m.oppName.toUpperCase()} IS ALREADY CURSED`;
    return m.freeId ? 'FREE BALL THIS SHOT' : 'NO CHARGES LEFT';
  }

  _itemLabel(it, m) {
    const name = ballName(it.pu);
    const what = it.state === 'armed' ? (m.freeId === it.pu.id ? 'free this shot' : 'armed') : it.state === 'used' ? 'used' : it.state === 'empty' ? 'none left'
      : it.state === 'locked' ? this._lockText(it, m).toLowerCase()
        : it.count === Infinity ? 'unlimited' : it.count != null ? `${it.count} left` : 'ready';
    return `${name}, ${what}`;
  }

  _renderDock() {
    const m = this.model = dockModel(this.snap, this.catalogue, this.match, { freeBall: this.freeBall || null });
    const root = this.root;
    root.classList.toggle('arc-in-match', m.inMatch);
    root.classList.toggle('arc-dock-off', m.mode === 'hidden');
    root.classList.toggle('arc-p1', m.mode === 'match' && m.slot === 1);
    root.classList.toggle('arc-p2', m.mode === 'match' && m.slot === 2);
    const armed = m.armedId ? [...m.balls, ...m.tricks].find((it) => it.pu.id === m.armedId) : null;
    root.classList.toggle('arc-has-armed', !!armed);
    this.dockEl.style.setProperty('--ac', armed ? safeColor(armed.pu.color) : 'transparent');

    // the head: whose loadout (match), what is armed, who the tricks are aimed at (match)
    let head = '';
    if (m.mode === 'match') {
      const pips = m.unlimited ? '<i class="on inf">∞</i>' : Array.from({ length: Math.min(8, m.charges) }, () => '<i class="on"></i>').join('');
      const chargeText = m.unlimited ? 'UNLIMITED' : m.charges === 0 ? (armed ? 'LAST ONE ARMED' : 'NO CHARGES LEFT') : `${m.charges} CHARGE${m.charges === 1 ? '' : 'S'}`;
      head += `<div class="arc-dock-who"><i class="arc-dock-pip">P${m.slot}</i><b>${esc(m.playerName.toUpperCase())}</b><span class="arc-charges" aria-hidden="true">${pips}</span><em>${chargeText}</em></div>`;
    }
    if (armed) {
      const free = m.freeId === armed.pu.id;
      const held = free && m.heldId ? this.catalogue.find((p) => p.id === m.heldId) : null;
      head += `<div class="arc-dock-armed${free ? ' free' : ''}" style="--c:${safeColor(armed.pu.color)}"><span>${free ? 'FREE' : 'ARMED'}</span><b>${esc(armed.pu.emoji)} ${esc(ballName(armed.pu))}</b>`
        + `${held ? `<em title="${esc(ballName(held))}: kept for your next shot">+${esc(held.emoji)} KEPT</em>` : ''}</div>`;
    }
    if (m.mode === 'match' && m.tricks.length) {
      const cursed = m.oppCursedWith ? this.catalogue.find((p) => p.id === m.oppCursedWith) : null;
      head += `<div class="arc-dock-sab${cursed ? ' cast' : ''}"><span>${cursed ? `${esc(ballName(cursed))} CAST ON` : 'SABOTAGE ▸'}</span><b>${esc(m.oppName.toUpperCase())}</b></div>`;
    }
    this.dockHead.innerHTML = head;
    this.dockHead.classList.toggle('hidden', !head);

    // the bar: keys 1 to 9
    const slot = (it) => `<button type="button" class="arc-slot" data-id="${esc(it.pu.id)}" title="${esc(`${ballName(it.pu)} — ${it.pu.tagline}`)}" aria-label="${esc(this._itemLabel(it, m))}" aria-pressed="${it.state === 'armed'}">${this._tok(it, m.keys.get(it.pu.id))}</button>`;
    const barBalls = m.bar.filter((it) => it.pu.kind !== 'trick');
    const barTricks = m.bar.filter((it) => it.pu.kind === 'trick');
    const total = m.balls.length + (m.mode === 'match' ? m.tricks.length : 0);
    const hidden = m.rest.filter((it) => it.state === 'ready').length;
    let bar = '<div class="arc-dock-balls">';
    bar += barBalls.length ? barBalls.map(slot).join('')
      : `<div class="arc-dock-none"><b>${m.mode === 'match' && m.charges === 0 ? 'NO CHARGES LEFT' : 'NO POWER BALLS'}</b><span>${m.mode === 'match' ? 'YOUR SWING WILL HAVE TO DO' : 'STREAKS AND LEVEL-UPS EARN THEM'}</span></div>`;
    bar += '</div>';
    bar += `<button type="button" class="arc-dock-more${this.trayOpen ? ' open' : ''}" data-act="tray" title="All balls: what they do (B)" aria-expanded="${this.trayOpen}">`
      + `<b class="num">${hidden > 0 ? `+${hidden}` : 'ALL'}</b><span>${hidden > 0 ? 'MORE' : `${total} BALLS`}</span><i class="arc-tok-key num">B</i></button>`;
    if (barTricks.length) bar += `<div class="arc-dock-tricks">${barTricks.map(slot).join('')}</div>`;
    this.dockBar.innerHTML = bar;
    this.dockEl.classList.toggle('arc-dock-empty', !barBalls.length);

    this._renderTray();
    this._renderCurse();
  }

  // the tray: every ball and trick, what it does, and a cursor for the keyboard
  _trayItems() {
    const m = this.model;
    return [...m.balls, ...m.tricks];
  }

  _renderTray() {
    if (!this.trayOpen) return;
    const m = this.model;
    const items = this._trayItems();
    this.trayCursor = clamp(this.trayCursor, 0, Math.max(0, items.length - 1));
    const cell = (it, i) => `<button type="button" class="arc-cell s-${it.state}${i === this.trayCursor ? ' cur' : ''}" data-id="${esc(it.pu.id)}" data-i="${i}" aria-label="${esc(this._itemLabel(it, m))}" aria-pressed="${it.state === 'armed'}">`
      + `${this._tok(it, m.keys.get(it.pu.id))}<b>${esc(ballName(it.pu))}</b></button>`;
    const title = m.mode === 'match'
      ? `${esc(m.playerName.toUpperCase())}'S LOADOUT`
      : (m.unlimited ? 'BALL BAG · UNLIMITED' : 'BALL BAG');
    const hint = m.mode === 'match'
      ? (m.unlimited ? 'Every ball, every shot.' : 'One charge buys any ball or trick, each once a match.')
      : 'One ball, one power-up. Earn more with streaks, level-ups and jackpots.';
    this.trayEl.innerHTML = `
      <div class="arc-tray-head">
        <b>${title}</b><span>${hint}</span>
        <button type="button" class="arc-tool arc-tool-mute${this.muted ? ' off' : ''}" data-act="mute" title="${this.muted ? 'Arcade effects are off: turn them on' : 'Mute banners, crowd and sounds'}" aria-pressed="${!this.muted}">⚡</button>
        <button type="button" class="arc-tool" data-act="tray" title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="arc-tray-grid">${m.balls.map((it, i) => cell(it, i)).join('')}</div>
      ${m.tricks.length ? `<div class="arc-tray-sab"><span class="arc-tray-sab-lbl">${m.mode === 'match' ? `SABOTAGE ▸ <b>${esc(m.oppName.toUpperCase())}</b>` : 'SABOTAGE · <b>MATCH ONLY</b>'}</span>
        <div class="arc-tray-grid">${m.tricks.map((it, j) => cell(it, m.balls.length + j)).join('')}</div></div>` : ''}
      <div class="arc-tray-detail"></div>
      <div class="arc-tray-foot"><span><kbd>1</kbd>–<kbd>9</kbd> the dock</span><span><kbd>⇧</kbd>+<kbd>1</kbd>–<kbd>9</kbd> the rest</span><span><kbd>←↑↓→</kbd> <kbd>Enter</kbd> pick here</span><span><kbd>B</kbd> / <kbd>Esc</kbd> close</span></div>`;
    this._renderDetail();
  }

  _renderDetail() {
    const d = this.trayEl.querySelector('.arc-tray-detail');
    const it = this._trayItems()[this.trayCursor];
    if (!d || !it) return;
    const m = this.model, pu = it.pu;
    const stateText = it.state === 'armed' ? (m.freeId === pu.id ? 'FREE THIS SHOT' : 'ARMED') : it.state === 'used' ? 'USED THIS MATCH' : it.state === 'empty' ? 'NONE LEFT'
      : it.state === 'locked' ? this._lockText(it, m)
        : it.count === Infinity ? 'UNLIMITED' : it.count != null ? `×${it.count}` : (pu.kind === 'trick' ? `HITS ${m.oppName.toUpperCase()}` : 'READY');
    d.style.setProperty('--c', safeColor(pu.color));
    d.innerHTML = `<span class="arc-detail-emoji">${esc(pu.emoji)}</span>
      <span class="arc-detail-text"><b>${esc(ballName(pu))}</b><span>${esc(pu.tagline)}</span></span>
      <span class="arc-detail-meta"><i class="arc-rar r-${esc(pu.rarity || 'common')}">${esc(String(pu.rarity || 'common').toUpperCase())}</i><b class="num s-${it.state}">${esc(stateText)}</b></span>`;
  }

  _setCursor(i, tick = false) {
    const items = this._trayItems();
    if (!items.length) return;
    const was = this.trayCursor;
    this.trayCursor = clamp(i, 0, items.length - 1);
    if (tick && this.trayCursor !== was) this._cue('ui-tick', { intensity: 0.5 });
    for (const c of this.trayEl.querySelectorAll('.arc-cell')) c.classList.toggle('cur', Number(c.dataset.i) === this.trayCursor);
    this._renderDetail();
  }

  // arrows in the tray: a grid of balls, then the row of tricks under it
  _moveCursor(dx, dy) {
    const m = this.model, nb = m.balls.length, nt = m.tricks.length;
    let i = this.trayCursor;
    if (i < nb) {
      if (dx) i = clamp(i + dx, 0, nb - 1);
      if (dy < 0 && i - TRAY_COLS >= 0) i -= TRAY_COLS;
      if (dy > 0) {
        if (i + TRAY_COLS < nb) i += TRAY_COLS;
        else if (nt && Math.floor(i / TRAY_COLS) === Math.floor((nb - 1) / TRAY_COLS)) i = nb + Math.min(nt - 1, i % TRAY_COLS);
        else if (nt === 0 || Math.floor(i / TRAY_COLS) < Math.floor((nb - 1) / TRAY_COLS)) i = Math.min(nb - 1, i + TRAY_COLS);
      }
    } else {
      const j = i - nb;
      if (dx) i = nb + clamp(j + dx, 0, nt - 1);
      if (dy < 0) i = Math.min(nb - 1, Math.floor((nb - 1) / TRAY_COLS) * TRAY_COLS + j);
    }
    this._setCursor(i, true);
  }

  // { sound: true }: the player opened or closed it (a tray that closes itself is silent)
  toggleTray(force, { sound = false } = {}) {
    const show = force ?? !this.trayOpen;
    if (show === this.trayOpen) return;
    if (show && (this.model.mode === 'hidden' || this.snap.enabled === false || !this.stopped)) return;
    this.trayOpen = show;
    if (sound) this._cue(show ? 'ui-confirm' : 'ui-back', { intensity: 0.6 });
    this.trayEl.classList.toggle('hidden', !show);
    this.root.classList.toggle('arc-tray-open', show);
    this.dockBar.querySelector('.arc-dock-more')?.classList.toggle('open', show);
    this.dockBar.querySelector('.arc-dock-more')?.setAttribute('aria-expanded', String(show));
    if (show) {
      const items = this._trayItems();
      const at = items.findIndex((it) => it.state === 'armed');
      this.trayCursor = at >= 0 ? at : Math.max(0, items.findIndex((it) => it.state === 'ready'));
      this._renderTray();
    }
  }

  // the old "?" card: the tray says what every ball does
  toggleHelp(force) { this.toggleTray(force); }

  setMuted(on) {
    this.muted = !!on;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* storage blocked */ }
    this.root.classList.toggle('arc-muted', this.muted);
    if (this.muted) { this._cancelShot(); this._crowd(0, 0.3); }
    try { this.audio?.setEnabled?.(!this.muted); } catch { /* an audio engine without it */ }
    this._renderTop(this.snap, { animate: false });
    this._renderTray();
  }

  // a trick waiting on the player who is up; the fog trick also hides the yardages (arcade.css)
  _renderCurse() {
    const m = this.model;
    const id = m.mode === 'match' ? m.cursedWith : null;
    const fog = id === 'fog';
    this.hud.classList.toggle('arc-fog', fog);
    this.cineEl.classList.toggle('fog', fog);
    if (!id) { this.curseEl.classList.add('hidden'); this.curseId = null; return; }
    const pu = this.catalogue.find((p) => p.id === id) || FALLBACK_BY_ID.get(id) || { id, emoji: '⚠️', name: id, color: '#ff7a52' };
    const txt = CURSES[id] || { title: `${ballName({ ...pu, kind: 'trick' })} INCOMING`, sub: String(pu.tagline || '').toUpperCase() };
    this.curseEl.style.setProperty('--c', safeColor(pu.color, '#ff7a52'));
    this.curseEl.innerHTML = `<span class="arc-curse-ico">${esc(pu.emoji)}</span><span class="arc-curse-text"><b>${esc(txt.title)}</b><span>FROM ${esc(m.oppName.toUpperCase())} · ${esc(txt.sub)}</span></span>`;
    const fresh = this.curseId !== `${m.playerId}:${id}`;
    this.curseId = `${m.playerId}:${id}`;
    this.curseEl.className = `arc-curse k-${safeId(id)}`;
    if (fresh) { void this.curseEl.offsetWidth; this.curseEl.classList.add('in'); }
  }

  // ---------------------------------------------------------------- arming
  async arm(id) {
    if (this.snap.enabled === false || this.arming) return;
    const m = this.model;
    if (m.mode === 'hidden') return;
    const it = [...m.balls, ...m.tricks].find((x) => x.pu.id === id);
    const nope = () => { for (const n of this.root.querySelectorAll(`[data-id="${CSS.escape(String(id))}"]`)) this._shake(n); };
    if (!it) return;
    if (!this.stopped) { nope(); return; }                     // a ball is in the air: the next shot is not yours yet
    if (it.state === 'empty' || it.state === 'used' || it.state === 'locked') { nope(); return; }
    if (m.freeId && it.pu.kind !== 'trick') { nope(); return; }   // a rocket hole's tee shot: the ball is the stage's
    if (m.mode === 'match') return this._armMatch(it, nope);

    const armed = this.snap.armed || null;
    const next = armed === id ? null : id;
    this.snap = { ...this.snap, armed: next };   // optimistic
    this._renderDock();
    if (next) this._announceArmed(it.pu);
    else this._cue('ui-back', { intensity: 0.6 });
    if (this.trayOpen) this._closeTraySoon();
    this.arming = true;
    try {
      const res = await this.fetchJson('/api/arcade/arm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: next }),
      });
      if (res && typeof res === 'object' && ('armed' in res || 'inventory' in res)) this.onState(res);
      else if (res && res.state && typeof res.state === 'object') this.onState(res.state);
      if (!res || res.ok === false) { this.snap = { ...this.snap, armed }; this._renderDock(); this._load(); }
    } catch { this.snap = { ...this.snap, armed }; this._renderDock(); }
    this.arming = false;
  }

  // In a match: a ball for this player's next shot (again: put it back), or a trick on the
  // opponent's. The server is the authority; the dock only shows what it answers.
  async _armMatch(it, nope) {
    const m = this.model;
    const trick = it.pu.kind === 'trick';
    const next = !trick && m.armedId === it.pu.id ? null : it.pu.id;
    const before = this.match;
    if (!trick) {   // optimistic: the token lights at once
      this.match = { ...before, players: (before.players || []).map((p) => (p && p.id === m.playerId ? { ...p, armedPowerup: next } : p)) };
      this._renderDock();
    }
    if (next) this._announceArmed(it.pu, trick ? m.oppName : null);
    else this._cue('ui-back', { intensity: 0.6 });
    if (this.trayOpen) this._closeTraySoon();
    this.arming = true;
    let res = null;
    try {
      res = await this.fetchJson('/api/match/arm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: m.playerId, id: next }),
      });
    } catch { res = null; }
    this.arming = false;
    if (this.disposed) return;
    if (res && res.ok !== false && res.match && typeof res.match === 'object') { this.setMatch(res.match); return; }
    if (res && res.ok !== false && !('match' in res)) return;   // an answer with no state: the 'match' event will bring it
    this.match = before;                                        // refused: back to what the server last said
    this._renderDock();
    nope();
  }

  _announceArmed(pu, targetName = null) {
    if (!this._fxOn()) return;
    const c = safeColor(pu.color);
    // the token lights on this frame: its sting now, then the announcer names the ball
    if (targetName) {
      // the match screens show SABOTAGE! for the cast (the 'trick-cast' event): ours is its sound
      this._moment({ impact: 'trick-cast', say: `pu-${pu.id}` });
    } else {
      this._flash(`ARMED: ${pu.emoji} ${ballName(pu)}`, 'armed', 1700, c);
      const tier = pu.rarity === 'epic' || pu.rarity === 'legendary' ? 'epic' : pu.rarity === 'rare' ? 'rare' : 'common';
      this._moment({ impact: `arm-${tier}`, say: `pu-${pu.id}` });
    }
  }

  _closeTraySoon() {
    const h = setTimeout(() => this.toggleTray(false), 220);
    this.hudTimers.add(h);
  }

  _key(e) {
    if (this.disposed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.snap.enabled === false || this.model.mode === 'hidden') return;
    // v2:qa a match overlay owns the keyboard while it is up (the match menu's 1 to 5, the
    // stray-ball prompt, a full-bleed screen such as the lobby): this listener is on window
    // and runs before the match UI's, so without this "2: UNDO LAST SHOT" also armed ball 2
    if (this.hud?.querySelector?.('.mt-menu:not(.hidden), .mt-stray:not(.hidden), .mt-screen:not(.hidden)')) return;
    const k = String(e.key || '');
    const take = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    // v2:playability R (rescue): DROP ON THE LINE, twice when it costs a stroke, while it is offered
    // (D, the brief's key, is the game shell's DATA panel)
    if (!this.trayOpen && !e.repeat && !e.shiftKey && k.toLowerCase() === 'r' && this._dropOffer()) { take(); this._dropPress(); return; }
    if (this.trayOpen) {
      if (k === 'Escape' || k.toLowerCase() === 'b' || k === '?') { take(); this.toggleTray(false, { sound: true }); return; }
      if (k === 'ArrowLeft') { take(); this._moveCursor(-1, 0); return; }
      if (k === 'ArrowRight') { take(); this._moveCursor(1, 0); return; }
      if (k === 'ArrowUp') { take(); this._moveCursor(0, -1); return; }
      if (k === 'ArrowDown') { take(); this._moveCursor(0, 1); return; }
      if (k === 'Enter' || k === ' ') {
        if (t && t.tagName === 'BUTTON' && this.trayEl.contains(t)) return;   // a focused cell clicks itself
        take();
        const it = this._trayItems()[this.trayCursor];
        if (it) this.arm(it.pu.id);
        return;
      }
    } else if (!e.repeat && (k.toLowerCase() === 'b' || k === '?')) { take(); this.toggleTray(true, { sound: true }); return; }
    if (e.repeat) return;
    const d = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '') || (/^[1-9]$/.test(k) ? [k, k] : null);
    if (!d) return;
    const digit = Number(d[1]);
    for (const [id, key] of this.model.keys) {
      if (key.digit === digit && key.shift === !!e.shiftKey) { e.preventDefault(); this.arm(id); return; }
    }
  }

  // ---------------------------------------------------------------- the shot
  onShot(shot, state, opts = {}) {
    if (state) this.setGameState(state);
    this._cancelShot();
    this.shot = shot || null;
    this.arcadeEv = null;
    this.called = null;
    this.momentAt = null;
    this.stopped = false;
    this.holdHud = true;
    if (!shot?.sim?.points?.length) { this.stopped = true; this.holdHud = false; return; }
    this.shotId = shot.shotId;
    this._wall = wallMsFor(shot, opts);
    this.t0 = performance.now();
    this.toggleTray(false);
    this.root.classList.add('arc-flying');   // the dock, the challenges and the warnings step aside

    const script = buildCrowdScript(shot, this.pin);
    this.lastScript = script;

    if (this._fxOn()) {
      const mph = fin(shot.launch?.speedMph) ?? 0;
      // which ball was armed: the shot says so when the server attached its grade
      // (shot.arcade.powerup), else whatever the dock had armed at impact
      const usedId = shot.arcade && 'powerup' in shot.arcade ? shot.arcade.powerup : this.model.armedId;
      const armed = usedId && this.catalogue.find((p) => p.id === usedId && p.kind !== 'trick');
      if (armed) this._flash(`${armed.emoji} ${ballName(armed)}!`, 'ball', 1800, safeColor(armed.color));
      // one impact sound: the booster for a Rocket, the strike for everything else
      if (armed && armed.id === 'rocket') this._cue('rocket', { intensity: 1 });
      else this._cue('strike', { intensity: clamp((mph - 25) / 140, 0.15, 1) });
    }

    for (const item of script.items) {
      this._timer(this._wall(item.t), () => this._run(item, script.meta));
    }
    // the grade rode in on the shot itself (shot.arcade with a grade): no need to wait for 'arcade'
    return script;
  }

  _run(item, meta) {
    if (item.kind === 'stop') { this._ballStopped(meta); return; }
    if (item.kind === 'slowmo') { this._slowmo(item.on, item); return; }
    if (!this._fxOn()) return;
    if (item.kind === 'cue') {
      if (CROWD_CUES.has(item.cue)) this._crowdShot(item.cue, item.intensity);
      else if (item.cue === 'splash' && calloutOf(this.arcadeEv)?.id === 'lava') this._cue('lava-sizzle', { intensity: 1 });
      else this._cue(item.cue, { intensity: item.intensity });
    } else if (item.kind === 'crowd') this._crowd(item.level, item.ramp);
    else if (item.kind === 'fx') {
      // with a callout on its way the banner says it; these small flashes are for a grade without one
      const spoken = !!calloutOf(this.arcadeEv) || !!this.called;
      if (item.fx === 'holed') { if (!spoken) { this._burst({ confetti: 90, fireworks: 3 }); this._flash('⛳ IN THE HOLE!', 'holed', 2200); } }
      else if (item.fx === 'splash' && !spoken) this._flash('💦 SPLASH', 'splash', 1400);
    }
  }

  // a sim.slowmo window is open: letterbox + vignette over the course, a small tag
  _slowmo(on, item) {
    const show = !!on && this._fxOn();
    this.cineEl.classList.toggle('on', show);
    this.slowTag.classList.toggle('on', show);
    this.root.classList.toggle('arc-in-slowmo', show);
    if (!show) return;
    const rate = fin(item?.rate);
    this.slowTag.querySelector('b').textContent = rate && rate > 0 && rate < 1 ? `${+rate.toFixed(2)}×` : '';
    this.slowTag.querySelector('em').textContent = String(item?.reason || '').replace(/[_-]+/g, ' ').trim().slice(0, 28);
  }

  _ballStopped(meta) {
    this.stopped = true;
    this.root.classList.remove('arc-flying');
    this._slowmo(false);
    if (this._fxOn()) {
      if (meta?.holed) this._timer(2400, () => this._crowd(0.08, 3));
      else {
        const d = meta?.minDistYd;
        const level = d == null ? 0.1 : clamp(0.45 - d / 30, 0.05, 0.45);
        this._crowd(level, 0.4);
        this._timer(1800, () => this._crowd(0.05, 2.5));
      }
    }
    if (this.arcadeEv) this._reveal(this.arcadeEv);
    else {
      // no grade yet: give a late 'arcade' event a moment, then stop holding the counters
      this._timer(2500, () => {
        if (this.revealing || this.arcadeEv || !this.holdHud) return;
        this.holdHud = false;
        this._renderTop(this.snap, { animate: true });
        this._renderChallenges({ animate: true });
      });
    }
  }

  onArcade(ev) {
    if (!ev || typeof ev !== 'object') return;
    const forThisShot = this.shot && ev.shotId != null && this.shotId != null ? ev.shotId === this.shotId : !!this.shot;
    if (forThisShot && !this.stopped) {
      this.arcadeEv = ev; this.holdHud = true;
      this._planCallout(ev);
      return;
    }
    this.momentAt = null;
    this.arcadeEv = null;
    this._reveal(ev);
  }

  // A callout whose moment comes before the ball stops (a holed ball, a splash, a rocket
  // leaving) is shouted then; what the shot earned still waits for the ball to stop.
  _planCallout(ev) {
    const c = calloutOf(ev);
    if (!c || !this.lastScript || !this._wall) return;
    const m = calloutMoment(c, this.shot, this.lastScript.meta);
    // its crowd reaction lands with the slam: the script's own gasp or roar at that moment gives way
    if (crowdCueFor(c)) this.momentAt = this._wall(m.t) + (this.reduced ? 110 : TONE_HIT[c.tone] || 250) + CROWD_AFTER_MS;
    if (m.kind === 'stop') return;
    const due = this._wall(m.t) - (performance.now() - this.t0);
    if (due < -700) return;   // the grade came too late for its moment: it lands with the reveal
    this._timer(Math.max(0, due), () => { if (this.arcadeEv === ev && this._fxOn()) this._callout(ev, m.kind); });
  }

  // ---------------------------------------------------------------- the callout
  // The banner: the shot's callout (else its grade), said aloud, with the crowd.
  //   kind 'launch': BLAST OFF! at impact, gone again long before the ball lands; the
  //   reveal then leads with the grade.
  _callout(ev, kind = 'stop') {
    if (this.called && this.called.ev === ev && this.called.kind !== 'launch') return;   // already up
    const launched = !!this.called && this.called.ev === ev;   // said at launch: the grade leads now
    this.called = { ev, kind };
    const gradeName = GRADES[ev.grade] ? ev.grade : 'OK';
    const grade = GRADES[gradeName];
    const c = launched ? null : calloutOf(ev);
    const tone = c ? c.tone : grade.tone;
    const text = c ? c.text : grade.text;
    this._showBanner(text, { tone, gradeKey: gradeName.toLowerCase(), id: c?.id || '' });
    this.bannerCallout = c;

    // The slam lands a few frames after the banner appears: the sparks, the jolt and the
    // sound all go on that frame. One stack: the grade's sting, one crowd reaction, one line.
    // An ordinary shot (OK, no callout) gets no sting and no crowd; BLAST OFF! at launch is
    // the announcer alone (the booster is already the impact).
    this._timer(this.reduced ? 110 : TONE_HIT[tone] || 250, () => {
      if (!this.called || this.called.ev !== ev || this.called.kind !== kind) return;
      if (tone === 'epic') {
        this._burst({ confetti: gradeName === 'JACKPOT' ? 80 : 50, fireworks: gradeName === 'JACKPOT' ? 4 : 2 });
        this._sparks(26);
        this._quake('quake');
      } else if (tone === 'good') {
        if (gradeName === 'PERFECT' || gradeName === 'JACKPOT') this._burst({ confetti: 40, fireworks: 1 });
      } else if (tone === 'bad') {
        this._quake('thud');
      }
      const ordinary = !c && !launched && gradeName === 'OK';
      this._moment({
        sting: kind === 'launch' || ordinary ? null : grade.cue,
        crowd: c && kind !== 'launch' ? crowdCueFor(c) : null,
        say: c ? c.voice : null,
        priority: 2,
      });
    });
    if (kind === 'launch') this._timer(1700 * (this.reduced ? 0.6 : 1), () => { if (this.called && this.called.ev === ev && this.called.kind === 'launch') this._hideBanner(); });
  }

  // ---------------------------------------------------------------- the reveal
  _reveal(ev) {
    this.arcadeEv = null;
    this.root.classList.remove('arc-flying');
    const final = ev.state && typeof ev.state === 'object' ? ev.state : null;
    const finish = () => {
      this.holdHud = false;
      this.revealing = false;
      if (final) this.onState(final);
      else this._renderTop(this.snap, { animate: true });
    };
    // the challenges wait for the banner to clear (they share the upper part of the screen),
    // then show what this shot did to them
    const challenges = () => {
      this.holdChal = false;
      this.root.classList.remove('arc-revealing');
      this._renderChallenges({ animate: true, finished: ev.award ? ev.award.challenges : null });
    };
    if (!this._fxOn()) { finish(); challenges(); return; }
    this.revealing = true;
    this.holdHud = true;     // an 'arcade-state' arriving mid-reveal must not jump the count-up
    this.holdChal = true;
    this.root.classList.add('arc-revealing');

    const k = this.reduced ? 0.45 : 1;
    const at = (ms, fn) => this._timer(ms * k, fn);
    const gradeName = GRADES[ev.grade] ? ev.grade : 'OK';
    const award = ev.award || {};
    const inMatch = this.model.inMatch;
    const streak = Number.isFinite(award.streak) ? award.streak : (final?.streak ?? this.snap.streak ?? 0);
    const points = Math.round(fin(ev.points) ?? 0);
    const coins = Math.round(fin(award.awarded?.coins) ?? fin(ev.coins) ?? 0);
    const xpGain = Math.round(fin(award.awarded?.xp) ?? 0);
    const granted = Array.isArray(award.granted) ? award.granted : [];
    const levelUp = !!award.levelUp;
    const levelFrom = this.shownLevel;
    const mult = fin(ev.multiplier?.total);
    const record = recordOf(ev);

    // 1. the callout (unless its moment already came: a holed ball, a splash)
    this._callout(ev, 'stop');
    const c = this.bannerCallout;
    const hold = TONE_HOLD[this.bannerTone] || 3000;

    // 2. what it earned: the grade, the points, the multiplier, the coins
    at(320, () => this._showSub({
      grade: c && !PLAIN_IDS.has(c.id) ? gradeName : null, gradeKey: gradeName.toLowerCase(),
      points, mult: mult !== null && Math.abs(mult - 1) > 0.01 ? mult : null, coins,
    }));

    // 3. why
    const reasons = (Array.isArray(ev.reasons) ? ev.reasons : []).filter((r) => r != null && String(r).trim()).slice(0, 3);
    // a trick was on this shot (the grade's `gust`): it leads the line
    const gustMph = fin(ev.gust?.mph);
    if (gustMph) { reasons.unshift(`💨 ${Math.round(gustMph)} mph gust`); reasons.length = Math.min(reasons.length, 3); }
    if (reasons.length) at(620, () => {
      this.reasonsEl.innerHTML = reasons.map((r) => `<span>${esc(String(r).slice(0, 48))}</span>`).join('<i>·</i>');
      this.reasonsEl.className = 'arc-reasons in';
    });

    // 4. the coins, flying to the counter (solo: a match has no coin counter on screen)
    const tCoins = 1300;
    if (coins > 0 && !inMatch) at(tCoins, () => {
      this._cue('coin-burst', { intensity: clamp(coins / 40, 0.3, 1) });   // as they burst out of the row
      this._coinsFly(coins);
    });
    const tHud = tCoins + 650;
    at(tHud, () => {
      this.holdHud = false;
      if (final) this.snap = { ...this.snap, ...final, inventory: final.inventory || this.snap.inventory };
      else this.snap = { ...this.snap, coins: (this.snap.coins || 0) + coins, streak };
      this._renderTop(this.snap, { animate: true });
      this._renderDock();
      if (!inMatch) {
        this.statsEl.classList.remove('bump'); void this.statsEl.offsetWidth; this.statsEl.classList.add('bump');
        if (xpGain > 0) this._xpTag(xpGain);
      }
    });

    // 5. the streak: the combo meter heats up (or shatters) where it sits, with its own
    // sound on that frame (_setStreak); the whole HUD catches fire at 3. No extra banner:
    // the server's ON FIRE / UNSTOPPABLE callouts say it.

    // 6. a record, when the server says so
    let tNext = Math.max(2500, hold - 300);
    if (record) at(tHud + 500, () => this._record(record));

    // 7. level up: the banner makes way for it
    // (not in a match: the badge is the bay's own, and it landed under the turn banner and
    // the match header. The level in the top strip is right when the match is over.)
    let bannerOut = hold;
    if (levelUp && !inMatch) {
      const tLv = Math.min(tNext, 2700);
      bannerOut = Math.min(hold, tLv - 150);
      at(tLv, () => this._levelUp(final?.level ?? (levelFrom + 1), levelFrom));
      tNext = tLv + 2700;
    }

    // 8. new balls: one chest (solo: a match shot still earns the bay its balls, quietly;
    // the match's own chest is on its winner screen)
    const kinds = new Map();
    for (const id of granted) if (id) kinds.set(id, (kinds.get(id) || 0) + 1);
    if (kinds.size && !inMatch) at(tNext, () => this._chest([...kinds].slice(0, 4)));

    // 9. out
    at(bannerOut, () => this._hideBanner());
    at(bannerOut + 500, challenges);
    at(tHud + 50, finish);
  }

  _showBanner(text, { tone = 'neutral', gradeKey = 'ok', id = '' } = {}) {
    const b = this.bannerEl;
    this.bannerTone = tone;
    this.flashEl.classList.add('hidden');   // one thing at a time in the upper centre
    this.root.classList.remove('arc-flashing');
    b.className = `arc-banner t-${tone} g-${gradeKey}${id ? ` c-${id}` : ''}`;
    b.innerHTML = '';
    const lines = splitCallout(text);
    const mk = () => {
      const inner = el('span', 'arc-banner-text');
      let i = 0;
      for (const line of lines) {
        const L = el('span', 'arc-line');
        for (const ch of line) {
          const s = el('span', 'arc-ch', ch === ' ' ? ' ' : ch);
          s.style.setProperty('--i', String(i++));
          L.append(s);
        }
        inner.append(L);
      }
      return inner;
    };
    b.append(el('span', 'arc-banner-glow'), el('span', 'arc-banner-ring'));
    const main = mk();
    if (tone === 'bad') {            // two halves along a jagged line: it lands, then it cracks
      const wrap = el('span', 'arc-crack');
      main.classList.add('arc-crack-a');
      const twin = mk();
      twin.classList.add('arc-crack-b');
      twin.setAttribute('aria-hidden', 'true');
      wrap.append(main, twin);
      b.append(wrap);
    } else b.append(main);
    if (tone === 'funny') {   // stickers bouncing at both ends
      const [l, r] = STICKERS[id] || ['🤪', '😂'];
      const sl = el('span', 'arc-sticker l', l), sr = el('span', 'arc-sticker r', r);
      sl.setAttribute('aria-hidden', 'true'); sr.setAttribute('aria-hidden', 'true');
      b.append(sl, sr);
    }
    this.stageEl.className = `arc-stage t-${tone}`;
    this.subEl.className = 'arc-sub hidden';
    this.reasonsEl.className = 'arc-reasons hidden';
    this.reasonsEl.innerHTML = '';
    // fit: one size per tone, smaller on two lines, and never wider than the clear view
    const planner = !!this.hud.querySelector?.('#planner:not(.hidden)');
    const maxW = Math.max(240, Math.min((this.stageEl.clientWidth || 1680) - 120, planner ? 780 : 1000));
    let fs = (TONE_FONT[tone] || 96) * (lines.length > 1 ? 0.8 : 1);
    b.style.setProperty('--fs', `${fs}px`);
    const w = main.offsetWidth;
    if (w > maxW) { fs = Math.max(44, Math.floor(fs * maxW / w)); b.style.setProperty('--fs', `${fs}px`); }
  }

  _showSub({ grade, gradeKey, points, mult, coins }) {
    const parts = [];
    if (grade) parts.push(`<span class="arc-grade g-${gradeKey}">${esc(grade)}</span>`);
    if (points !== 0) parts.push(`<b class="arc-points num${points < 0 ? ' neg' : ''}">${points < 0 ? '−' : '+'}0</b>`);
    if (mult) parts.push(`<span class="arc-mult num">×${+mult.toFixed(2)}</span>`);
    if (coins > 0) parts.push(`<span class="arc-coins num"><i>🪙</i>+${fmtInt(coins)}</span>`);
    if (!parts.length) return;
    this.subEl.innerHTML = parts.join('');
    this.subEl.className = 'arc-sub in';
    const p = this.subEl.querySelector('.arc-points');
    if (p) this._countTo(p, 0, Math.abs(points), 800, (v) => (points < 0 ? '−' : '+') + fmtInt(v));
  }

  _hideBanner() {
    if (this.bannerEl.classList.contains('hidden')) return;
    this.bannerEl.classList.add('out');
    this.subEl.classList.add('out');
    this.reasonsEl.classList.add('out');
    this._timer(520, () => {
      this.bannerEl.className = 'arc-banner hidden';
      this.subEl.className = 'arc-sub hidden';
      this.reasonsEl.className = 'arc-reasons hidden'; this.reasonsEl.innerHTML = '';
    });
  }

  _flash(text, kind = '', ms = 1800, color = null) {
    const f = this.flashEl;
    f.className = `arc-flash k-${kind}`;
    f.textContent = text;
    if (color) f.style.setProperty('--c', color); else f.style.removeProperty('--c');
    f.style.setProperty('--ms', `${ms}ms`);
    void f.offsetWidth; f.classList.add('in');
    this.root.classList.add('arc-flashing');   // the challenges yield the upper right to it
    clearTimeout(f._h);
    f._h = setTimeout(() => { f.classList.add('hidden'); this.root.classList.remove('arc-flashing'); }, ms * (this.reduced ? 0.7 : 1));
    this.hudTimers.add(f._h);
  }

  // a record takes over the "why" line under the banner, in gold
  _record(rec) {
    const said = setTimeout(() => this._say('m-new-record'), this.reduced ? 80 : 275);   // as the line slams in
    this.hudTimers.add(said);
    this.reasonsEl.innerHTML = `<span>🏆 NEW RECORD</span><i>·</i><span>${esc(rec.label)}</span>${rec.value ? `<i>·</i><b class="num">${esc(rec.value)}</b>` : ''}`;
    this.reasonsEl.className = 'arc-reasons record in';
    this._burst({ confetti: 30, fireworks: 0 });
  }

  _xpTag(xp) {
    const t = el('span', 'arc-xp-gain num', `+${fmtInt(xp)} XP`);
    this.statsEl.querySelector('.arc-stat-level').append(t);
    const h = setTimeout(() => t.remove(), 1600); this.hudTimers.add(h);
  }

  // Level up: rays, the badge flipping from the old number to the new one, confetti.
  // Upper half of the screen, and over in under three seconds.
  _levelUp(level, from) {
    const L = this.levelEl;
    const old = Number.isFinite(from) && from < level ? from : level - 1;
    L.className = 'arc-levelup';
    L.innerHTML = `<span class="arc-lv-rays"></span>
      <div class="arc-lv-inner">
        <span class="arc-lv-title">LEVEL UP!</span>
        <div class="arc-lv-badge"><b class="num old">${esc(old)}</b><b class="num new">${esc(level)}</b></div>
        <span class="arc-lv-sub">LEVEL ${esc(level)} · NEW BALLS INCOMING</span>
      </div>`;
    // the title's slam lands at 330 ms: the fanfare and the confetti go there
    const hit = setTimeout(() => { this._cue('levelup', { intensity: 1 }); this._burst({ confetti: 70, fireworks: 3 }); }, this.reduced ? 100 : 330);
    this.hudTimers.add(hit);
    const lv = this.statsEl.querySelector('.arc-lvl');
    lv.classList.remove('up'); void lv.offsetWidth; lv.classList.add('up');
    const h = setTimeout(() => L.classList.add('hidden'), this.reduced ? 1500 : 2700);
    this.hudTimers.add(h);
  }

  // New balls: a chest drops in, bursts open, and each ball pops out with its name.
  _chest(kinds) {
    if (!kinds.length) return;
    const C = this.chestEl;
    const k = this.reduced ? 0.6 : 1;
    const best = kinds.map(([id]) => this.catalogue.find((p) => p.id === id)).filter(Boolean)
      .sort((a, b) => ['common', 'rare', 'epic', 'legendary'].indexOf(b.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(a.rarity))[0];
    C.className = `arc-chest r-${esc(best?.rarity || 'common')}`;
    C.innerHTML = `<span class="arc-chest-lbl">NEW BALL${kinds.length > 1 || kinds[0][1] > 1 ? 'S' : ''}!</span>
      <span class="arc-chest-rays"></span>
      <div class="arc-chest-prize"></div>
      <span class="arc-chest-box"><span class="arc-chest-lid"></span><span class="arc-chest-body"><i></i></span></span>`;
    const prize = C.querySelector('.arc-chest-prize');
    const later = (ms, fn) => { const h = setTimeout(() => { if (!this.disposed) fn(); }, ms * k); this.hudTimers.add(h); };
    later(520, () => { C.classList.add('open'); this._cue('chest-open', { intensity: 1 }); });   // the lid flies up on this frame
    kinds.forEach(([id, count], i) => later(760 + i * 1250, () => {
      const pu = this.catalogue.find((p) => p.id === id) || { id, name: String(id), emoji: '✨', rarity: 'common', color: '#ffd21f', kind: 'ball' };
      prize.innerHTML = `${this._tok({ pu, count: null, state: 'ready' })}<b>${esc(ballName(pu))}${count > 1 ? ` <i>×${count}</i>` : ''}</b><em class="arc-rar r-${esc(pu.rarity || 'common')}">${esc(String(pu.rarity || 'common').toUpperCase())}</em>`;
      prize.className = 'arc-chest-prize';
      void prize.offsetWidth; prize.classList.add('pop');
      if (i > 0) this._cue('trophy-tick', { intensity: 0.8 });   // the first ball rides the chest opening
      for (const n of this.dockBar.querySelectorAll(`[data-id="${CSS.escape(String(pu.id))}"] .arc-tok, .arc-dock-more`)) {
        n.classList.remove('gift'); void n.offsetWidth; n.classList.add('gift');
      }
    }));
    const total = 760 + kinds.length * 1250 + 250;
    later(total, () => C.classList.add('out'));
    later(total + 450, () => { C.className = 'arc-chest hidden'; C.innerHTML = ''; });
  }

  // ---------------------------------------------------------------- challenges
  // The snapshot's three live challenges. `finished` is award.challenges: the ones this shot
  // completed. The server has paid and replaced them already, so their rows stay a moment,
  // full and gold, and then the new ones slide in. The panel is a small tab next to the
  // play area; it opens by itself for a few seconds when there is something to see.
  _fillChallenge(row, c) {
    const goal = Math.max(1, Number(c.goal) || 1);
    const prog = clamp(Number(c.progress) || 0, 0, goal);
    const done = !!c.done || prog >= goal;
    row.querySelector('.arc-ch-text').textContent = String(c.text || '').slice(0, 44);
    const rew = [];
    if (c.reward && Number(c.reward.coins) > 0) rew.push(`🪙${fmtInt(Number(c.reward.coins))}`);
    if (c.reward && Array.isArray(c.reward.balls)) for (const b of c.reward.balls.slice(0, 3)) rew.push((this.catalogue.find((p) => p.id === b) || {}).emoji || '🎁');
    row.querySelector('.arc-ch-rew').textContent = rew.join(' ');
    row.querySelector('.arc-ch-n').textContent = done ? '✔' : `${fmtInt(prog)}/${fmtInt(goal)}`;
    row.classList.toggle('done', done);
    return done ? 1 : prog / goal;
  }

  _openChal(open) {
    this.chalEl.classList.toggle('open', !!open);
    this.chalEl.querySelector('.arc-ch-head').setAttribute('aria-expanded', String(!!open));
  }

  // open for a few seconds, then back to the tab (unless the player has pinned it open)
  _peekChal(ms) {
    this._openChal(true);
    clearTimeout(this.chalPeekH);
    if (this.chalPinned) return;
    this.chalPeekH = setTimeout(() => { if (!this.chalPinned && !this.disposed) this._openChal(false); }, ms);
    this.hudTimers.add(this.chalPeekH);
  }

  _renderChallenges({ animate, finished = null } = {}) {
    const list = Array.isArray(this.snap.challenges) ? this.snap.challenges.filter((c) => c && c.id != null).slice(0, 3) : null;
    const C = this.chalEl, R = this.chalRows;
    if (!list || !list.length || this.model.inMatch) {
      C.classList.add('hidden');
      if (!list) { this.shownChal = undefined; R.innerHTML = ''; }
      return;
    }
    const have = new Map([...R.querySelectorAll('.arc-ch-row')].map((r) => [r.dataset.id, r]));
    const sweep = [];   // [row, fraction]: the bars move after the rows are in

    const just = animate && Array.isArray(finished) ? finished.filter((c) => c && have.has(String(c.id)) && !have.get(String(c.id)).dataset.hold) : [];
    just.forEach((c, i) => {
      const row = have.get(String(c.id));
      row.dataset.hold = '1';
      sweep.push([row, this._fillChallenge(row, { ...c, done: true })]);
      const h = setTimeout(() => this._challengeDone(row), 450 + i * 450);
      this.hudTimers.add(h);
    });
    if (just.length) {
      const h = setTimeout(() => {
        for (const r of R.querySelectorAll('.arc-ch-row[data-hold]')) delete r.dataset.hold;
        if (!this.disposed) this._renderChallenges({ animate: true });
      }, 2300 + just.length * 450);
      this.hudTimers.add(h);
    }
    const holding = !!R.querySelector('.arc-ch-row[data-hold]');

    const first = this.shownChal === undefined;
    const before = new Map((this.shownChal || []).map((c) => [String(c.id), c]));
    const moved = list.some((c) => { const w = before.get(String(c.id)); return !w || (Number(w.progress) || 0) !== (Number(c.progress) || 0) || !!w.done !== !!c.done; });
    const diff = animate ? challengeDiff(this.shownChal, list) : { completed: [], fresh: [] };
    const keep = new Set();
    for (const c of list) {
      const id = String(c.id);
      let row = have.get(id);
      if (!row) {
        if (holding) continue;   // its place is still taken by the one that was just finished
        row = el('div', 'arc-ch-row');
        row.dataset.id = id;
        row.innerHTML = '<span class="arc-ch-text"></span><span class="arc-ch-line"><span class="arc-ch-bar"><i></i></span><b class="arc-ch-n num"></b><span class="arc-ch-rew num"></span></span>';
        row.querySelector('.arc-ch-bar i').style.transform = 'scaleX(0)';
        if (animate && !first) row.classList.add('fresh');
        R.append(row);
      } else if (row.dataset.hold) { keep.add(row); continue; }
      keep.add(row);
      sweep.push([row, this._fillChallenge(row, c)]);
      // a server that flips `done` in place instead of replacing the challenge
      if (diff.completed.includes(id)) { const h = setTimeout(() => this._challengeDone(row), 450); this.hudTimers.add(h); }
    }
    for (const r of [...R.querySelectorAll('.arc-ch-row')]) if (!keep.has(r) && !r.dataset.hold) r.remove();
    if (!holding) for (const c of list) { const r = [...keep].find((x) => x.dataset.id === String(c.id)); if (r) R.append(r); }
    // the tab's three little bars
    C.querySelector('.arc-ch-minis').innerHTML = list.map((c) => {
      const goal = Math.max(1, Number(c.goal) || 1);
      return `<i><b style="transform:scaleX(${(clamp(Number(c.progress) || 0, 0, goal) / goal).toFixed(3)})"></b></i>`;
    }).join('');
    C.classList.remove('hidden');
    // news opens it: the first sight of them, a shot that moved one on, one completed
    if (first) this._peekChal(8000);
    else if (animate && (just.length || diff.completed.length)) this._peekChal(9000);
    else if (animate && moved) this._peekChal(6500);
    void C.offsetWidth;   // the bars sweep to their new value
    for (const [row, frac] of sweep) row.querySelector('.arc-ch-bar i').style.transform = `scaleX(${frac.toFixed(4)})`;
    if (!holding) this.shownChal = list;
  }

  // a challenge completed: its row pops gold where it sits, with a little confetti
  _challengeDone(row) {
    if (this.disposed || !this._fxOn() || !row.isConnected) return;
    row.classList.remove('pop'); void row.offsetWidth; row.classList.add('pop');
    const snd = setTimeout(() => this._cue('confetti-pop', { intensity: 1 }), this.reduced ? 0 : 190);   // as COMPLETE! stamps down
    this.hudTimers.add(snd);
    const { k, left, top } = this._rootScale();
    const r = row.getBoundingClientRect();
    this._burst({ confetti: 24, fireworks: 0, x: (r.left + r.width / 2 - left) / k, y: (r.top + r.height / 2 - top) / k, spread: 0.5 });
  }

  // ---------------------------------------------------------------- particles
  _rootScale() {
    // #hud is CSS-zoomed: rects come back in window px, our layout is in design px
    const r = this.root.getBoundingClientRect();
    const w = this.root.offsetWidth || 1;
    return { k: (r.width || w) / w, left: r.left, top: r.top };
  }

  // where the banner is, in design px (the bursts come out of it)
  _bannerCentre() {
    const W = this.root.offsetWidth || 1680, H = this.root.offsetHeight || 945;
    if (this.bannerEl.classList.contains('hidden')) return { x: W / 2, y: H * 0.26 };
    const { k, left, top } = this._rootScale();
    const r = this.bannerEl.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - left) / k, y: (r.top + r.height / 2 - top) / k };
  }

  _burst({ confetti = 60, fireworks = 2, x = null, y = null, spread = 1 } = {}) {
    if (!this._fxOn()) return;
    if (this.reduced) { confetti = Math.min(confetti, 16); fireworks = 0; }
    const W = this.root.offsetWidth || 1680, H = this.root.offsetHeight || 945;
    const c0 = this._bannerCentre();
    const cx = x ?? c0.x, cy = y ?? c0.y;
    for (let i = 0; i < fireworks; i++) {
      const f = el('span', 'arc-firework');
      f.style.left = `${cx + (Math.random() - 0.5) * W * 0.42}px`;
      f.style.top = `${clamp(cy + (Math.random() - 0.5) * H * 0.22, 90, H * 0.4)}px`;
      f.style.setProperty('--delay', `${i * 180}ms`);
      f.style.setProperty('--fc', ['#ffd21f', '#fff2a8', '#45d483', '#5ab8ff', '#ff9b3d'][i % 5]);
      f.style.setProperty('--spin', `${Math.round(Math.random() * 60)}deg`);
      this._particle(f, 1400 + i * 180);
    }
    const colours = ['#ffd21f', '#fff', '#45d483', '#5ab8ff', '#ff7a52', '#ffdc4f', '#ff4fa8'];
    for (let i = 0; i < confetti; i++) {
      if (this.live >= MAX_PARTICLES) break;
      const c = el('span', 'arc-confetti');
      const ang = Math.random() * Math.PI * 2, r = (120 + Math.random() * Math.min(W, H) * 0.42) * spread;
      c.style.left = `${cx}px`; c.style.top = `${cy}px`;
      c.style.setProperty('--dx', `${Math.cos(ang) * r}px`);
      c.style.setProperty('--dy', `${Math.sin(ang) * r * 0.6 + 220 * spread}px`);
      c.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
      c.style.setProperty('--c', colours[i % colours.length]);
      c.style.setProperty('--d', `${1300 + Math.random() * 800}ms`);
      c.style.setProperty('--delay', `${Math.random() * 160}ms`);
      c.style.width = `${7 + Math.random() * 7}px`;
      c.style.height = `${9 + Math.random() * 8}px`;
      if (i % 3 === 0) c.style.borderRadius = '50%';
      this._particle(c, 2400);
    }
  }

  // gold sparks thrown out of an epic banner
  _sparks(n = 24) {
    if (!this._fxOn() || this.reduced) return;
    const { x, y } = this._bannerCentre();
    for (let i = 0; i < n; i++) {
      if (this.live >= MAX_PARTICLES) break;
      const s = el('span', 'arc-spark');
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = 260 + Math.random() * 300;
      s.style.left = `${x + Math.cos(ang) * 120}px`; s.style.top = `${y + Math.sin(ang) * 40}px`;
      s.style.setProperty('--dx', `${Math.cos(ang) * r}px`);
      s.style.setProperty('--dy', `${Math.sin(ang) * r * 0.55}px`);
      s.style.setProperty('--a', `${(ang * 180 / Math.PI).toFixed(0)}deg`);
      s.style.setProperty('--delay', `${Math.random() * 120}ms`);
      this._particle(s, 900);
    }
  }

  // the picture itself jolts: an epic callout shakes it, a bad one drops on it (arcade.css
  // animates #scene, transform only)
  _quake(kind) {
    if (this.reduced || !this._fxOn() || typeof document === 'undefined') return;
    const b = document.body;
    b.classList.remove('arc-quake', 'arc-thud'); void b.offsetWidth;
    b.classList.add(kind === 'thud' ? 'arc-thud' : 'arc-quake');
    clearTimeout(this.quakeH);
    this.quakeH = setTimeout(() => b.classList.remove('arc-quake', 'arc-thud'), 900);
    this.hudTimers.add(this.quakeH);
  }

  _coinsFly(coins) {
    const n = Math.min(14, Math.max(3, Math.round(coins / 3)));
    const target = this.statsEl.querySelector('.arc-coin-ico');
    const { k, left, top } = this._rootScale();
    const tr = target.getBoundingClientRect();
    if (!tr.width) return;   // the strip is not on screen (a match)
    const tx = (tr.left + tr.width / 2 - left) / k, ty = (tr.top + tr.height / 2 - top) / k;
    const from = this.subEl.querySelector('.arc-coins') || (this.subEl.classList.contains('hidden') ? this.bannerEl : this.subEl);
    const pr = from.getBoundingClientRect();
    const sx = (pr.left + pr.width / 2 - left) / k, sy = (pr.top + pr.height / 2 - top) / k;
    for (let i = 0; i < n; i++) {
      if (this.live >= MAX_PARTICLES) break;
      const c = el('span', 'arc-coin', '🪙');
      c.style.left = `${sx + (Math.random() - 0.5) * 120}px`;
      c.style.top = `${sy + (Math.random() - 0.5) * 40}px`;
      c.style.setProperty('--tx', `${tx - sx}px`);
      c.style.setProperty('--ty', `${ty - sy}px`);
      c.style.setProperty('--delay', `${i * 40}ms`);
      this._particle(c, 1000 + i * 40);
    }
    const h = setTimeout(() => { target.classList.remove('ding'); void target.offsetWidth; target.classList.add('ding'); }, 650 + n * 40);
    this.hudTimers.add(h);
  }

  _particle(node, ttl) {
    this.live++;
    this.fxEl.append(node);
    let done = false;
    const kill = () => { if (done) return; done = true; node.remove(); this.live--; };
    node.addEventListener('animationend', kill, { once: true });
    const h = setTimeout(kill, ttl + 400);
    this.hudTimers.add(h);
  }

  _shake(node) {
    if (!node) return;
    node.classList.remove('nope'); void node.offsetWidth; node.classList.add('nope');
  }

  // ---------------------------------------------------------------- helpers
  _fxOn() { return !this.muted && this.snap.enabled !== false; }

  _cue(name, opts) {
    if (!this._fxOn()) return;
    try { this.audio?.cue?.(name, opts || {}); } catch (e) { console.warn('[arcade] cue failed', name, e); }
  }

  // the announcer (audio.say may not exist: the voice stream owns it)
  _say(line, opts) {
    if (!this._fxOn() || !line) return;
    try { this.audio?.say?.(line, opts || {}); } catch (e) { console.warn('[arcade] say failed', line, e); }
  }

  // A crowd one-shot from the shot's script (a gasp, an oooh, the roar): never on top of
  // another one, and never across the callout's own crowd reaction when one is on its way.
  _crowdShot(name, intensity) {
    if (!this._fxOn()) return;
    const now = performance.now();
    if (now - this.lastCrowdAt < CROWD_GAP_MS) return;
    if (this.momentAt != null) {
      const d = this.momentAt - (now - this.t0);
      if (d > -1500 && d < 1000) return;
    }
    this.lastCrowdAt = now;
    this._cue(name, { intensity });
  }

  // One moment, one stack: at most one impact, one crowd reaction, one sting and one voice
  // line, called on the frame the thing lands. audio.moment() sequences them when the
  // engine has it; else the sting and the impact go now, the crowd answers 150 ms later
  // and the announcer 250 ms after that.
  _moment({ impact = null, crowd = null, sting = null, say = null, priority = 1 } = {}) {
    if (!this._fxOn() || !this.audio) return;
    const now = performance.now();
    if (crowd && now - this.lastCrowdAt < CROWD_GAP_MS - CROWD_AFTER_MS) crowd = null;   // the script's roar or gasp just went
    if (crowd) this.lastCrowdAt = now + CROWD_AFTER_MS;
    if (!impact && !crowd && !sting && !say) return;
    if (typeof this.audio.moment === 'function') {
      const stack = {};
      if (impact) stack.impact = impact;
      if (crowd) stack.crowd = crowd;
      if (sting) stack.sting = sting;
      if (say) stack.say = say;
      stack.intensity = 1;
      stack.priority = priority;
      try { this.audio.moment(stack); } catch (e) { console.warn('[arcade] moment failed', e); }
      return;
    }
    if (impact) this._cue(impact, { intensity: 1 });
    if (sting) this._cue(sting, { intensity: 1 });
    if (crowd) { const h = setTimeout(() => this._cue(crowd, { intensity: 1 }), CROWD_AFTER_MS); this.hudTimers.add(h); }
    if (say) { const h = setTimeout(() => this._say(say, { priority }), (crowd ? CROWD_AFTER_MS : 0) + VOICE_AFTER_MS); this.hudTimers.add(h); }
  }

  _crowd(level, ramp) {
    try { this.audio?.crowd?.(clamp(level, 0, 1), Math.max(0, ramp || 0)); } catch (e) { console.warn('[arcade] crowd failed', e); }
  }

  _timer(ms, fn) {
    const h = setTimeout(() => { this.timers.delete(h); if (!this.disposed) fn(); }, Math.max(0, ms));
    this.timers.add(h);
    return h;
  }

  _countTo(node, from, to, ms, fmt = fmtInt) {
    if (!node) return;
    if (node._raf) cancelAnimationFrame(node._raf);
    const t0 = performance.now();
    const dur = this.reduced ? Math.min(ms, 250) : ms;
    const step = (now) => {
      const u = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - u, 3);
      node.textContent = fmt(Math.round(from + (to - from) * e));
      if (u < 1) node._raf = requestAnimationFrame(step); else node._raf = 0;
    };
    node._raf = requestAnimationFrame(step);
  }

  _cancelShot() {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    if (this.arcadeEv) { // a grade that never got its reveal: at least settle the numbers
      const ev = this.arcadeEv; this.arcadeEv = null;
      if (ev.state) { this.holdHud = false; this.onState(ev.state); }
    }
    this.holdHud = false;
    this.holdChal = false;
    this.called = null;
    this.bannerEl.className = 'arc-banner hidden';
    this.subEl.className = 'arc-sub hidden';
    this.reasonsEl.className = 'arc-reasons hidden'; this.reasonsEl.innerHTML = '';
    this.flashEl.classList.add('hidden');
    this.root.classList.remove('arc-flashing');
    this.levelEl.classList.add('hidden');
    this.chestEl.className = 'arc-chest hidden'; this.chestEl.innerHTML = '';
    this.root.classList.remove('arc-flying', 'arc-revealing');
    this._slowmo(false);
    this.revealing = false;
    this.stopped = true;
    if (this.root.isConnected) this._renderChallenges({ animate: false });   // a reveal cut short: at least show where they stand
  }

  dispose() {
    this.disposed = true;
    this._cancelShot();
    for (const h of this.hudTimers) clearTimeout(h);
    this.hudTimers.clear();
    window.removeEventListener('keydown', this._onKey, true);
    if (this._ballWatch) clearInterval(this._ballWatch);
    if (this._dropWatch) clearInterval(this._dropWatch);   // v2:playability
    this._crowd(0, 0.2);
    this.hud.classList.remove('arc-fog');
    if (typeof document !== 'undefined') document.body.classList.remove('arc-quake', 'arc-thud');
    this.cineEl.remove();
    this.root.remove();
  }
}

export default ArcadeUI;
