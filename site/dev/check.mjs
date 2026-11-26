#!/usr/bin/env node
// Checks the site as files, with no browser and no dependency:
//
//   node site/dev/check.mjs            # exit code 1 when something is broken
//
//   - every page: one <h1>, a <title>, a description, the link-preview tags with an ABSOLUTE
//     og:image, lang, a Content-Security-Policy, the generated header and footer
//   - every link, anchor, picture, video, script and stylesheet points at something that
//     exists (a file in the site, an id in the target page); no path starts with "/" (the
//     site is served from a sub-path)
//   - nothing is LOADED from another origin (links to other sites are fine and are listed)
//   - every <img> has alt text, a width and a height; pictures below the first screen are lazy
//   - weights: each page with its smallest and its largest pictures, and the home page
//     against its budgets (first screen about 250 KB before video, all of it under 5 MB)
//   - sitemap.xml names every page; no file in assets/ is left unreferenced (a warning)
//   - every Download button is a plain link to config.js's downloadUrl (no script needed)
//   - words the site must not use
//
// A development tool: the Pages workflow does not publish site/dev.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f) => path.relative(site, f).replace(/\\/g, '/');
const errors = [], warnings = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warnings.push(`${page}: ${msg}`);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const size = (f) => { try { return fs.statSync(path.join(site, f)).size; } catch { return 0; } };
const gz = (f) => { try { return zlib.gzipSync(fs.readFileSync(path.join(site, f))).length; } catch { return 0; } };

const BUDGET = { firstScreen: 250 * 1024, home: 5 * 1024 * 1024 };
// the product is "Sim Clash": no commercial game is named or imitated anywhere on the site
// (each name is written with one letter in brackets, so this list itself is not a hit for the
// release checklist's grep for those names: docs/dev/release-checklist.md)
const FORBIDDEN = [/golf\s*cl[a]sh/i, /m[a]rio\s*golf/i, /everyb[o]dy'?s\s*golf/i, /hot\s*sh[o]ts\s*golf/i, /\btop[g]olf\b/i, /pg[a]\s*tour\s*2k/i, /lorem ipsum/i, /\bTODO\b/, /\bOWNER\b/];

const pages = fs.readdirSync(site).filter((f) => f.endsWith('.html')).sort();
const text = Object.fromEntries(pages.map((p) => [p, fs.readFileSync(path.join(site, p), 'utf8')]));
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const ids = Object.fromEntries(pages.map((p) => [p, idsOf(text[p])]));
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const referenced = new Set(['config.js', 'site.js', 'sitemap.xml']);
const external = new Map();

// a local reference -> the file it names (or an error)
function local(page, ref, what) {
  if (/^(https?:)?\/\//.test(ref) || /^(mailto|tel|data):/.test(ref)) return null;
  if (ref.startsWith('/')) { err(page, `${what} "${ref}" starts with "/": the site is served from a sub-path, keep paths relative`); return null; }
  const [file, hash] = ref.split('#');
  const target = file === '' ? page : file.split('?')[0];
  if (!fs.existsSync(path.join(site, target))) { err(page, `${what} "${ref}": no such file`); return null; }
  referenced.add(target);
  if (hash && target.endsWith('.html') && !(ids[target] || idsOf(fs.readFileSync(path.join(site, target), 'utf8'))).has(decodeURIComponent(hash))) err(page, `${what} "${ref}": no id="${hash}" in ${target}`);
  return target;
}

// config.js: where the Download buttons must point (dev/refresh.mjs writes it into every page)
const cfgBox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'config.js'), 'utf8'), cfgBox);
const downloadHref = (cfgBox.window.SIMCLASH_SITE || {}).downloadUrl || 'install.html';
let downloadButtons = 0;

const report = [];
for (const page of pages) {
  const html = strip(text[page]);
  // ----- the head
  if (!/<html lang="[a-z-]+">/.test(html)) err(page, 'no lang on <html>');
  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
  if (!title) err(page, 'no <title>'); else if (title.length > 90) warn(page, `title is ${title.length} characters`);
  const desc = attr((/<meta name="description"[^>]*>/.exec(html) || [''])[0], 'content');
  if (!desc) err(page, 'no meta description'); else if (desc.length < 70 || desc.length > 320) warn(page, `description is ${desc.length} characters`);
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) err(page, `${(html.match(/<h1[\s>]/g) || []).length} <h1> (want one)`);
  for (const prop of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image']) if (!new RegExp(`<meta property="${prop}" content="[^"]+">`).test(html)) err(page, `no ${prop}`);
  const og = attr((/<meta property="og:image" [^>]*>/.exec(html) || [''])[0], 'content') || '';
  if (!/^https:\/\/[^/]+\/.+\.(jpg|png)$/.test(og)) err(page, `og:image must be an absolute https address of a JPEG or PNG (is "${og}")`);
  // served from its own domain (paths start at the root) or from <owner>.github.io/<repo>/
  else if (![/^https:\/\/[^/]+\//, /^https:\/\/[^/]+\/[^/]+\//].some((re) => fs.existsSync(path.join(site, og.replace(re, ''))))) err(page, `og:image ${og}: no such file in the site`);
  else referenced.add([/^https:\/\/[^/]+\//, /^https:\/\/[^/]+\/[^/]+\//].map((re) => og.replace(re, '')).find((f) => fs.existsSync(path.join(site, f))));
  if (!/<meta name="twitter:card" content="summary_large_image">/.test(html)) err(page, 'no twitter:card');
  if (!/<link rel="canonical" href="https:\/\/[^"]+">/.test(html)) err(page, 'no canonical link');
  if (!/<meta http-equiv="Content-Security-Policy"/.test(html)) err(page, 'no Content-Security-Policy');
  if (!/<link rel="icon"/.test(html)) err(page, 'no favicon link');
  if (!/<header class="top">/.test(html) || !/<footer class="foot">/.test(html)) err(page, 'the generated header or footer is missing: run node site/dev/refresh.mjs');
  if (!/<a class="skip" href="#main">/.test(html) || !/id="main"/.test(html)) err(page, 'no skip link to #main');
  for (const m of text[page].matchAll(/<!-- gen:([\w-]+) -->/g)) if (!text[page].includes(`<!-- /gen:${m[1]} -->`)) err(page, `gen:${m[1]} is not closed`);
  if (/<!-- gen:(stages|arenas|balls|tricks|lm-tiers|lm-devices|lm-summary|header|footer|meta) --><!-- \/gen:/.test(text[page])) err(page, 'an empty generated part: run node site/dev/refresh.mjs');

  // ----- links
  for (const m of html.matchAll(/<a\s[^>]*>/g)) {
    const href = attr(m[0], 'href');
    if (attr(m[0], 'data-poster')) local(page, attr(m[0], 'data-poster'), 'data-poster');   // the picture the trailer lightbox shows while it loads
    if (href == null) { if (!/data-(gh|ext)=/.test(m[0])) err(page, `a link with no href: ${m[0].slice(0, 80)}`); continue; }
    const isDownload = /\sdata-gh="download"/.test(m[0]);
    if (isDownload) {
      // a Download button is a real link to the installer, so it works with scripts off
      downloadButtons++;
      if (href !== downloadHref) err(page, `a Download button points at "${href}", not at config.js's downloadUrl: run node site/dev/refresh.mjs`);
    }
    if (/^https?:\/\//.test(href)) {
      const host = new URL(href).host;
      external.set(host, (external.get(host) || 0) + 1);
      if (!/^https:/.test(href)) err(page, `a link that is not https: ${href}`);
      if (!isDownload && !/rel="[^"]*noopener/.test(m[0])) warn(page, `external link without rel="noopener": ${href}`);
      continue;
    }
    local(page, href, 'link');
  }

  // ----- what the page loads
  const loads = { text: new Set([page]), eager: [], lazySmall: 0, lazyLarge: 0, media: 0, eagerLarge: 0 };
  for (const m of html.matchAll(/<(script|link|iframe|source|video|audio|embed|object)\s[^>]*>/g)) {
    const tag = m[0];
    for (const name of ['src', 'href', 'poster', 'data']) {
      const v = attr(tag, name);
      if (v == null) continue;
      if (m[1] === 'link' && /rel="canonical"/.test(tag)) continue;
      if (/^(https?:)?\/\//.test(v)) { err(page, `<${m[1]}> loads from another origin: ${v}`); continue; }
      const f = local(page, v, `<${m[1]} ${name}>`);
      if (!f) continue;
      if (m[1] === 'script' || (m[1] === 'link' && /rel="stylesheet"/.test(tag))) loads.text.add(f);
      else if (m[1] === 'link') loads.eager.push(f);
      else if (name === 'poster') loads.eager.push(f);
    }
  }
  // a <video>'s first <source> is the one a browser that can play it will fetch
  for (const m of html.matchAll(/<video[^>]*>([\s\S]*?)<\/video>/g)) {
    const first = /<source\s[^>]*src="([^"]+)"/.exec(m[1]);
    if (first) loads.media += Math.max(...[...m[1].matchAll(/<source\s[^>]*src="([^"]+)"/g)].map((s) => size(s[1])));
    if (!/preload="none"/.test(m[0])) err(page, 'a <video> without preload="none"');
  }
  // ----- pictures
  for (const m of html.matchAll(/<img\s[^>]*>/g)) {
    const tag = m[0];
    const src = attr(tag, 'src');
    if (attr(tag, 'alt') == null) err(page, `<img ${src}> has no alt attribute`);
    if (!attr(tag, 'width') || !attr(tag, 'height')) err(page, `<img ${src}> has no width / height (the page would jump as it loads)`);
    const files = [src, ...(attr(tag, 'srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)];
    const sizes = [];
    for (const f of new Set(files)) { if (/^(https?:)?\/\//.test(f)) { err(page, `<img> loads from another origin: ${f}`); continue; } const t = local(page, f, '<img>'); if (t) sizes.push(size(t)); }
    if (!sizes.length) continue;
    const lazy = /loading="lazy"/.test(tag);
    const decorative = attr(tag, 'alt') === '';
    if (!lazy && !/fetchpriority="high"/.test(tag) && !/class="bg"/.test(tag) && !/assets\/icon/.test(src)) warn(page, `<img ${src}> is neither lazy nor marked fetchpriority="high"`);
    if (!decorative && (attr(tag, 'alt') || '').length < 12 && !/icon/.test(src)) warn(page, `<img ${src}> has very short alt text`);
    if (lazy) { loads.lazySmall += Math.min(...sizes); loads.lazyLarge += Math.max(...sizes); } else { loads.eager.push(files[0]); loads.eagerLarge += Math.max(...sizes) - size(files[0]); }
  }
  // ----- words
  for (const re of FORBIDDEN) { const hit = re.exec(html.replace(/<[^>]+>/g, ' ')); if (hit) err(page, `the site must not say "${hit[0]}"`); }
  if (/[—]/.test(html.replace(/<[^>]+>/g, ' '))) warn(page, 'an em dash in the text');

  const textRaw = [...loads.text].reduce((a, f) => a + size(f), 0);
  const textGz = [...loads.text].reduce((a, f) => a + gz(f), 0);
  const eager = [...new Set(loads.eager)].reduce((a, f) => a + size(f), 0);
  report.push({ page, textRaw, textGz, eager, eagerLarge: loads.eagerLarge, lazySmall: loads.lazySmall, lazyLarge: loads.lazyLarge, media: loads.media });
}

// ----- the home page's budgets
const home = report.find((r) => r.page === 'index.html');
if (home) {
  const first = home.textGz + home.eager;   // HTML, CSS and scripts as a server sends them (gzip), the icon, the hero picture a phone takes
  const all = home.textRaw + home.eager + home.eagerLarge + home.lazyLarge + home.media;
  if (first > BUDGET.firstScreen) err('index.html', `first screen is ${kb(first)} (budget ${kb(BUDGET.firstScreen)})`);
  if (all > BUDGET.home) err('index.html', `the whole page with its largest pictures and the hero clip is ${(all / 1048576).toFixed(2)} MB (budget 5 MB)`);
}

// ----- sitemap, and files nobody points at
const sitemap = fs.existsSync(path.join(site, 'sitemap.xml')) ? fs.readFileSync(path.join(site, 'sitemap.xml'), 'utf8') : '';
if (!sitemap) errors.push('sitemap.xml is missing: run node site/dev/refresh.mjs');
for (const p of pages) if (sitemap && !sitemap.includes(p === 'index.html' ? '/</loc>' : `/${p}</loc>`)) errors.push(`sitemap.xml does not list ${p}`);
// config.js: a video the lightbox plays is named in the page's data attributes and links, so it is already counted
const css = fs.readFileSync(path.join(site, 'assets', 'site.css'), 'utf8');
for (const m of css.matchAll(/url\(([^)]+)\)/g)) { const u = m[1].replace(/["']/g, ''); if (/^(https?:)?\/\//.test(u)) errors.push(`site.css loads from another origin: ${u}`); else if (!u.startsWith('data:')) referenced.add(path.posix.join('assets', u)); }
if (/@import|https?:\/\//.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) errors.push('site.css names another origin (an @import or an address)');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// (assets/before/ is the previous site's stage pictures, kept whole on purpose for the before / after sliders)
const unreferenced = walk(path.join(site, 'assets')).map(rel).filter((f) => !referenced.has(f) && !f.startsWith('assets/before/'));
for (const f of unreferenced) warnings.push(`${f}: published but nothing points at it (${kb(size(f))})`);
const published = walk(site).map(rel).filter((f) => !f.startsWith('dev/') && f !== 'README.md');
const publishedBytes = published.reduce((a, f) => a + size(f), 0);

// ----- the "your download has started" panel (site.js)
const siteJs = fs.readFileSync(path.join(site, 'site.js'), 'utf8');
for (const needle of ['Your download has started', 'More info', 'Run anyway', 'Try the download again', 'Install help', 'Checksum and older versions']) if (!siteJs.includes(needle)) errors.push(`site.js: the download panel no longer says "${needle}"`);
if (!/dialog\.dl-panel/.test(css)) errors.push('site.css: no style for the download panel (dialog.dl-panel)');

// ----- the report
const pad = (s, n) => String(s).padStart(n);
console.log('page                 html+css+js (gzip)   first pictures   the rest: smallest .. largest   video');
for (const r of report) console.log(`${r.page.padEnd(20)} ${pad(kb(r.textRaw), 7)} (${pad(kb(r.textGz), 6)})   ${pad(kb(r.eager), 8)}         ${pad(kb(r.lazySmall), 8)} .. ${pad(kb(r.lazyLarge + r.eagerLarge), 8)}        ${pad(r.media ? kb(r.media) : '-', 8)}`);
if (home) console.log(`\nhome: first screen ${kb(home.textGz + home.eager)} as served (${kb(home.textRaw + home.eager)} uncompressed); everything, largest pictures and the hero clip: ${((home.textRaw + home.eager + home.eagerLarge + home.lazyLarge + home.media) / 1048576).toFixed(2)} MB; on a phone: ${((home.textGz + home.eager + home.lazySmall + home.media) / 1048576).toFixed(2)} MB`);
console.log(`published: ${published.length} files, ${(publishedBytes / 1048576).toFixed(1)} MB`);
console.log(`Download buttons: ${downloadButtons}, each a plain link to ${downloadHref}`);
console.log(`links to other sites: ${[...external].map(([h, n]) => `${h} (${n})`).join(', ') || 'none'}`);
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n  ` + warnings.join('\n  '));
if (errors.length) { console.error(`\n${errors.length} error(s):\n  ` + errors.join('\n  ')); process.exit(1); }
console.log(`\n${pages.length} pages: links, anchors, pictures, alt text, weights and origins are in order.`);
