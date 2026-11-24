#!/usr/bin/env node
// Rewrites the generated parts of the site from the game's own data, so the stage gallery
// and the ball lists never drift from what ships:
//
//   node site/dev/refresh.mjs                    # reads <repo>/data, else <repo>/build/arcade-data
//   node site/dev/refresh.mjs --data D:\some\dir # a data dir built by tools/arcade-holes/build.mjs
//
// Sources: <data>/arcade-tour.json (stages, par, yards, blurb, wind, free ball) and each
// stage's course file (the three routes); lib/arcade.js POWERUPS (balls and tricks);
// public/arcade/match.js THEMES (the theme colours); lib/launch-monitors.json (the Connect
// page's launch-monitor tiers: gen:lm-tiers). Everything between
// <!-- gen:NAME --> and <!-- /gen:NAME --> in the pages is replaced; nothing else is touched.
// This script is a development tool: the Pages workflow does not publish site/dev.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const repo = path.join(site, '..');
const require = createRequire(import.meta.url);

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const dataDir = [arg('--data'), path.join(repo, 'data'), path.join(repo, 'build', 'arcade-data')]
  .filter(Boolean).map((d) => path.resolve(d)).find((d) => fs.existsSync(path.join(d, 'arcade-tour.json')));
if (!dataDir) { console.error('No arcade-tour.json found. Build the stages first: node tools/arcade-holes/build.mjs'); process.exit(1); }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tour = JSON.parse(fs.readFileSync(path.join(dataDir, 'arcade-tour.json'), 'utf8'));
const { POWERUPS } = require(path.join(repo, 'lib', 'arcade.js'));

// the theme colours, read from the match UI's own table
const matchJs = fs.readFileSync(path.join(repo, 'public', 'arcade', 'match.js'), 'utf8');
const THEMES = {};
for (const m of matchJs.matchAll(/^\s+(\w+): \{ a: '(#[0-9a-f]{6})', b: '(#[0-9a-f]{6})', glow: '(#[0-9a-f]{6})' \},$/gim)) THEMES[m[1]] = { a: m[2], b: m[3] };
const themeOf = (t) => THEMES[t] || THEMES.current || { a: '#5ad17a', b: '#1c5f46' };

const routesOf = (stage) => {
  try {
    const course = JSON.parse(fs.readFileSync(path.join(dataDir, 'courses', stage.file), 'utf8'));
    return (course.holes?.[0]?.routes || []).filter((r) => r && r.id && r.name);
  } catch { return []; }
};

// what each screenshot shows (site/assets/stages/<id>.webp)
const ALT = {
  'lagoon-island': 'Lagoon Island from the air: a tee on a headland, a turquoise lagoon with a rock tower standing in it, and the island green beyond.',
  'canyon-run': 'Canyon Run: striped orange canyon walls, a gorge with water at the bottom and a fairway along the rim.',
  'lighthouse-point': 'Lighthouse Point: a fairway on top of sea cliffs curving round a blue cove, with a lighthouse on the far headland.',
  'volcano-drop': 'Volcano Drop from the tee: a dark crater with glowing lava falls and a green on an island in the lava.',
  'frostbite-ridge': 'Frostbite Ridge: a snow slope with pine trees and a chequered start gate above a frozen lake.',
  'sakura-garden': 'Sakura Garden: pink blossom trees, red torii gates and a green under a cliff with waterfalls.',
  'temple-run': 'Temple Run: a jungle fairway crossing a river toward a stone temple on a hill.',
  'pharaohs-gate': "Pharaoh's Gate from the tee: a desert fairway, a blue pool and pyramids behind the green.",
  'midnight-mile': 'Midnight Mile from the rooftop tee: a neon-edged tee, a fairway and a city of lit towers under a purple sky.',
  'sky-fortress': 'Sky Fortress: a green ringed by castle towers on top of a red rock butte.',
  'dragons-spine': "Dragon's Spine: a field of glowing lava between dark rock ridges, volcanoes on the horizon.",
  'summit-express': 'Summit Express from the tee: two rockets flank the tee below a snow mountain studded with ice crystals.',
  'bullseye-bay': 'Bullseye Bay: a round target green painted in rings, on an island in a bay full of boats.',
  'thunder-dome': 'Thunder Dome from the tee: a floodlit stadium full of spectators around a target green.',
  'ice-pick': 'Ice Pick from the tee: a ringed target on a frozen tarn far below, among pines and ice crystals.',
};

const pips = (n) => `<span class="pips" role="img" aria-label="Difficulty ${n} of 3">${[1, 2, 3].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;

function stageCard(s, { arena = false } = {}) {
  const th = themeOf(s.theme);
  const img = fs.existsSync(path.join(site, 'assets', 'stages', `${s.id}.webp`));
  const routes = arena ? [] : routesOf(s);
  const wind = s.wind && Number.isFinite(s.wind.min) ? `<li class="chip">Wind ${s.wind.min}–${s.wind.max} mph</li>` : '';
  return `      <article class="stage" style="--a:${th.a};--b:${th.b}">
        <div class="stage-img">${img ? `<img src="assets/stages/${s.id}.webp" width="800" height="450" loading="lazy" decoding="async" alt="${esc(ALT[s.id] || `${s.name}: a ${s.theme} stage.`)}">` : ''}
          ${arena ? '' : `<span class="stage-no" aria-hidden="true">${String(s.order).padStart(2, '0')}</span>`}${s.freeBall ? `<span class="stage-tag">Free ${esc(s.freeBall)} ball</span>` : ''}${arena ? '<span class="stage-tag" style="background:#10141c">Sudden death</span>' : ''}
        </div>
        <div class="stage-body">
          <h3>${esc(s.name)}</h3>
          <ul class="chips"><li class="chip par">Par ${s.par}</li><li class="chip yd">${s.lengthYd} yd</li>${wind}${!arena && s.difficulty ? `<li class="chip">${pips(s.difficulty)}</li>` : ''}</ul>
          <p>${esc(s.blurb)}</p>${routes.length ? `
          <ul class="routes" aria-label="Routes">${routes.map((r) => `<li class="r-${esc(r.id)}"><b>${esc(r.id)}</b> ${esc(r.name)}</li>`).join('')}</ul>` : ''}
        </div>
      </article>`;
}

const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
const ballItem = (p) => `      <li class="ball${p.kind === 'trick' ? ' trick' : ''}" style="--c:${hex(p.color)}">
        <span class="em" aria-hidden="true"><span>${p.emoji}</span></span>
        <h3>${esc(p.name)} <span class="rar ${esc(p.rarity)}">${esc(p.rarity)}</span></h3>
        <p>${esc(p.tagline)}</p>
      </li>`;

const balls = POWERUPS.filter((p) => p.kind !== 'trick');
const tricks = POWERUPS.filter((p) => p.kind === 'trick');
const rocketHoles = tour.stages.filter((s) => s.freeBall);

// The launch monitors, tier by tier, from the catalogue the game's own connection wizard
// reads (lib/launch-monitors.json): the Connect page says what the catalogue says, no more.
const LM = require(path.join(repo, 'lib', 'launch-monitors.js')).CATALOGUE;
const lmBrand = (id) => (LM.brands.find((b) => b.id === id) || { name: id }).name;
const lmName = (d) => (String(d.name).toLowerCase().startsWith(String(lmBrand(d.brand)).toLowerCase()) ? d.name : `${lmBrand(d.brand)} ${d.name}`);
const lmLink = (c) => (/^https:\/\//.test(c.url) ? `<a href="${esc(c.url)}" rel="noopener">${esc(c.name)}</a>` : esc(c.name));
function lmTier(t) {
  const list = LM.devices.filter((d) => d.tier === t.id);
  const head = `      <h3 id="tier-${esc(t.id)}">${esc(t.name)} <span class="tier-n">(${list.length})</span></h3>
      <p>${esc(t.blurb)}</p>`;
  if (!list.length) return `${head}\n      <p>None yet.</p>`;
  if (t.id === 'unsupported') {
    return `${head}
      <div class="tbl"><table>
        <thead><tr><th>Launch monitor</th><th>Why not</th></tr></thead>
        <tbody>
${list.map((d) => `          <tr><td>${esc(lmName(d))}</td><td class="wrapok">${esc(d.why)}</td></tr>`).join('\n')}
        </tbody>
      </table></div>`;
  }
  return `${head}
      <div class="tbl"><table>
        <thead><tr><th>Launch monitor</th><th>Models</th><th>Comes in through</th><th>Licence of that connector</th></tr></thead>
        <tbody>
${list.map((d) => `          <tr><td>${esc(lmName(d))}</td><td class="wrapok">${esc(d.models.join(', '))}</td><td class="wrapok">${d.route === 'foresight-bridge' ? `the <a href="#foresight">built-in Foresight bridge</a> and ${esc(d.connector.name)}` : lmLink(d.connector)}</td><td class="wrapok">${esc(d.connector.license)}</td></tr>`).join('\n')}
        </tbody>
      </table></div>`;
}
const lmCount = (id) => LM.devices.filter((d) => d.tier === id).length;

const parts = {
  'lm-tiers': '\n' + LM.tiers.map(lmTier).join('\n\n') + '\n      ',
  'lm-updated': esc(LM.updated),
  'lm-n-tested': String(lmCount('tested')),
  'lm-n-total': String(LM.devices.length),
  stages:'\n' + tour.stages.map((s) => stageCard(s)).join('\n') + '\n    ',
  arenas: '\n' + tour.tiebreaks.map((s) => stageCard(s, { arena: true })).join('\n') + '\n    ',
  balls: '\n' + balls.map(ballItem).join('\n') + '\n    ',
  tricks: '\n' + tricks.map(ballItem).join('\n') + '\n    ',
  'n-stages': String(tour.stages.length),
  'n-arenas': String(tour.tiebreaks.length),
  'n-balls': String(balls.length),
  'n-tricks': String(tricks.length),
  'n-rocket': String(rocketHoles.length),
};

let changed = 0;
for (const file of fs.readdirSync(site).filter((f) => f.endsWith('.html'))) {
  const full = path.join(site, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(/(<!-- gen:([\w-]+) -->)[\s\S]*?(<!-- \/gen:\2 -->)/g, (all, open, name, close) => (name in parts ? open + parts[name] + close : all));
  if (after !== before) { fs.writeFileSync(full, after); changed++; console.log('updated', file); }
}
console.log(`${tour.stages.length} stages (${rocketHoles.length} rocket holes), ${tour.tiebreaks.length} arenas, ${balls.length} balls, ${tricks.length} tricks from ${dataDir}; ${changed} page(s) changed.`);
