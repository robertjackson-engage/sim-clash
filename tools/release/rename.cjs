#!/usr/bin/env node
'use strict';
// Rename the product.   docs/dev/rename.md is the guide; this does the mechanical part.
//
//   node tools/release/rename.cjs "New Name"            show what would change (nothing is written)
//   node tools/release/rename.cjs "New Name" --write    do it
//        [--slug new-name] [--app-id io.github.owner.new-name] [--tour "New Tour"]
//
// 1. public/product.json: name, wordmark, initials, slug, userDataDir, installerName (and
//    appId with --app-id). Everything that READS the name follows by itself: the window,
//    the installer, the shortcuts, the page (GET /product.js), the icon build's colours.
// 2. Text that cannot read a file: every spelling of the old name in the files listed in
//    TEXT_FILES below is replaced (README, docs, the site, comments, the changelog's top
//    section). Spellings handled: "Sim Clash", "SIM CLASH", "sim-clash", "Sim-Clash", and
//    the tour name ("Clash Tour") with --tour. The joined spellings (simclash, SIMCLASH) are
//    internal identifiers and stay.
// 3. Prints what a person still has to do (the icon art, the site's images, the repository).
//
// It never touches: the npm package name and BIRDIE_* names (upstream's, on purpose),
// node_modules, data/, dist/, .scratch/, binary files, or Open-Birdie's own docs.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repo = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const newName = args[0] && !args[0].startsWith('--') ? args[0].trim() : null;
const write = args.includes('--write');
if (!newName || !/^[A-Za-z0-9][A-Za-z0-9 .'-]{1,39}$/.test(newName)) {
  console.error('Usage: node tools/release/rename.cjs "New Name" [--write] [--slug s] [--app-id id] [--tour "Tour Name"]');
  process.exit(1);
}

const productFile = path.join(repo, 'public', 'product.json');
const product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
const oldName = product.name;
const words = (s) => s.trim().split(/\s+/);
const forms = (name, slugOverride) => {
  const w = words(name);
  const slug = slugOverride || w.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return {
    title: name,                                   // Sim Clash
    upper: name.toUpperCase(),                     // SIM CLASH
    slug,                                          // sim-clash
    dashed: w.join('-').replace(/[^A-Za-z0-9-]/g, ''),   // Sim-Clash
    joined: slug.replace(/-/g, ''),                // simclash
    joinedUpper: slug.replace(/-/g, '').toUpperCase(),   // SIMCLASH
    pascal: w.map((x) => x[0].toUpperCase() + x.slice(1)).join('').replace(/[^A-Za-z0-9]/g, ''),   // SimClash
  };
};
const from = forms(oldName, product.slug);
const to = forms(newName, flag('--slug'));
if (from.title === to.title) { console.error(`The product is already called "${oldName}".`); process.exit(1); }

// ---- 1. product.json
const next = {
  ...product,
  name: newName,
  wordmark: words(newName).length > 1 ? [words(newName)[0].toUpperCase(), words(newName).slice(1).join(' ').toUpperCase()] : [newName.toUpperCase()],
  initials: words(newName).map((x) => x[0]).join('').toUpperCase().slice(0, 3),
  slug: to.slug,
  userDataDir: newName,
  installerName: `${to.dashed}-Setup`,
  appId: flag('--app-id') || product.appId.split(from.joined).join(to.joined),
  repo: { ...product.repo, name: product.repo && product.repo.name === from.slug ? to.slug : (product.repo || {}).name },
};

// ---- 2. text files
const SKIP_DIR = /^(node_modules|dist|data|\.scratch|\.git|build\/arcade-data|build\/course-art|docs\/research|docs\/superpowers|docs\/fixtures|\.claude)\//;
const SKIP_FILE = /^(package-lock\.json|docs\/(HANDOFF|TODO|machines|visual-benchmark|visual-upgrade-plan|hole-flow-roundend-plan|supabase-course-data-plan|surface-override-sidecar|rules-of-play)\.md|public\/product\.json|tools\/release\/rename\.cjs)$/;
const TEXT = /\.(md|js|cjs|mjs|json|html|css|bat|yml|yaml|txt|svg|example)$/i;
const tracked = execSync('git ls-files --cached --others --exclude-standard', { cwd: repo, maxBuffer: 1 << 26 }).toString().split(/\r?\n/).filter(Boolean);
const TEXT_FILES = tracked.filter((f) => TEXT.test(f) && !SKIP_DIR.test(`${f}`) && !SKIP_FILE.test(f));

// The joined spellings (simclash, SIMCLASH, SimClash) are internal identifiers (the product
// mode's value, window.SIMCLASH_SITE): they are not what a player reads and are left alone.
const pairs = [[from.title, to.title], [from.upper, to.upper], [from.dashed, to.dashed], [from.slug, to.slug]];
const tour = flag('--tour');
if (tour) pairs.push(['Clash Tour', tour], ['CLASH TOUR', tour.toUpperCase()]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let total = 0;
const touched = [];
for (const f of TEXT_FILES) {
  const file = path.join(repo, f);
  let text;
  try { if (fs.statSync(file).size > 2e6) continue; text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
  let out = text, n = 0;
  for (const [a, b] of pairs) {
    if (!a || a === b) continue;
    out = out.replace(new RegExp(esc(a), 'g'), () => { n++; return b; });
  }
  if (n) { total += n; touched.push([f, n]); if (write) fs.writeFileSync(file, out); }
}
if (write) fs.writeFileSync(productFile, `${JSON.stringify(next, null, 2)}\n`);
// the source launcher is named for the product ("Sim Clash.bat"): the file follows the name
const launcher = [path.join(repo, `${oldName}.bat`), path.join(repo, `${newName}.bat`)];
const hasLauncher = fs.existsSync(launcher[0]);
if (write && hasLauncher) fs.renameSync(launcher[0], launcher[1]);

console.log(`${write ? 'Renamed' : 'Would rename'} "${oldName}" to "${newName}"  (slug ${to.slug}, app id ${next.appId})`);
console.log(`public/product.json  ${write ? 'updated' : 'would be updated'}`);
if (hasLauncher) console.log(`${oldName}.bat  ${write ? 'renamed to' : 'would be renamed to'} ${newName}.bat`);
for (const [f, n] of touched) console.log(`  ${String(n).padStart(4)}  ${f}`);
console.log(`${total} replacement(s) in ${touched.length} file(s).${write ? '' : '  Nothing was written: add --write.'}`);
const left = TEXT_FILES.filter((f) => { try { return /clash/i.test(fs.readFileSync(path.join(repo, f), 'utf8').replace(new RegExp(esc(to.title), 'gi'), '')); } catch (_) { return false; } });
if (write && left.length) console.log(`\nStill mention "clash" (check by hand; "Clash Tour" needs --tour): ${left.slice(0, 30).join(', ')}`);
console.log(`
By hand (docs/dev/rename.md has the detail):
  - the icon art: tools/release/make-icon.cjs draws it; run npm run make-icon:product
  - the site's images: site/assets/icon.svg, icon-180.png, og.jpg (any that show the name)
  - screenshots that show the name: docs/media/ (re-capture with tools/release/screenshots.mjs)
  - the announcer: no shipped line says the product's name (check tools/arcade-voice/lines.mjs if you add one)
  - the GitHub repository name, the Pages address, and site/config.js
  - an installed copy under the old name keeps its own data folder: the new name starts fresh
  - run npm test, then npm run dist`);
