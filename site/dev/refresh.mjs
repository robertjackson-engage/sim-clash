#!/usr/bin/env node
// Rewrites the generated parts of the site from the game's own data, so the stage gallery,
// the ball lists, the launch-monitor pages and the release notes never drift from what ships:
//
//   node site/dev/refresh.mjs                    # reads <repo>/data, else <repo>/build/arcade-data
//   node site/dev/refresh.mjs --data D:\some\dir # a data dir built by tools/arcade-holes/build.mjs
//
// Sources:
//   <data>/arcade-tour.json and each stage's course file   stages, par, yards, blurb, wind, free
//                                                          ball, the three routes with their notes
//   lib/arcade.js POWERUPS                                 balls and tricks
//   public/arcade/match.js THEMES                          the theme colours of a stage card
//   lib/launch-monitors.json (through lib/launch-monitors.js)   the tiers, and every launch
//                                                          monitor's own steps on the Connect page
//   each stage's course file, again                        how many course gadgets there are (n-gadgets)
//   tools/arcade-holes/holes/*.js, lib.js                  the hole files, themes and prop kinds
//                                                          named on the Make it yours page
//   CHANGELOG.md                                           the release notes on the What's new page
//                                                          (when it has an entry for config.release)
//   site/config.js                                         domain (else owner, repo), release: the absolute
//                                                          addresses in each <head>, sitemap.xml;
//                                                          downloadUrl: the href of every Download button
//
// Everything between <!-- gen:NAME --> and <!-- /gen:NAME --> in the pages is replaced; nothing
// else is touched. The header, the footer and the link-preview tags are parts too, so the
// navigation is written once (PAGES below), not once a page.
// This script is a development tool: the Pages workflow does not publish site/dev.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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

// ---------- config.js (the browser's settings file, read here too) ----------
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'config.js'), 'utf8'), sandbox);
const cfg = sandbox.window.SIMCLASH_SITE || {};
const SITE_DOMAIN = String(cfg.domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const SITE_URL = SITE_DOMAIN ? `https://${SITE_DOMAIN}/` : `https://${cfg.owner}.github.io/${cfg.repo}/`;
// Every Download button is a real link (it works with scripts off): the installer itself when
// config.downloadUrl is set, else the Install page. Written into every page below.
const DOWNLOAD_HREF = cfg.downloadUrl || 'install.html';

// ---------- the pages: one list for the header, the footer and the sitemap ----------
const PAGES = [
  { file: 'index.html', nav: 'Home', foot: null },
  { file: 'whats-new.html', nav: "What's new", foot: "What's new", cls: 'new' },
  { file: 'install.html', nav: 'Install', foot: 'Install' },
  { file: 'connect.html', nav: 'Connect', foot: 'Connect your launch monitor' },
  { file: 'play.html', nav: 'How to play', foot: 'How to play' },
  { file: 'make-it-yours.html', nav: 'Make it yours', foot: 'Make it yours: build with AI' },
  { file: 'faq.html', nav: 'FAQ', foot: 'FAQ and troubleshooting' },
  { file: 'contribute.html', nav: 'Contribute', foot: 'Contribute' },
];

const header = (file) => `
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="index.html"><img src="assets/icon.svg" alt="" width="36" height="36"><b><span class="p1">Sim</span> <span class="p2">Clash</span></b></a>
    <nav class="nav" aria-label="Site">
${PAGES.map((p) => `      <a href="${p.file}"${p.file === file ? ' aria-current="page"' : ''}${p.cls ? ` class="${p.cls}"` : ''}>${esc(p.nav)}</a>`).join('\n')}
    </nav>
    <a class="btn btn-go btn-sm" data-gh="download" href="${esc(DOWNLOAD_HREF)}"><span>Download</span></a>
  </div>
</header>
`;

const footer = () => `
<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <h2>Sim Clash</h2>
      <p>A quick, video-game-style golf match for your launch monitor. A hobby project, free and open source under the MIT licence.</p>
      <p>Built on Open-Birdie: the original by Rooj Rin (<a href="https://github.com/rroojrooj/Open-Birdie" rel="noopener">rroojrooj/Open-Birdie</a>) and the fork by jordan-shilts (<a href="https://github.com/jordan-shilts/Open-Birdie" rel="noopener">jordan-shilts/Open-Birdie</a>) that Sim Clash is built on.</p>
    </div>
    <nav aria-label="Pages">
      <h2>Site</h2>
      <ul>
${PAGES.filter((p) => p.foot).map((p) => `        <li><a href="${p.file}">${esc(p.foot)}</a></li>`).join('\n')}
      </ul>
    </nav>
    <nav aria-label="Project">
      <h2>Project</h2>
      <ul>
        <li><a data-gh="repo" href="contribute.html">GitHub repository</a></li>
        <li><a data-gh="releases" href="install.html">Releases</a></li>
        <li><a data-gh="issues" href="contribute.html">Issues</a></li>
        <li><a data-gh="license" href="contribute.html#credits">MIT licence</a></li>
        <li><a data-gh="disclaimer" href="contribute.html#credits">Disclaimer</a></li>
      </ul>
    </nav>
    <p class="fine">Sim Clash is an independent open-source project. It is not affiliated with, endorsed by or sponsored by GSPro, Foresight Sports, Uneekor or any other company named on this site; their names are used only to say what the game works with, and all trademarks belong to their owners. The software is provided as is, with no warranty. Hitting golf balls indoors can hurt people and break things: swing at your own risk.</p>
  </div>
</footer>
<script src="config.js"></script>
<script src="site.js"></script>
`;

// what a link preview and a search engine need as plain HTML, with absolute addresses
const meta = (file) => `
<link rel="canonical" href="${SITE_URL}${file === 'index.html' ? '' : file}">
<meta property="og:site_name" content="Sim Clash">
<meta property="og:url" content="${SITE_URL}${file === 'index.html' ? '' : file}">
<meta property="og:image" content="${SITE_URL}assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Sim Clash: a floodlit stadium full of spectators round a target green, seen from the tee.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE_URL}assets/og.jpg">
`;

// ---------- stages ----------
const tour = JSON.parse(fs.readFileSync(path.join(dataDir, 'arcade-tour.json'), 'utf8'));
const { POWERUPS } = require(path.join(repo, 'lib', 'arcade.js'));

// the theme colours, read from the match UI's own table
const matchJs = fs.readFileSync(path.join(repo, 'public', 'arcade', 'match.js'), 'utf8');
const THEMES = {};
for (const m of matchJs.matchAll(/^\s+(\w+): \{ a: '(#[0-9a-f]{6})', b: '(#[0-9a-f]{6})', glow: '(#[0-9a-f]{6})' \},$/gim)) THEMES[m[1]] = { a: m[2], b: m[3] };
const themeOf = (t) => THEMES[t] || THEMES.current || { a: '#5ad17a', b: '#1c5f46' };

const courseOf = (stage) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'courses', stage.file), 'utf8')); } catch { return null; } };
const routesOf = (stage) => ((courseOf(stage) || {}).holes?.[0]?.routes || []).filter((r) => r && r.id && r.name);

// what each screenshot shows (site/assets/stages/<id>-640.webp and -960.webp, captured from
// the game: see site/README.md "Pictures"). Change the words when the picture changes.
const ALT = JSON.parse(fs.readFileSync(path.join(here, 'stage-alt.json'), 'utf8'));

const pips = (n) => `<span class="pips" role="img" aria-label="Difficulty ${n} of 3">${[1, 2, 3].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;
const stageImg = (id) => ["640", "960"].every((w) => fs.existsSync(path.join(site, 'assets', 'stages', `${id}-${w}.webp`)));

function stageCard(s, { arena = false } = {}) {
  const th = themeOf(s.theme);
  const routes = arena ? [] : routesOf(s);
  const wind = s.wind && Number.isFinite(s.wind.min) ? `<li class="chip">Wind ${s.wind.min}–${s.wind.max} mph</li>` : '';
  const img = stageImg(s.id)
    ? `<img src="assets/stages/${s.id}-640.webp" srcset="assets/stages/${s.id}-640.webp 640w, assets/stages/${s.id}-960.webp 960w" sizes="(max-width: 640px) 94vw, (max-width: 1020px) 47vw, 400px" width="960" height="540" loading="lazy" decoding="async" alt="${esc(ALT[s.id] || `${s.name}: a ${s.theme} stage.`)}">`
    : '';
  const routeList = routes.length ? `
          <ul class="routes" id="routes-${s.id}" aria-label="The three routes on ${esc(s.name)}">${routes.map((r) => `<li class="r-${esc(r.id)}"><b>${esc(r.id)}</b><span>${esc(r.name)}</span>${r.note ? `<small>${esc(r.note)}</small>` : ''}</li>`).join('')}</ul>
          <button type="button" class="routes-btn" aria-expanded="false" aria-controls="routes-${s.id}">3 routes</button>` : '';
  return `      <article class="stage rise" id="stage-${s.id}" style="--a:${th.a};--b:${th.b}">
        <div class="stage-img">${img}
          ${arena ? '' : `<span class="stage-no" aria-hidden="true">${String(s.order).padStart(2, '0')}</span>`}${s.freeBall ? `<span class="stage-tag">Free ${esc(s.freeBall)} ball</span>` : ''}${arena ? '<span class="stage-tag sd">Sudden death</span>' : ''}${routeList}
        </div>
        <div class="stage-body">
          <h3>${esc(s.name)}</h3>
          <ul class="chips"><li class="chip par">Par ${s.par}</li><li class="chip yd">${s.lengthYd} yd</li>${wind}${!arena && s.difficulty ? `<li class="chip">${pips(s.difficulty)}</li>` : ''}</ul>
          <p>${esc(s.blurb)}</p>
        </div>
      </article>`;
}

// ---------- balls and tricks ----------
const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');
const ballItem = (p) => `      <li class="ball${p.kind === 'trick' ? ' trick' : ''}" style="--c:${hex(p.color)}">
        <span class="em" aria-hidden="true"><span>${p.emoji}</span></span>
        <h3>${esc(p.name)} <span class="rar ${esc(p.rarity)}">${esc(p.rarity)}</span></h3>
        <p>${esc(p.tagline)}</p>
      </li>`;
const balls = POWERUPS.filter((p) => p.kind !== 'trick');
const tricks = POWERUPS.filter((p) => p.kind === 'trick');
const rocketHoles = tour.stages.filter((s) => s.freeBall);

// ---------- launch monitors ----------
// The catalogue the game's own connection wizard reads (lib/launch-monitors.json): the site
// says what the catalogue says, no more.
const LM = require(path.join(repo, 'lib', 'launch-monitors.js')).CATALOGUE;
const lmBrand = (id) => (LM.brands.find((b) => b.id === id) || { name: id }).name;
const lmName = (d) => (String(d.name).toLowerCase().startsWith(String(lmBrand(d.brand)).toLowerCase()) ? d.name : `${lmBrand(d.brand)} ${d.name}`);
const lmLink = (c) => (/^https:\/\//.test(c.url) ? `<a href="${esc(c.url)}" rel="noopener">${esc(c.name)}</a>` : esc(c.name));
const lmCount = (id) => LM.devices.filter((d) => d.tier === id).length;
const tierOf = (id) => LM.tiers.find((t) => t.id === id) || { name: id };
// the wizard fills {address} with this PC's real address; a web page cannot know it
const lmFill = (text, d) => esc(String(text)
  .replace(/\{address\}/g, d && d.address === 'lan' ? "this PC's network address (for example 192.168.1.20)" : '127.0.0.1')
  .replace(/\{port\}/g, String(LM.port)));

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
        <thead><tr><th>Launch monitor</th><th>Models</th><th>Comes in through</th><th>Its steps</th></tr></thead>
        <tbody>
${list.map((d) => `          <tr><td>${esc(lmName(d))}</td><td class="wrapok">${esc(d.models.join(', '))}</td><td class="wrapok">${d.route === 'foresight-bridge' ? `the <a href="#foresight">built-in Foresight bridge</a> and ${esc(d.connector.name)}` : lmLink(d.connector)}</td><td><a href="#lm-${esc(d.id)}">Steps</a></td></tr>`).join('\n')}
        </tbody>
      </table></div>`;
}

// one launch monitor's own entry: what the wizard shows, as a fold-out
function lmDevice(d) {
  const t = tierOf(d.tier);
  const keys = [lmName(d), ...d.models, lmBrand(d.brand), d.connector ? d.connector.name : '', t.name].join(' ').toLowerCase();
  const li = (items, f = (x) => lmFill(x, d)) => items.map((x) => `<li>${f(x)}</li>`).join('');
  const parts = [];
  if (d.tier === 'unsupported') {
    parts.push(`<p>${esc(d.why)}</p>`, '<p>You can still play: <a href="#no-monitor">test swings</a> need no launch monitor.</p>');
  } else {
    if (d.connector) parts.push(`<dl><dt>Comes in through</dt><dd>${d.route === 'foresight-bridge' ? `the <a href="#foresight">Foresight bridge built into the game</a> and ${esc(d.connector.name)}` : lmLink(d.connector)}</dd><dt>That connector's licence</dt><dd>${esc(d.connector.license)}</dd></dl>`);
    if (d.needs && d.needs.length) parts.push(`<h4>You need</h4><ul>${li(d.needs)}</ul>`);
    if (d.steps && d.steps.length) parts.push(`<h4>Steps</h4><ol class="steps slim">${d.steps.map((x) => `<li><p>${lmFill(x, d)}</p></li>`).join('')}</ol>`);
    if (d.settings && d.settings.length) parts.push(`<h4>What to type into it</h4><dl>${d.settings.map((x) => `<dt><code>${esc(x.label)}</code></dt><dd>${lmFill(x.value, d)}</dd>`).join('')}</dl>`);
    if (d.notes && d.notes.length) parts.push(`<h4>Good to know</h4><ul>${li(d.notes)}</ul>`);
    if (d.alternatives && d.alternatives.length) parts.push(`<h4>Other connectors</h4><ul>${d.alternatives.map((a) => `<li>${lmLink(a)} (${esc(a.license)}). ${esc(a.note || '')}</li>`).join('')}</ul>`);
  }
  if (d.sources && d.sources.length) {
    parts.push(`<h4>Where this comes from</h4><ul>${d.sources.map((s) => `<li>${/^https:\/\//.test(s.url) ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.url.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a>` : `<code>${esc(s.url)}</code>`}: ${esc(s.note)}${s.confirmed ? '' : ' (a report, not confirmed)'}</li>`).join('')}</ul>`);
  }
  return `      <details class="lm" id="lm-${esc(d.id)}" data-k="${esc(keys)}">
        <summary>${esc(lmName(d))} <span class="badge t-${esc(d.tier)}">${esc(t.name)}</span><small>${esc(d.models.join(', '))}</small></summary>
        <div>
          ${parts.join('\n          ')}
        </div>
      </details>`;
}

// the home page's four tier cards
const lmSummary = () => LM.tiers.map((t) => {
  const list = LM.devices.filter((d) => d.tier === t.id);
  return `      <div class="tier t-${esc(t.id)}">
        <h3>${esc(t.name)} <span>${list.length}</span></h3>
        <p>${esc(t.blurb)}</p>
        <ul>${list.map((d) => `<li>${esc(lmName(d))}</li>`).join('')}</ul>
      </div>`;
}).join('\n');

const lmGeneric = () => `
      <ol class="steps">
${LM.generic.steps.map((x) => `        <li><p>${lmFill(x)}</p></li>`).join('\n')}
      </ol>
      <dl class="lm-set">${LM.generic.settings.map((x) => `<dt>${esc(x.label)}</dt><dd><code>${lmFill(x.value)}</code></dd>`).join('')}</dl>
      <ul>
${LM.generic.notes.map((x) => `        <li>${lmFill(x)}</li>`).join('\n')}
      </ul>
      `;

// ---------- the hole files, for the Make it yours page ----------
const HL = require(path.join(repo, 'tools', 'arcade-holes', 'lib.js'));
const stageByFileId = new Map([...tour.stages, ...tour.tiebreaks].map((s) => [s.id, s]));
const holeFiles = fs.readdirSync(path.join(repo, 'tools', 'arcade-holes', 'holes')).filter((f) => f.endsWith('.js')).sort();
const holeList = () => holeFiles.map((f) => {
  const s = stageByFileId.get(f.replace(/\.js$/, ''));
  return `<li><code>${esc(f)}</code>${s ? ` ${esc(s.name)}, par ${s.par}, ${esc(s.theme)}` : ''}</li>`;
}).join('');

// ---------- the release notes, from CHANGELOG.md when it has them ----------
function md(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function changelog(version) {
  let text = '';
  try { text = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'); } catch { return null; }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const out = [];
  let para = [], item = null, open = false;
  const flushPara = () => { if (para.length) { out.push(`      <p>${md(para.join(' '))}</p>`); para = []; } };
  const flushItem = () => { if (item) { out.push(`        <li>${md(item.join(' '))}</li>`); item = null; } };
  const closeList = () => { flushItem(); if (open) { out.push('      </ul>'); open = false; } };
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l) || /^---\s*$/.test(l)) break;
    if (/^### /.test(l)) { flushPara(); closeList(); out.push(`      <h3>${md(l.slice(4))}</h3>`); continue; }
    if (/^- /.test(l)) { flushPara(); flushItem(); if (!open) { out.push('      <ul>'); open = true; } item = [l.slice(2).trim()]; continue; }
    if (!l.trim()) { flushPara(); continue; }
    if (item && /^\s+/.test(l)) item.push(l.trim()); else { closeList(); para.push(l.trim()); }
  }
  flushPara(); closeList();
  return out.length ? '\n' + out.join('\n') + '\n      ' : null;
}
const notes = changelog(cfg.release || '');

// ---------- the parts ----------
const parts = {
  header, footer, meta,
  release: () => esc(cfg.release || ''),
  'lm-tiers': '\n' + LM.tiers.map(lmTier).join('\n\n') + '\n      ',
  'lm-devices': '\n' + LM.devices.map(lmDevice).join('\n') + '\n      ',
  'lm-summary': '\n' + lmSummary() + '\n    ',
  'lm-generic': lmGeneric(),
  'lm-updated': esc(LM.updated),
  'lm-n-tested': String(lmCount('tested')),
  'lm-n-expected': String(lmCount('expected')),
  'lm-n-community': String(lmCount('community')),
  'lm-n-total': String(LM.devices.length),
  'lm-port': String(LM.port),
  stages: '\n' + tour.stages.map((s) => stageCard(s)).join('\n') + '\n    ',
  arenas: '\n' + tour.tiebreaks.map((s) => stageCard(s, { arena: true })).join('\n') + '\n    ',
  balls: '\n' + balls.map(ballItem).join('\n') + '\n    ',
  tricks: '\n' + tricks.map(ballItem).join('\n') + '\n    ',
  'n-stages': String(tour.stages.length),
  'n-arenas': String(tour.tiebreaks.length),
  'n-worlds': String(tour.stages.length + tour.tiebreaks.length),
  'n-balls': String(balls.length),
  'n-tricks': String(tricks.length),
  'n-rocket': String(rocketHoles.length),
  'n-props': String(HL.PROP_KINDS.length),
  'n-gadgets': String([...tour.stages, ...tour.tiebreaks].reduce((n, s) => n + (((courseOf(s) || {}).gadgets || []).filter((g) => g.kind !== 'warp-exit').length), 0)),
  themes: HL.THEMES.map((t) => `<code>${esc(t)}</code>`).join(', '),
  'hole-files': holeList(),
};
if (notes) parts.changelog = notes;   // no entry for this release yet: the page keeps what is written there

let changed = 0;
const htmlFiles = fs.readdirSync(site).filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const full = path.join(site, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(/(<!-- gen:([\w-]+) -->)[\s\S]*?(<!-- \/gen:\2 -->)/g, (all, open, name, close) => {
    if (!(name in parts)) return all;
    const v = parts[name];
    return open + (typeof v === 'function' ? v(file) : v) + close;
  });
  // the Download buttons written by hand in a page's body get the same address as the header's
  const linked = after.replace(/<a\s[^>]*data-gh="download"[^>]*>/g, (tag) => tag.replace(/\shref="[^"]*"/, ` href="${esc(DOWNLOAD_HREF)}"`));
  if (linked !== before) { fs.writeFileSync(full, linked); changed++; console.log('updated', file); }
}

// sitemap.xml: every page, with the site's real address
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.filter((p) => htmlFiles.includes(p.file)).map((p) => `  <url><loc>${SITE_URL}${p.file === 'index.html' ? '' : p.file}</loc></url>`).join('\n')}
</urlset>
`;
const smFile = path.join(site, 'sitemap.xml');
if (!fs.existsSync(smFile) || fs.readFileSync(smFile, 'utf8') !== sitemap) { fs.writeFileSync(smFile, sitemap); console.log('updated sitemap.xml'); }

const missing = [...tour.stages, ...tour.tiebreaks].filter((s) => !stageImg(s.id)).map((s) => s.id);
if (missing.length) console.warn(`no picture yet for: ${missing.join(', ')} (assets/stages/<id>-640.webp and -960.webp)`);
console.log(`${tour.stages.length} stages (${rocketHoles.length} rocket holes), ${tour.tiebreaks.length} arenas, ${balls.length} balls, ${tricks.length} tricks, ${LM.devices.length} launch monitors from ${dataDir}; release notes ${notes ? 'from CHANGELOG.md' : 'as written in the page (no CHANGELOG entry for ' + (cfg.release || '?') + ')'}; ${changed} page(s) changed.`);
