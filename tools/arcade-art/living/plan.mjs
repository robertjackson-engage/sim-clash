#!/usr/bin/env node
// v3:living Writes the capture plan for the living world's contact sheets (capture.mjs --plan):
// for every stage, <stage>-ambient (the address view, an establishing view, then a camera on
// each thing that lives there, wherever it has got to) and <stage>-react (every beat of the
// reaction bus, set off by hand through scene.worldEvents.react and caught a moment later).
//
//   node tools/arcade-art/living/plan.mjs --data .scratch/living/data --out .scratch/living/plan.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const dataDir = path.resolve(flag('--data') || path.join('.scratch', 'living', 'data'));
const out = path.resolve(flag('--out') || path.join('.scratch', 'living', 'plan.json'));
const tour = JSON.parse(fs.readFileSync(path.join(dataDir, 'arcade-tour.json'), 'utf8'));
const R = require('../../../public/render/world-life.js');

// how a camera looks at each kind: the model whose copy it follows, how far back, how high
const LOOK = {
  dragon: { dist: 95, up: 14, hOff: 36 }, airship: { follow: 'airship', dist: 90, up: 10 }, train: { follow: 'train', dist: 70, up: 14 }, cars: { follow: 'car', dist: 46, up: 12 },
  'cable-car': { follow: 'cable-car', dist: 36, up: 4 }, boat: { follow: 'boat', dist: 34, up: 9 }, gondola: { follow: 'gondola', dist: 22, up: 8 }, caravan: { follow: 'camel', dist: 26, up: 7 },
  groomer: { follow: 'groomer', dist: 24, up: 7 }, walkers: { follow: 'walker', dist: 18, up: 5 }, dolphins: { follow: 'dolphin', dist: 22, up: 6 }, balloon: { follow: 'balloon', dist: 70, up: 4 },
  flock: { follow: 'bird', dist: 26, up: 2 }, perch: { dist: 12, up: 4, hOff: 3 }, koi: { dist: 13, up: 9 }, fish: { dist: 26, up: 8 }, croc: { dist: 13, up: 5 }, turtle: { dist: 7, up: 3 },
  whale: { dist: 60, up: 12 }, windmill: { dist: 46, up: 10, hOff: 8 }, beam: { dist: 120, up: 30, hOff: 20 }, searchlight: { dist: 70, up: 6, hOff: 10 }, mist: { dist: 34, up: 10 },
  geyser: { dist: 46, up: 12 }, pennants: { dist: 20, up: 6, hOff: 3 }, windsock: { dist: 18, up: 3, hOff: 4 }, volcano: { dist: 420, up: 40, hOff: 60 }, fireflies: { dist: 24, up: 5 }, butterflies: { dist: 12, up: 3 },
  'traffic-light': { dist: 40, up: 6, hOff: 8 }, squall: { dist: 500, up: 40, hOff: 30 },
};
const ORDER = ['dragon', 'volcano', 'airship', 'train', 'cars', 'cable-car', 'boat', 'gondola', 'caravan', 'groomer', 'walkers', 'dolphins', 'whale', 'croc', 'koi', 'flock', 'perch', 'fish', 'turtle', 'windmill', 'beam', 'searchlight', 'geyser', 'mist', 'pennants', 'windsock', 'balloon', 'fireflies', 'butterflies', 'squall'];

const plan = [];
for (const st of [...tour.stages, ...tour.tiebreaks]) {
  const c = JSON.parse(fs.readFileSync(path.join(dataDir, 'courses', st.file), 'utf8'));
  const life = R.normalizeLife(c.life), H = c.holes[0], tee = H.tee, pin = H.pin;
  const len = Math.hypot(pin[0] - tee[0], pin[1] - tee[1]), dir = [(pin[0] - tee[0]) / len, (pin[1] - tee[1]) / len], yaw = Math.atan2(dir[0], dir[1]) * 180 / Math.PI;
  const toward = (p, dist) => { const d = Math.hypot(tee[0] - p[0], tee[1] - p[1]) || 1; return [p[0] + ((tee[0] - p[0]) / d) * dist, p[1] + ((tee[1] - p[1]) / d) * dist]; };
  const centre = (e) => (R.LIFE_KINDS[e.kind].shape === 'path' ? e.path[Math.floor(e.path.length / 2)] : R.LIFE_KINDS[e.kind].shape === 'points' ? e.at[0] : [e.x, e.y]);
  const camOn = (e, n = 0) => {
    const L = LOOK[e.kind] || { dist: 40, up: 10 };
    if (L.follow) return { follow: L.follow, index: n, dist: L.dist, up: L.up };
    const p = centre(e);
    return { at: p, from: toward(p, L.dist), up: L.up, hOff: (L.hOff || 1) + (e.kind === 'volcano' ? 0 : e.lift || 0) };
  };
  const green = { at: pin, from: [pin[0] - dir[0] * 62, pin[1] - dir[1] * 62], up: 20, hOff: 8 };
  const wide = { tx: tee[0] + dir[0] * len * 0.55, ty: tee[1] + dir[1] * len * 0.55, yaw: yaw - 38, pitch: -15, dist: Math.max(150, len * 1.05), hOff: 6 };

  // ---- ambient
  const amb = [{ name: 'address (the tee)', cam: 'tee', waitMs: 3200, pre: 'return { entries: w.stats().entries, draws: w.stats().draws, replaced: w.stats().replaced.length }' }, { name: 'the stage', cam: wide, waitMs: 1500 }];
  const seen = new Map();
  for (const kind of ORDER) {
    for (const e of life.filter((x) => x.kind === kind)) {
      const n = seen.get(kind) || 0;
      if (n >= (kind === 'flock' || kind === 'boat' ? 2 : 1) || amb.length >= 13) continue;
      seen.set(kind, n + 1);
      const model = (LOOK[kind] || {}).follow, sameModelBefore = model ? life.filter((x) => (LOOK[x.kind] || {}).follow === model).indexOf(e) : 0;
      amb.push({ name: `${kind}${e.id && !/-\d+$/.test(e.id) ? ` (${e.id})` : ''}`, cam: camOn(e, sameModelBefore), waitMs: 900, ...(kind === 'dragon' ? { frames: 2, everyMs: 2500 } : {}) });
    }
  }
  plan.push({ stage: st.id, sheet: `${st.id}-ambient`, cols: 4, shots: amb });

  // ---- reactions
  const has = (k) => life.some((e) => e.kind === k);
  const first = (k) => life.find((e) => e.kind === k);
  const at = (p) => `{ x: ${p[0].toFixed(1)}, y: ${p[1].toFixed(1)} }`;
  const beat = (type, opts) => `w.bus.reset(); w._timeline = []; const b = w.react('${type}', ${opts}); return b ? b.type : w.bus.last`;
  const rest = [tee[0] + dir[0] * len * 0.8, tee[1] + dir[1] * len * 0.8];
  const dragon = first('dragon'), airship = first('airship'), volcano = first('volcano');
  const wet = c.surfaces.filter((s) => s.kind === 'water')[0];
  const croc = first('croc'), fish = first('fish');
  const spit = life.find((e) => e.kind === 'geyser' && e.glow);
  const splashAt = croc ? [croc.x + 9, croc.y + 2] : fish ? [fish.x, fish.y] : spit ? [spit.x + 12, spit.y + 6] : wet ? wet.poly[0] : null;
  const snowman = (c.props || []).filter((p) => p.kind === 'snowman').sort((a, b) => Math.hypot(a.x - tee[0], a.y - tee[1]) - Math.hypot(b.x - tee[0], b.y - tee[1]))[0];
  const rx = [];
  rx.push({ name: 'ROCKET LAUNCH (address)', cam: 'tee', pre: beat('rocket-launch', `{ intensity: 1.5, pos: ${at(tee)}, trail: [] }`), waitMs: 120, frames: 3, everyMs: 280 });
  if (volcano) rx.push({ name: 'ROCKET LAUNCH: the volcano', cam: camOn(volcano), pre: beat('rocket-launch', `{ intensity: 1.5, pos: ${at(tee)} }`), waitMs: 1500, frames: 2, everyMs: 1500 });
  rx.push({ name: 'GREAT SHOT (epic)', cam: dragon ? camOn(dragon) : green, pre: beat('great-shot', `{ intensity: 2, text: 'PIN SEEKER!', playerSlot: 1, pos: ${at(rest)} }`), waitMs: 1000, frames: 2, everyMs: 800 });
  if (airship) rx.push({ name: 'GREAT SHOT: the airship says so', cam: { follow: 'airship', dist: 70, up: 4, swing: 55 }, pre: beat('great-shot', `{ intensity: 2, text: 'PIN SEEKER!', pos: ${at(rest)} }`), waitMs: 900 });
  if (has('searchlight')) rx.push({ name: 'GREAT SHOT: searchlights to the spot', cam: wide, pre: beat('great-shot', `{ intensity: 2, text: 'DART!', pos: ${at(rest)} }`), waitMs: 1800 });
  rx.push({ name: 'HOLED (P1)', cam: green, pre: beat('holed', `{ intensity: 2, playerSlot: 1, text: 'HOLE IN ONE!!!', pos: ${at(pin)}, screen: { title: 'ALEX', big: 'BIRDIE', sub: 'HOLED IN 2', color: '#ff5a36' } }`), waitMs: 700, frames: 3, everyMs: 900 });
  if (splashAt) rx.push({ name: has('volcano') || c.arcade.theme === 'volcano' ? 'LAVA: it burps' : croc ? 'SPLASH: the crocodile' : 'SPLASH: fish', cam: { at: splashAt, from: toward(splashAt, 20), up: 7, hOff: 1 }, pre: beat(c.arcade.theme === 'volcano' ? 'lava' : 'splash', `{ pos: ${at(splashAt)} }`), waitMs: 650, frames: 2, everyMs: 350 });
  if (snowman) rx.push({ name: 'SNOWMAN: its head comes off', cam: { at: [snowman.x, snowman.y], from: toward([snowman.x, snowman.y], 11), up: 3, hOff: 1 }, pre: beat('snowman', `{ pos: ${at([snowman.x, snowman.y])} }`), waitMs: 350, frames: 3, everyMs: 600 });
  rx.push({ name: 'DUFF', cam: 'tee', pre: beat('duff', `{ pos: ${at([tee[0] + dir[0] * 20, tee[1] + dir[1] * 20])} }`), waitMs: 1300, frames: 2, everyMs: 700 });
  if (has('perch')) { const p = first('perch').at[0]; rx.push({ name: 'BAD ONE: the bird laughs', cam: { at: p, from: toward(p, 10), up: 3, hOff: (first('perch').lift || 0) + 1 }, pre: beat('bad', `{ pos: ${at(p)} }`), waitMs: 700 }); }
  if (has('pennants')) rx.push({ name: 'HOLE WON (P2): the colours change', cam: camOn(first('pennants')), pre: beat('hole-won', '{ playerSlot: 2, intensity: 1.2 }'), waitMs: 1200 });
  rx.push({ name: 'KNOCKOUT (P1)', cam: dragon ? camOn(dragon) : green, pre: beat('knockout', '{ playerSlot: 1, intensity: 1.6 }'), waitMs: 1200 });
  rx.push({ name: 'SUDDEN DEATH: lights dip, then flare', cam: 'tee', pre: beat('sudden-death', '{ intensity: 1.5 }'), waitMs: 800, frames: 3, everyMs: 600 });
  rx.push({ name: 'MATCH OVER (P2 wins)', cam: green, pre: beat('match-over', '{ playerSlot: 2, intensity: 2 }'), waitMs: 1500, frames: 3, everyMs: 1500, post: 'w.react("lead", { playerSlot: 0 })' });
  plan.push({ stage: st.id, sheet: `${st.id}-react`, cols: 4, shots: rx });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(plan, null, 1));
console.log(`${plan.length} sheets, ${plan.reduce((n, j) => n + j.shots.reduce((m, s) => m + (s.frames || 1), 0), 0)} stills -> ${path.relative(process.cwd(), out)}`);
