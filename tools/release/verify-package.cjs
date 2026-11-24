#!/usr/bin/env node
'use strict';
// Check a packaged build against the working tree, without running it:
//
//   node tools/release/verify-package.cjs [dist/win-unpacked]
//
//   1. every file inside resources/app.asar is byte-identical to the same file in the repo
//      (a file edited WHILE electron-builder was packing shifts every later file in the
//      archive: this catches it);
//   2. everything the arcade needs at run time is in the archive (the game's scripts and
//      modes, every file of its asset folders: props and the stadium kit, the stage skies
//      and ground sets, the trees, the sounds, the voice), and dev-only weight is not;
//   3. the bundled arcade stages (resources/arcade-data) are complete and match their checksums.
//
// Exit code 0: the package is sound. 1: it is not (the reasons are printed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repo = path.join(__dirname, '..', '..');
const unpacked = path.resolve(process.argv[2] || path.join(repo, 'dist', 'win-unpacked'));
const resources = path.join(unpacked, 'resources');
const asarFile = path.join(resources, 'app.asar');
const problems = [];
const bad = (msg) => { problems.push(msg); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let asar;
try { asar = require('@electron/asar'); }
catch (_) { console.error('Needs the dev dependencies (npm install): @electron/asar comes with electron-builder.'); process.exit(1); }
if (!fs.existsSync(asarFile)) { console.error(`No ${asarFile}: run npm run pack first.`); process.exit(1); }

// ---- 1. the archive against the tree
const { header, headerSize } = asar.getRawHeader(asarFile);
const files = [];
(function walk(node, rel) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = rel ? `${rel}/${name}` : name;
    if (entry.files) walk(entry, p);
    else if (!entry.link) files.push({ path: p, unpacked: !!entry.unpacked, size: entry.size, offset: Number(entry.offset), hash: entry.integrity ? entry.integrity.hash : null });
  }
})(header, '');
let compared = 0, bytes = 0;
const fd = fs.openSync(asarFile, 'r');
const dataStart = 8 + headerSize;
for (const f of files) {
  let got;
  if (f.unpacked) got = fs.readFileSync(path.join(resources, 'app.asar.unpacked', f.path));
  else { got = Buffer.alloc(f.size); fs.readSync(fd, got, 0, f.size, dataStart + f.offset); }
  // the archive against its own header (Electron checks the same hashes when it loads a file)
  if (f.hash && sha(got) !== f.hash) { bad(`archive is inconsistent at ${f.path} (a file changed while electron-builder was packing: pack again)`); continue; }
  // electron-builder rewrites every package.json it packs (drops scripts, devDependencies, build)
  if (f.path === 'package.json' || (f.path.startsWith('node_modules/') && f.path.endsWith('/package.json'))) continue;
  const src = path.join(repo, f.path);
  let want;
  try { want = fs.readFileSync(src); } catch (_) { bad(`in the archive but not in the repo: ${f.path}`); continue; }
  compared++; bytes += got.length;
  if (got.length !== want.length || sha(got) !== sha(want)) bad(`differs from the repo (edited after packaging?): ${f.path}`);
}
fs.closeSync(fd);

// ---- 2. what must be there, what must not
const has = new Set(files.map((f) => f.path));
const under = (dir) => files.filter((f) => f.path.startsWith(`${dir}/`));
for (const need of [
  'main.js', 'server.js', 'package.json', 'public/index.html', 'public/app.js', 'public/product.json', 'lib/product.js',
  'lib/arcade.js', 'lib/match.js', 'lib/arcade-bundle.js', 'lib/voice.js', 'lib/openconnect.js', 'lib/app-shell.js', 'lib/app-log.js',
  'public/arcade/arcade.js', 'public/arcade/match.js', 'public/arcade/audio.js',
  // the game's shell and the modes of the second release: party play, Bullseye, the
  // trick-shot duel, replays and highlights (docs/modes.md), each with its server half
  'public/arcade/shell.js', 'public/arcade/shell-core.js', 'public/arcade/connect.js',
  'public/arcade/party.js', 'public/arcade/party.css', 'public/arcade/bullseye.js', 'public/arcade/bullseye.css',
  'public/arcade/duel.js', 'public/arcade/duel.css', 'public/arcade/replay.js', 'public/arcade/replay-core.js', 'public/arcade/replay.css',
  'public/arcade/highlights.js',
  'lib/solo.js', 'lib/bullseye.js', 'lib/bullseye-mode.js', 'lib/duel.js', 'lib/duel-mode.js', 'lib/highlights.js', 'lib/highlights-mode.js',
  // course gadgets (docs/gadgets.md), the living world (docs/living-world.md), the stadium
  // and its crowd, the far world and the ground materials (docs/arcade-look.md)
  'lib/gadgets.js', 'lib/playability.js', 'public/render/gadgets.js', 'public/render/gadget-core.js',
  'public/render/world-events.js', 'public/render/world-life.js', 'public/render/world-fx.js', 'public/render/world-models.js',
  'public/render/crowd.js', 'public/render/stadium-kit.js', 'public/render/stadium-fx.js',
  'public/render/far-world.js', 'public/render/env-materials.js', 'public/render/tree-models.js', 'public/render/tree-species.js',
  'public/arcade/props/manifest.json', 'public/arcade/env/manifest.json', 'public/arcade/trees/manifest.json',
  'public/arcade/sfx/manifest.json', 'public/arcade/voice/announcer/manifest.json',
  'public/assets/hdri/puresky_4k.hdr',
  'node_modules/three/build/three.module.js', 'node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'node_modules/pngjs/package.json',
]) if (!has.has(need)) bad(`missing from the archive: ${need}`);
const onDisk = (dir, rx) => fs.readdirSync(path.join(repo, dir)).filter((f) => rx.test(f));
// every arcade script and stylesheet (the HUD, the match screens, the shell, the connection
// wizard, the Foresight panel...), every model, sound and voice clip, the renderer, the server
for (const [dir, rx] of [['public/arcade', /^(?!.*demo).*\.(js|css|json)$/], ['public/arcade/props', /\.glb$/], ['public/arcade/sfx', /\.mp3$/], ['public/arcade/voice/announcer', /\.mp3$/], ['public/render', /\.js$/], ['lib', /\.js$/]]) {
  for (const f of onDisk(dir, rx)) if (!has.has(`${dir}/${f}`)) bad(`missing from the archive: ${dir}/${f}`);
}
// every asset file under the arcade's asset folders, at any depth: a model, a picture, a
// sound or a voice clip that is in the tree but not in the archive is a hole in the game
// (a new folder of clips or models is covered the day it appears, with no line added here)
const ASSET_RX = /\.(glb|gltf|bin|ktx2|webp|png|jpg|jpeg|svg|hdr|mp3|ogg|wav|m4a|json|woff2?)$/i;
const walkDisk = (dir) => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDisk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const assetCount = {};
for (const dir of ['public/arcade/props', 'public/arcade/env', 'public/arcade/trees', 'public/arcade/sfx', 'public/arcade/voice']) {
  const onDiskAll = walkDisk(dir).filter((p) => ASSET_RX.test(p));
  assetCount[dir] = onDiskAll.length;
  for (const p of onDiskAll) if (!has.has(p)) bad(`missing from the archive: ${p}`);
}
// the prop models (the stadium kit among them): every file the props manifest names is in
// the archive at the manifest's size, and the stadium kit is whole
let propNote = null;
try {
  const kinds = (JSON.parse(fs.readFileSync(path.join(repo, 'public', 'arcade', 'props', 'manifest.json'), 'utf8')).kinds) || {};
  let n = 0;
  for (const [kind, k] of Object.entries(kinds)) {
    for (const file of new Set([k.file, ...(k.variants || [])].filter(Boolean))) {
      const rel = `public/arcade/props/${file}`;
      n++;
      const entry = files.find((x) => x.path === rel);
      if (!entry) { bad(`missing from the archive: ${rel} (the props manifest's ${kind})`); continue; }
      if (file === k.file && Number.isFinite(k.bytes) && entry.size !== k.bytes) bad(`not the size the props manifest gives (${k.bytes}): ${rel} is ${entry.size}`);
    }
  }
  const STADIUM_KIT = ['stand-section', 'stand-corner', 'led-board', 'ad-board', 'barrier', 'camera-tower', 'tunnel', 'podium'];
  for (const kind of STADIUM_KIT) if (!kinds[kind] || !kinds[kind].file) bad(`the props manifest has no model for the stadium kit's ${kind}`);
  propNote = `${Object.keys(kinds).length} kinds in the props manifest (${n} model files; the stadium kit: ${STADIUM_KIT.filter((k) => kinds[k]).length} of ${STADIUM_KIT.length})`;
} catch (error) { bad(`public/arcade/props/manifest.json is missing or unreadable: ${error.message}`); }
for (const f of files) {
  if (/^(test|docs|data|site|\.scratch|\.claude)\//.test(f.path)) bad(`dev-only file in the archive: ${f.path}`);
  if (/^tools\//.test(f.path) && f.path !== 'tools/uneekor-watch.js') bad(`dev-only tool in the archive: ${f.path}`);
  if (/\.md$/i.test(f.path) && !f.path.startsWith('node_modules/')) bad(`doc in the archive: ${f.path}`);
  if (/(^|\/)\.env/.test(f.path)) bad(`an env file in the archive: ${f.path}`);
  if (/demo\.html$/.test(f.path)) bad(`a demo page in the archive: ${f.path}`);
}
const deps = [...new Set(under('node_modules').map((f) => f.path.split('/')[1]))].sort();

// ---- 3. the bundled arcade stages
const { readBundle, TOUR_FILE } = require(path.join(repo, 'lib', 'arcade-bundle.js'));
const bundleDir = path.join(resources, 'arcade-data');
const bundle = readBundle(bundleDir);
let tour = null;
if (!bundle) bad('resources/arcade-data has no valid bundle.json');
else {
  for (const c of bundle.courses) {
    let buf = null;
    try { buf = fs.readFileSync(path.join(bundleDir, 'courses', c.file)); } catch (_) { bad(`bundled course missing: ${c.file}`); }
    if (buf && sha(buf) !== c.sha256) bad(`bundled course does not match its checksum: ${c.file}`);
  }
  try { tour = JSON.parse(fs.readFileSync(path.join(bundleDir, TOUR_FILE), 'utf8')); } catch (_) { bad('bundled arcade-tour.json missing or unreadable'); }
  if (tour) for (const s of [...tour.stages, ...tour.tiebreaks]) if (!bundle.courses.some((c) => c.file === s.file)) bad(`the tour lists ${s.id} but its course is not bundled`);
}
// ---- 3b. the sky photos those stages are lit by (lib/sky-bundle.js; the game never downloads one).
// v3:env-polish Every stage has its own panorama inside the archive (3c), so the bundle is
// expected to list NO photo (tools/arcade-holes/sky-files.mjs decides, test/sky-bundle.test.mjs
// pins it): one that is listed must say which stage needs it, and the two 16 MB Poly Haven
// files must not ride along unlisted.
const { readSkyBundle, SKY_DIR } = require(path.join(repo, 'lib', 'sky-bundle.js'));
const skies = readSkyBundle(bundleDir);
let skyBytes = 0;
if (!skies) bad('resources/arcade-data has no valid sky.json: run npm run prepare:sky');
else {
  if (skies.complete !== true) bad('the sky bundle says it is incomplete: run npm run prepare:sky');
  for (const f of skies.files) {
    let buf = null;
    try { buf = fs.readFileSync(path.join(bundleDir, SKY_DIR, f.file)); } catch (_) { bad(`bundled sky missing: ${f.file}`); }
    if (buf && (buf.length !== f.bytes || sha(buf) !== f.sha256)) bad(`bundled sky does not match its checksum: ${f.file}`);
    if (buf) skyBytes += buf.length;
    if (!Array.isArray(f.stages) || !f.stages.length) bad(`a bundled sky photo names no stage that needs it: ${f.file}`);
  }
  let extra = [];
  try { extra = fs.readdirSync(path.join(bundleDir, SKY_DIR)).filter((n) => !skies.files.some((f) => f.file === n)); } catch (_) { /* reported above */ }
  for (const n of extra) bad(`a sky file that no stage uses is in the package: ${n}`);
}
// ---- 3c. the arcade stages' own skies and ground materials (v3:environment; public/arcade/env/manifest.json).
// They are generated art that lives in the repo, so they ship inside the archive like the
// midday sky does (nothing to install on first boot); every file the manifest names must
// be there with the manifest's size and checksum, and nothing the manifest does not name.
let envNote = null;
try {
  const envManifest = JSON.parse(fs.readFileSync(path.join(repo, 'public', 'arcade', 'env', 'manifest.json'), 'utf8'));
  const named = [...Object.values(envManifest.skies || {}), ...Object.values(envManifest.textures || {}).flatMap((t) => [t.color, t.normal])];
  if (!has.has('public/arcade/env/manifest.json')) bad('missing from the archive: public/arcade/env/manifest.json');
  let envBytes = 0, skyOnly = 0;
  for (const f of named) {
    const rel = `public/arcade/env/${f.file}`;
    if (!has.has(rel)) { bad(`missing from the archive: ${rel}`); continue; }
    let buf = null;
    try { buf = asar.extractFile(asarFile, rel.split('/').join(path.sep)); } catch (_) { bad(`cannot read from the archive: ${rel}`); }
    if (buf && (buf.length !== f.bytes || sha(buf) !== f.sha256)) bad(`does not match its checksum in the env manifest: ${rel}`);
    if (buf) { envBytes += buf.length; if (f.file.startsWith('sky/')) skyOnly += buf.length; }
  }
  for (const f of under('public/arcade/env')) {
    const rel = f.path.slice('public/arcade/env/'.length);
    if (rel !== 'manifest.json' && !named.some((n) => n.file === rel)) bad(`in the archive but not in the env manifest: ${f.path}`);
  }
  if (!Object.keys(envManifest.skies || {}).length) bad('the env manifest names no skies');
  if (skyOnly > 40 * 1048576) bad(`the stage skies weigh ${(skyOnly / 1048576).toFixed(1)} MB (the budget is 40)`);
  envNote = `${Object.keys(envManifest.skies || {}).length} stage skies (${(skyOnly / 1048576).toFixed(1)} MB), ${Object.keys(envManifest.textures || {}).length} ground sets, ${(envBytes / 1048576).toFixed(1)} MB in all`;
} catch (error) { bad(`public/arcade/env/manifest.json is missing or unreadable: ${error.message}`); }
// ---- 3d. the arcade worlds' trees (v3:tree-realism; public/arcade/trees/manifest.json): the species'
// models and the four painted textures ship inside the archive; every file the manifest names
// must be there at the manifest's size, nothing it does not name, and the palm prop the props
// layer draws in their place (tools/arcade-art/trees/palm-prop.mjs) beside the other props.
let treeNote = null;
try {
  const treeManifest = JSON.parse(fs.readFileSync(path.join(repo, 'public', 'arcade', 'trees', 'manifest.json'), 'utf8'));
  const named = [...Object.values(treeManifest.species || {}), ...Object.values(treeManifest.textures || {})];
  if (!has.has('public/arcade/trees/manifest.json')) bad('missing from the archive: public/arcade/trees/manifest.json');
  let treeBytes = 0;
  for (const f of named) {
    const rel = `public/arcade/trees/${f.file}`;
    if (!has.has(rel)) { bad(`missing from the archive: ${rel}`); continue; }
    let buf = null;
    try { buf = asar.extractFile(asarFile, rel.split('/').join(path.sep)); } catch (_) { bad(`cannot read from the archive: ${rel}`); }
    if (buf && buf.length !== f.bytes) bad(`not the size the tree manifest gives: ${rel}`);
    if (buf) treeBytes += buf.length;
  }
  for (const f of under('public/arcade/trees')) {
    const rel = f.path.slice('public/arcade/trees/'.length);
    if (rel !== 'manifest.json' && !named.some((n) => n.file === rel)) bad(`in the archive but not in the tree manifest: ${f.path}`);
  }
  for (const k of ['leaves', 'leavesAux', 'bark', 'barkNormal']) if (!(treeManifest.textures || {})[k]) bad(`the tree manifest names no ${k} texture`);
  if (Object.keys(treeManifest.species || {}).length < 20) bad('the tree manifest names fewer than twenty species');
  if (treeBytes > 25 * 1048576) bad(`the trees weigh ${(treeBytes / 1048576).toFixed(1)} MB (the budget is 25)`);
  const palm = (JSON.parse(fs.readFileSync(path.join(repo, 'public', 'arcade', 'props', 'manifest.json'), 'utf8')).kinds || {}).palm;
  if (!palm) bad('the props manifest has no palm (the tree build writes it)');
  else for (const f of palm.variants || [palm.file]) if (!has.has(`public/arcade/props/${f}`)) bad(`missing from the archive: public/arcade/props/${f}`);
  treeNote = `${Object.keys(treeManifest.species || {}).length} species, 4 textures, ${(treeBytes / 1048576).toFixed(1)} MB`;
} catch (error) { bad(`public/arcade/trees/manifest.json is missing or unreadable: ${error.message}`); }
if (fs.existsSync(path.join(resources, 'course-art'))) bad('resources/course-art is in the package: the game ships no real-course art packs');
for (const f of ['LICENSE.txt', 'NOTICE.md', 'CREDITS.md', 'SOUND-CREDITS.md']) if (!fs.existsSync(path.join(unpacked, f))) bad(`missing beside the .exe: ${f}`);
const product = require(path.join(repo, 'lib', 'product.js'));
if (!fs.existsSync(path.join(unpacked, `${product.name}.exe`))) bad(`no "${product.name}.exe" in the package`);
try {
  const packed = JSON.parse(asar.extractFile(asarFile, 'package.json').toString());
  if (packed.productName !== product.name) bad(`the packaged package.json says productName "${packed.productName}", not "${product.name}"`);
} catch (error) { bad(`cannot read the packaged package.json: ${error.message}`); }

// ---- 4. is it signed? (information, not a failure: docs/dev/signing.md)
let signature = 'not checked (Windows only)';
if (process.platform === 'win32') {
  try {
    const installers = fs.readdirSync(path.dirname(unpacked)).filter((f) => f.startsWith(`${product.installerName}-`) && f.endsWith('.exe'));
    const target = installers.length ? path.join(path.dirname(unpacked), installers.sort().pop()) : path.join(unpacked, `${product.name}.exe`);
    const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${target.replace(/'/g, "''")}'; $s.Status.ToString() + '|' + $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' })`], { encoding: 'utf8' }).trim();
    const [status, subject] = out.split('|');
    signature = `${path.basename(target)}: ${status === 'Valid' ? `signed by ${subject}` : status === 'NotSigned' ? 'NOT SIGNED (Windows SmartScreen will warn)' : status}`;
  } catch (_) { signature = 'could not be read'; }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`app.asar        ${mb(fs.statSync(asarFile).size)}, ${files.length} files; ${compared} compared with the repo (${mb(bytes)})`);
console.log(`node_modules    ${deps.join(', ')}`);
console.log(`arcade assets   ${under('public/arcade/props').length} props, ${under('public/arcade/sfx').length} sfx files, ${under('public/arcade/voice').length} voice files`);
if (bundle && tour) console.log(`arcade stages   ${bundle.courses.length} courses bundled (${tour.stages.length} match stages, ${tour.tiebreaks.length} tiebreak arenas), revision ${bundle.revision}, app ${bundle.appVersion}`);
if (skies) console.log(skies.files.length ? `sky photos      ${skies.files.length} bundled (${skies.files.map((f) => `${f.file.replace(/_4k\.hdr$/, '')} for ${(f.stages || []).join(', ')}`).join('; ')}), ${mb(skyBytes)}` : 'sky photos      none bundled (every stage has its own panorama)');
if (envNote) console.log(`stage world     ${envNote}`);
if (treeNote) console.log(`stage trees     ${treeNote}`);   // v3:tree-realism
if (propNote) console.log(`prop models     ${propNote}`);
console.log(`asset folders   ${Object.entries(assetCount).map(([d, n]) => `${d.replace('public/arcade/', '')} ${n}`).join(', ')}: every file in the tree is in the archive`);
console.log(`signature       ${signature}`);
if (problems.length) {
  console.error(`\nNOT SOUND: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}
console.log('\nPackage is sound.');
