'use strict';
// The product's name, in ONE place: public/product.json (docs/dev/rename.md).
//
// Everything that shows or installs the name reads it from there: the window title and the
// user-data folder (main.js), the installer, shortcut and uninstall names
// (build/electron-builder.cjs), the icon build (tools/release/make-icon.cjs), and the page
// (GET /product.json, served like any file in public/). Text that cannot read a file
// (README, docs, the site) is rewritten by `node tools/release/rename.cjs "New Name"`.
//
// Never throws: a missing or broken file gives the defaults below.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'product.json');
const DEFAULTS = Object.freeze({
  name: 'Sim Clash',
  wordmark: ['SIM', 'CLASH'],
  initials: 'SC',
  slug: 'sim-clash',
  tagline: 'Arcade 1v1 golf for real launch monitors',
  appId: 'io.github.simclash.app',
  userDataDir: 'Sim Clash',
  installerName: 'Sim-Clash-Setup',
  repo: { owner: 'OWNER', name: 'sim-clash' },
  colors: { p1: '#ff5a36', p2: '#2e9bff', gold: '#ffd21f', ink: '#07090d' },
  builtOn: [],
});

function loadProduct(file = FILE) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { raw = {}; }
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const name = str(raw.name, DEFAULTS.name);
  return {
    name,
    wordmark: Array.isArray(raw.wordmark) && raw.wordmark.length && raw.wordmark.every((w) => typeof w === 'string') ? raw.wordmark : name.toUpperCase().split(/\s+/),
    initials: str(raw.initials, name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3)),
    slug: str(raw.slug, name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    tagline: str(raw.tagline, DEFAULTS.tagline),
    appId: str(raw.appId, DEFAULTS.appId),
    // a folder name under %APPDATA%: nothing a file system refuses
    userDataDir: str(raw.userDataDir, name).replace(/[<>:"/\|?*]/g, '').trim() || DEFAULTS.userDataDir,
    installerName: str(raw.installerName, name.replace(/[^A-Za-z0-9]+/g, '-') + '-Setup').replace(/[^A-Za-z0-9._-]/g, '-'),
    repo: { owner: str(raw.repo && raw.repo.owner, DEFAULTS.repo.owner), name: str(raw.repo && raw.repo.name, DEFAULTS.repo.name) },
    colors: { ...DEFAULTS.colors, ...(raw.colors && typeof raw.colors === 'object' ? raw.colors : {}) },
    builtOn: Array.isArray(raw.builtOn) ? raw.builtOn : [],
  };
}

module.exports = { ...loadProduct(), loadProduct, PRODUCT_FILE: FILE, DEFAULTS };
